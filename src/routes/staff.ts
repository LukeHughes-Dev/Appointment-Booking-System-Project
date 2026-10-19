import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { requireRole, type createAuthenticate } from '../auth.js';

interface StaffRoutesOptions {
  pool: Pool;
  now: () => Date;
  authenticate: ReturnType<typeof createAuthenticate>;
}

const MAX_ROWS = 200;

export const staffRoutes: FastifyPluginAsync<StaffRoutesOptions> = async (
  app,
  { pool, now, authenticate },
) => {
  const consultantOnly = [authenticate, requireRole('consultant')];

  // Which consultant is this? Matched by the email in the verified token.
  async function consultantFor(email: string) {
    const { rows } = await pool.query(
      'SELECT id::text, name FROM consultants WHERE lower(email) = lower($1) AND is_active',
      [email],
    );
    return rows[0] as { id: string; name: string } | undefined;
  }

  // The consultant's own appointments, past and future. With ?date= it shows that
  // day (in the branch's time) soonest first; without it, the most recent first.
  app.get<{ Querystring: { date?: string } }>(
    '/staff/appointments',
    {
      preHandler: consultantOnly,
      schema: {
        querystring: {
          type: 'object',
          properties: { date: { type: 'string', format: 'date' } },
        },
      },
    },
    async (request, reply) => {
      const consultant = await consultantFor(request.user!.email);
      if (!consultant) return reply.code(404).send({ error: 'No consultant record for this sign-in' });

      const { date } = request.query;
      const { rows } = await pool.query(
        `SELECT a.reference, a.status, a.outcome, a.client_email, a.starts_at, a.ends_at,
                b.id::text AS branch_id, b.name AS branch_name, b.timezone,
                s.name AS service
         FROM appointments a
         JOIN branches b      ON b.id = a.branch_id
         JOIN service_types s ON s.id = a.service_type_id
         WHERE a.consultant_id = $1
           AND ($2::date IS NULL OR (a.starts_at AT TIME ZONE b.timezone)::date = $2::date)
         ORDER BY CASE WHEN $2::date IS NULL THEN NULL ELSE a.starts_at END ASC,
                  a.starts_at DESC
         LIMIT ${MAX_ROWS}`,
        [consultant.id, date ?? null],
      );

      return rows.map((r) => ({
        reference: r.reference,
        status: r.status,
        outcome: r.outcome,
        clientEmail: r.client_email,
        branch: { id: r.branch_id, name: r.branch_name, timezone: r.timezone },
        service: r.service,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
      }));
    },
  );

  // Record how an appointment went (or clear it with null). Only your own appointments,
  // and only once they have started.
  app.patch<{ Params: { reference: string }; Body: { outcome: 'attended' | 'no_show' | null } }>(
    '/staff/appointments/:reference/outcome',
    {
      preHandler: consultantOnly,
      schema: {
        params: {
          type: 'object',
          required: ['reference'],
          properties: { reference: { type: 'string', pattern: '^APT-[0-9A-F]{10}$' } },
        },
        body: {
          type: 'object',
          required: ['outcome'],
          properties: { outcome: { enum: ['attended', 'no_show', null] } },
        },
      },
    },
    async (request, reply) => {
      const consultant = await consultantFor(request.user!.email);
      if (!consultant) return reply.code(404).send({ error: 'No consultant record for this sign-in' });

      const { rows } = await pool.query(
        'SELECT status, starts_at FROM appointments WHERE reference = $1 AND consultant_id = $2',
        [request.params.reference, consultant.id],
      );
      const appointment = rows[0];
      if (!appointment) return reply.code(404).send({ error: 'We could not find that appointment.' });
      if (appointment.status !== 'booked') {
        return reply.code(409).send({ error: 'A cancelled appointment has no outcome.' });
      }
      if (appointment.starts_at > now()) {
        return reply.code(409).send({ error: 'This appointment has not started yet.' });
      }

      await pool.query('UPDATE appointments SET outcome = $1 WHERE reference = $2', [
        request.body.outcome,
        request.params.reference,
      ]);
      return { reference: request.params.reference, outcome: request.body.outcome };
    },
  );
};
