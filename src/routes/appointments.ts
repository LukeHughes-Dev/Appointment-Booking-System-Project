import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { createAuthenticate } from '../auth.js';
import { createBooking, type BookingRequest } from '../bookings.js';
import { cancelAppointment } from '../cancellations.js';
import { rescheduleAppointment } from '../reschedules.js';
import { findNextSlots, findSlots, MIN_NOTICE_MINUTES, SLOT_GRID_MINUTES } from '../slots.js';
import { sendConfirmation } from '../notifications.js';
import { windowState } from '../rules.js';

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
        const confirmation = sendConfirmation(request.log, result.booking, 'booked');
        return reply.code(201).send({ ...result.booking, confirmation });
      }

      switch (result.reason) {
        case 'branch_not_found':
          return reply.code(404).send({ error: 'Branch not found' });
        case 'service_not_found':
          return reply.code(404).send({ error: 'Service not found' });
        case 'not_a_slot':
          return reply.code(422).send({ error: 'That is not a bookable time at this branch' });
        case 'client_busy':
          return reply.code(409).send({ error: 'You already have an appointment at this time.' });
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
      window: windowState(r.starts_at, now()),
    }));
  });

  app.delete<{ Params: { reference: string } }>(
    '/appointments/:reference',
    {
      preHandler: authenticate,
      schema: {
        params: {
          type: 'object',
          required: ['reference'],
          properties: { reference: { type: 'string', pattern: '^APT-[0-9A-F]{10}$' } },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const result = await cancelAppointment(pool, request.params.reference, user.sub, user.email, now());

      if (result.ok) {
        const confirmation = sendConfirmation(request.log, result.appointment, 'cancelled');
        return { reference: result.reference, status: 'cancelled', confirmation };
      }

      switch (result.reason) {
        case 'not_found':
          return reply.code(404).send({ error: 'We could not find that appointment.' });
        case 'already_cancelled':
          return reply.code(409).send({ error: 'You have already cancelled this appointment.' });
        case 'already_started':
          return reply
            .code(409)
            .send({ error: 'This appointment has already started and can no longer be cancelled.' });
      }
    },
  );

  // What a client sees while choosing a new time: the same slots as booking, except that
  // the appointment being moved does not block itself. Owner only.
  async function ownAppointment(reference: string, clientId: string) {
    const { rows } = await pool.query(
      `SELECT a.branch_id::text, s.name AS service FROM appointments a
       JOIN service_types s ON s.id = a.service_type_id
       WHERE a.reference = $1 AND a.client_id = $2 AND a.status = 'booked'`,
      [reference, clientId],
    );
    return rows[0] as { branch_id: string; service: string } | undefined;
  }
  const referenceParams = {
    type: 'object',
    required: ['reference'],
    properties: { reference: { type: 'string', pattern: '^APT-[0-9A-F]{10}$' } },
  } as const;

  app.get<{ Params: { reference: string }; Querystring: { date: string } }>(
    '/appointments/:reference/slots',
    {
      preHandler: authenticate,
      schema: {
        params: referenceParams,
        querystring: { type: 'object', required: ['date'], properties: { date: { type: 'string', format: 'date' } } },
      },
    },
    async (request, reply) => {
      const appt = await ownAppointment(request.params.reference, request.user!.sub);
      if (!appt) return reply.code(404).send({ error: 'We could not find that appointment.' });
      return findSlots(pool, {
        branchId: appt.branch_id,
        date: request.query.date,
        service: appt.service,
        now: now(),
        gridMinutes: SLOT_GRID_MINUTES,
        noticeMinutes: MIN_NOTICE_MINUTES,
        ignoreReference: request.params.reference,
      });
    },
  );

  // A consultant's next free times after a moment, on any day: offered when the time the
  // client chose does not suit their consultant. Owner only.
  app.get<{ Params: { reference: string }; Querystring: { consultantId: string; after?: string } }>(
    '/appointments/:reference/next-available',
    {
      preHandler: authenticate,
      schema: {
        params: referenceParams,
        querystring: {
          type: 'object',
          required: ['consultantId'],
          properties: {
            consultantId: { type: 'string', pattern: '^[0-9]+$' },
            after: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const appt = await ownAppointment(request.params.reference, request.user!.sub);
      if (!appt) return reply.code(404).send({ error: 'We could not find that appointment.' });
      return findNextSlots(pool, {
        branchId: appt.branch_id,
        service: appt.service,
        consultantId: request.query.consultantId,
        after: request.query.after ? new Date(request.query.after) : now(),
        now: now(),
        limit: 5,
        days: 14,
        ignoreReference: request.params.reference,
      });
    },
  );

  // Move to a time the client chose, with the same consultant unless another is named.
  app.post<{ Params: { reference: string }; Body: { startsAt: string; consultantId?: string } }>(
    '/appointments/:reference/reschedule',
    {
      preHandler: authenticate,
      schema: {
        params: {
          type: 'object',
          required: ['reference'],
          properties: { reference: { type: 'string', pattern: '^APT-[0-9A-F]{10}$' } },
        },
        body: {
          type: 'object',
          required: ['startsAt'],
          additionalProperties: false,
          properties: {
            startsAt: { type: 'string', format: 'date-time' },
            consultantId: { type: 'string', pattern: '^[0-9]+$' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const result = await rescheduleAppointment(
        pool,
        request.params.reference,
        user.sub,
        user.email,
        request.body,
        now(),
      );

      if (result.ok) {
        const { appointment, ...moved } = result;
        return { ...moved, confirmation: sendConfirmation(request.log, appointment, 'moved') };
      }

      switch (result.reason) {
        case 'not_found':
          return reply.code(404).send({ error: 'We could not find that appointment.' });
        case 'not_booked':
          return reply.code(409).send({ error: 'This appointment is no longer booked.' });
        case 'already_over':
          return reply
            .code(409)
            .send({ error: 'This appointment has already started and can no longer be moved.' });
        case 'not_a_slot':
          return reply.code(422).send({ error: 'That is not a bookable time at this branch' });
        case 'same_time':
          return reply.code(422).send({ error: 'That is the time you already have.' });
        case 'client_busy':
          return reply.code(409).send({ error: 'You already have an appointment at this time.' });
        case 'consultant_unavailable':
          return reply.code(409).send({
            error: `${result.consultant.name} is not available at that time.`,
            code: 'consultant_unavailable',
            consultant: result.consultant,
            available: result.available,
          });
      }
    },
  );
};
