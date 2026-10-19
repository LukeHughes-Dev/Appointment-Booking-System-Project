import Fastify from 'fastify';
import type { Pool } from 'pg';
import { branchRoutes } from './routes/branches.js';

export interface AppOptions {
  pool: Pool;
  logger?: boolean;
}

// Builds the app without starting it, so tests can call it with app.inject()
// and never open a real port. The pool is passed in, not created here.
export function buildApp({ pool, logger = false }: AppOptions) {
  const app = Fastify({ logger });

  // Closing the app also closes the database pool.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(branchRoutes, { pool });

  return app;
}
