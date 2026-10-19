import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { createAuthenticate } from '../auth.js';
import { createBooking, type BookingRequest } from '../bookings.js';
import { sendConfirmation } from '../notifications.js';

interface AppointmentRoutesOptions {
  pool: Pool;
  now: () => Date;
  authenticate: ReturnType<typeof createAuthenticate>;
}

export const appointmentRoutes: FastifyPluginAsync<AppointmentRoutesOptions> = async (
  app,
  { pool, now, authenticate },
) => {
  app.post<{ Body: BookingRequest }>(
    '/appointments',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['branchId', 'service', 'startsAt'],
          additionalProperties: false,
          properties: {
            branchId: { type: 'string', pattern: '^[0-9]+$' },
            service: { type: 'string', minLength: 1 },
            startsAt: { type: 'string', format: 'date-time' },
            consultantId: { type: 'string', pattern: '^[0-9]+$' },
          },
        },
      },
    },
    async (request, reply) => {
      // authenticate has already run, so there is a verified user.
      const user = request.user!;
      const result = await createBooking(pool, request.body, { id: user.sub, email: user.email }, now());

      if (result.ok) {
        const confirmation = sendConfirmation(request.log, result.booking);
        return reply.code(201).send({ ...result.booking, confirmation });
      }

      switch (result.reason) {
        case 'branch_not_found':
          return reply.code(404).send({ error: 'Branch not found' });
        case 'service_not_found':
          return reply.code(404).send({ error: 'Service not found' });
        case 'not_a_slot':
          return reply.code(422).send({ error: 'That is not a bookable time at this branch' });
        case 'unavailable':
          return reply.code(409).send({ error: 'That slot was just taken. Please choose another time.' });
      }
    },
  );

  // The signed-in client's own appointments: booked and not yet over, soonest first.
  // The client comes from the verified token, so nobody can ask for someone else's.
  app.get('/appointments', { preHandler: authenticate }, async (request) => {
    const { rows } = await pool.query(
      `SELECT a.reference, a.status, a.starts_at, a.ends_at,
              b.id::text AS branch_id, b.name AS branch_name, b.timezone,
              c.id::text AS consultant_id, c.name AS consultant_name,
              s.name AS service
       FROM appointments a
       JOIN branches b       ON b.id = a.branch_id
       JOIN consultants c    ON c.id = a.consultant_id
       JOIN service_types s  ON s.id = a.service_type_id
       WHERE a.client_id = $1
         AND a.status = 'booked'
         AND a.ends_at > $2::timestamptz
       ORDER BY a.starts_at`,
      [request.user!.sub, now().toISOString()],
    );

    return rows.map((r) => ({
      reference: r.reference,
      status: r.status,
      branch: { id: r.branch_id, name: r.branch_name, timezone: r.timezone },
      consultant: { id: r.consultant_id, name: r.consultant_name },
      service: r.service,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
    }));
  });
};
