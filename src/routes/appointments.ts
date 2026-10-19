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
};
