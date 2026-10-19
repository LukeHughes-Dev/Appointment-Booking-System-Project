import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

export const branchRoutes: FastifyPluginAsync<{ pool: Pool }> = async (app, { pool }) => {
  app.get('/branches', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, timezone FROM branches ORDER BY name',
    );
    return rows;
  });
};
