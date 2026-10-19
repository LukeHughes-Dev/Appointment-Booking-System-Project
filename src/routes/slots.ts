import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { findSlots } from '../slots.js';

const GRID_MINUTES = 15; // slots start every 15 minutes
const NOTICE_MINUTES = 30; // nothing can be booked closer than this, so walk-ins can be helped

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
        gridMinutes: GRID_MINUTES,
        noticeMinutes: NOTICE_MINUTES,
      });
    },
  );
};
