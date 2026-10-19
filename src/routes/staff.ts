import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { requireRole, type createAuthenticate } from '../auth.js';

interface StaffRoutesOptions {
  pool: Pool;
  now: () => Date;
  authenticate: ReturnType<typeof createAuthenticate>;
}

const MAX_ROWS = 200;
const MAX_SUMMARY_DAYS = 366;

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

  // Managers: how many appointments each branch and consultant had in a period.
  // Dates are the branch's own local dates, both inclusive.
  app.get<{ Querystring: { from: string; to: string } }>(
    '/staff/summary',
    {
      preHandler: [authenticate, requireRole('manager')],
      schema: {
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      const { from, to } = request.query;
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days < 0) return reply.code(400).send({ error: 'The end date must not be before the start date.' });
      if (days > MAX_SUMMARY_DAYS) {
        return reply.code(400).send({ error: `Please choose a period of ${MAX_SUMMARY_DAYS} days or less.` });
      }

      // upcoming   = booked, not started yet
      // attended / noShow = booked, started, outcome recorded
      // notRecorded = booked, started, outcome still empty
      const { rows } = await pool.query(
        `SELECT b.id::text AS branch_id, b.name AS branch_name,
                c.id::text AS consultant_id, c.name AS consultant_name,
                count(*) FILTER (WHERE a.status = 'booked' AND a.starts_at > $3::timestamptz)::int AS upcoming,
                count(*) FILTER (WHERE a.status = 'booked' AND a.outcome = 'attended')::int AS attended,
                count(*) FILTER (WHERE a.status = 'booked' AND a.outcome = 'no_show')::int AS no_show,
                count(*) FILTER (WHERE a.status = 'booked' AND a.outcome IS NULL
                                   AND a.starts_at <= $3::timestamptz)::int AS not_recorded,
                count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled
         FROM appointments a
         JOIN branches b    ON b.id = a.branch_id
         JOIN consultants c ON c.id = a.consultant_id
         WHERE (a.starts_at AT TIME ZONE b.timezone)::date BETWEEN $1::date AND $2::date
         GROUP BY b.id, b.name, c.id, c.name
         ORDER BY b.name, c.name`,
        [from, to, now().toISOString()],
      );

      type Counts = { upcoming: number; attended: number; noShow: number; notRecorded: number; cancelled: number };
      const empty = (): Counts => ({ upcoming: 0, attended: 0, noShow: 0, notRecorded: 0, cancelled: 0 });
      const add = (t: Counts, c: Counts) => {
        for (const key of Object.keys(t) as (keyof Counts)[]) t[key] += c[key];
      };

      const branches = new Map<string, { branch: { id: string; name: string }; totals: Counts; consultants: unknown[] }>();
      for (const r of rows) {
        const counts: Counts = {
          upcoming: r.upcoming,
          attended: r.attended,
          noShow: r.no_show,
          notRecorded: r.not_recorded,
          cancelled: r.cancelled,
        };
        let entry = branches.get(r.branch_id);
        if (!entry) {
          entry = { branch: { id: r.branch_id, name: r.branch_name }, totals: empty(), consultants: [] };
          branches.set(r.branch_id, entry);
        }
        add(entry.totals, counts);
        entry.consultants.push({ consultant: { id: r.consultant_id, name: r.consultant_name }, ...counts });
      }
      return [...branches.values()];
    },
  );
};
