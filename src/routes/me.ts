import type { FastifyPluginAsync } from 'fastify';
import type { createAuthenticate } from '../auth.js';

type Authenticate = ReturnType<typeof createAuthenticate>;

export const meRoutes: FastifyPluginAsync<{ authenticate: Authenticate }> = async (
  app,
  { authenticate },
) => {
  // Who am I? Lets the app show the signed-in name and decide which screens to offer.
  app.get('/me', { preHandler: authenticate }, async (request) => request.user);
};
