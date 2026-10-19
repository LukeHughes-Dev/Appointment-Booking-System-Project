import Fastify from 'fastify';

export interface AppOptions {
  logger?: boolean;
}

// Builds the app without starting it, so tests can call it with app.inject()
// and never open a real port.
export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
