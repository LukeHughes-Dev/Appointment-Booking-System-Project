import Fastify from 'fastify';
import type { Pool } from 'pg';
import { appointmentRoutes } from './routes/appointments.js';
import { branchRoutes } from './routes/branches.js';
import { slotRoutes } from './routes/slots.js';

export interface AppOptions {
  pool: Pool;
  logger?: boolean;
  now?: () => Date; // injectable clock, so tests can fix the time
}

// Builds the app without starting it, so tests can call it with app.inject()
// and never open a real port. The pool is passed in, not created here.
export function buildApp({ pool, logger = false, now = () => new Date() }: AppOptions) {
  const app = Fastify({ logger });

  // Closing the app also closes the database pool.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(branchRoutes, { pool });
  app.register(slotRoutes, { pool, now });
  app.register(appointmentRoutes, { pool, now });

  return app;
}
