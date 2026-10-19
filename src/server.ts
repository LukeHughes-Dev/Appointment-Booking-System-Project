import { createRemoteJWKSet } from 'jose';
import { buildApp } from './app.js';
import { createPool } from './db.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

const issuer = process.env.OIDC_ISSUER;
const audience = process.env.OIDC_AUDIENCE;

if (!issuer || !audience) {
  console.error('OIDC_ISSUER and OIDC_AUDIENCE are not set. Copy .env.example to .env.');
  process.exit(1);
}

// The identity provider publishes the public keys that verify its tokens.
const jwksUri = process.env.OIDC_JWKS_URI ?? `${issuer}/protocol/openid-connect/certs`;

const app = buildApp({
  pool: createPool(databaseUrl),
  auth: { issuer, audience, getKey: createRemoteJWKSet(new URL(jwksUri)) },
  logger: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
