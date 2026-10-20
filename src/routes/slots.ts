import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { findNextSlots, findSlots, MIN_NOTICE_MINUTES, SLOT_GRID_MINUTES } from '../slots.js';

interface SlotRoutesOptions {
  pool: Pool;
  now: () => Date;
}

export const slotRoutes: FastifyPluginAsync<SlotRoutesOptions> = async (app, { pool, now }) => {
  app.get<{ Params: { id: string }; Querystring: { date: string; service: string } }>(
    '/branches/:id/slots',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
        },
        querystring: {
          type: 'object',
          required: ['date', 'service'],
          properties: {
            date: { type: 'string', format: 'date' },
            service: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { date, service } = request.query;

      const branch = await pool.query('SELECT 1 FROM branches WHERE id = $1', [id]);
      if (branch.rowCount === 0) return reply.code(404).send({ error: 'Branch not found' });

      const svc = await pool.query('SELECT 1 FROM service_types WHERE name = $1', [service]);
      if (svc.rowCount === 0) return reply.code(404).send({ error: 'Service not found' });

      return findSlots(pool, {
        branchId: id,
        date,
        service,
        now: now(),
        gridMinutes: SLOT_GRID_MINUTES,
        noticeMinutes: MIN_NOTICE_MINUTES,
      });
    },
  );

  // A consultant's next free times after a moment, on any day: used when the time a client
  // chose does not suit their consultant.
  app.get<{
    Params: { id: string };
    Querystring: { service: string; consultantId: string; after?: string };
  }>(
    '/branches/:id/next-available',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
        },
        querystring: {
          type: 'object',
          required: ['service', 'consultantId'],
          properties: {
            service: { type: 'string', minLength: 1 },
            consultantId: { type: 'string', pattern: '^[0-9]+$' },
            after: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { service, consultantId, after } = request.query;

      const branch = await pool.query('SELECT 1 FROM branches WHERE id = $1', [id]);
      if (branch.rowCount === 0) return reply.code(404).send({ error: 'Branch not found' });
      const svc = await pool.query('SELECT 1 FROM service_types WHERE name = $1', [service]);
      if (svc.rowCount === 0) return reply.code(404).send({ error: 'Service not found' });

      return findNextSlots(pool, {
        branchId: id,
        service,
        consultantId,
        after: after ? new Date(after) : now(),
        now: now(),
        limit: 5,
        days: 14,
      });
    },
  );
};
