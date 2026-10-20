import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
  // General request limit per address. Off unless given: the server turns it on, and tests
  // that make hundreds of requests from one address leave it off.
  rateLimit?: { max: number; timeWindowMs?: number };
  trustProxy?: boolean; // true when behind a proxy (nginx), so the real client address is used
}

// Builds the app without starting it, so tests can call it with app.inject()
// and never open a real port. The pool is passed in, not created here.
export function buildApp({
  pool,
  auth,
  logger = false,
  now = () => new Date(),
  rateLimit: limit,
  trustProxy = false,
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });
  const authenticate = createAuthenticate(auth);

  // Filled in by authenticate() on routes that need a signed-in user.
  app.decorateRequest('user', null);

  // Closing the app also closes the database pool.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  // Safe response headers (no sniffing, no framing, and so on). This is an API, so no pages are served.
  // The one default turned off is "upgrade insecure requests", which would make a browser try
  // https for the /docs page's own files, and local development has no https.
  app.register(helmet, {
    contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
  });

  if (limit) {
    app.register(rateLimit, {
      max: limit.max,
      timeWindow: limit.timeWindowMs ?? 60_000,
      allowList: (request) => request.url === '/health', // health checks must always answer
    });
  }

  // An OpenAPI description, built from the routes' own schemas, with a browsable page at /docs.
  app.register(swagger, {
    openapi: {
      info: {
        title: 'Appointment Booking API',
        description: 'Branch appointments for clients, with staff views. Sign in through the identity provider, then send the access token as a Bearer token.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    // Routes that run the sign-in check are shown as needing the Bearer token.
    transform: ({ schema, url, route }) => ({
      schema: route.preHandler ? { ...schema, security: [{ bearerAuth: [] }] } : schema,
      url,
    }),
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  // A plugin like the rest, so the OpenAPI description includes it.
  app.register(async (instance) => {
    instance.get('/health', async () => ({ status: 'ok' }));
  });
  app.register(branchRoutes, { pool, now });
  app.register(meRoutes, { authenticate });
  app.register(serviceRoutes, { pool });
  app.register(slotRoutes, { pool, now });
  app.register(appointmentRoutes, { pool, now, authenticate });
  app.register(staffRoutes, { pool, now, authenticate });
  app.register(messageRoutes, { pool, now, authenticate });

  return app;
}
