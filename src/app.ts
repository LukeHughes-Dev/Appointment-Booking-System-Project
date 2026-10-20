import Fastify from 'fastify';
import type { Pool } from 'pg';
import { createAuthenticate, type AuthConfig } from './auth.js';
import { appointmentRoutes } from './routes/appointments.js';
import { branchRoutes } from './routes/branches.js';
import { meRoutes } from './routes/me.js';
import { serviceRoutes } from './routes/services.js';
import { slotRoutes } from './routes/slots.js';
import { staffRoutes } from './routes/staff.js';
import { messageRoutes } from './routes/messages.js';

export interface AppOptions {
  pool: Pool;
  auth: AuthConfig;
  logger?: boolean;
  now?: () => Date; // injectable clock, so tests can fix the time
}

// Builds the app without starting it, so tests can call it with app.inject()
// and never open a real port. The pool is passed in, not created here.
export function buildApp({ pool, auth, logger = false, now = () => new Date() }: AppOptions) {
  const app = Fastify({ logger });
  const authenticate = createAuthenticate(auth);

  // Filled in by authenticate() on routes that need a signed-in user.
  app.decorateRequest('user', null);

  // Closing the app also closes the database pool.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(branchRoutes, { pool, now });
  app.register(meRoutes, { authenticate });
  app.register(serviceRoutes, { pool });
  app.register(slotRoutes, { pool, now });
  app.register(appointmentRoutes, { pool, now, authenticate });
  app.register(staffRoutes, { pool, now, authenticate });
  app.register(messageRoutes, { pool, now, authenticate });

  return app;
}
