import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

interface ServiceRoutesOptions {
  pool: Pool;
}

export const serviceRoutes: FastifyPluginAsync<ServiceRoutesOptions> = async (app, { pool }) => {
  // What a client can book, and how long each takes, so the screens never keep their own list.
  app.get('/services', async () => {
    const { rows } = await pool.query(
      'SELECT name, duration_minutes AS minutes FROM service_types ORDER BY id',
    );
    return rows as { name: string; minutes: number }[];
  });
};
