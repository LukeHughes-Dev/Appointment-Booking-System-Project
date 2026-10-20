import { createRemoteJWKSet } from 'jose';
import { buildApp } from './app.js';
import { createPool } from './db.js';
import { simulatedSchedule, syncBreaks } from './schedule.js';

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

const pool = createPool(databaseUrl);

const app = buildApp({
  pool,
  auth: { issuer, audience, getKey: createRemoteJWKSet(new URL(jwksUri)) },
  logger: true,
});

// Copy the next four weeks of breaks from the scheduling feed now and then every hour, so
// new days appear and the feed's changes arrive. Days staff have edited are left alone.
const SYNC_DAYS_AHEAD = 28;
async function syncBreaksAhead() {
  const from = new Date();
  const to = new Date(from.getTime() + SYNC_DAYS_AHEAD * 86_400_000);
  try {
    const result = await syncBreaks(pool, simulatedSchedule, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    app.log.info(result, 'breaks synced');
  } catch (err) {
    app.log.error(err, 'breaks sync failed');
  }
}
void syncBreaksAhead();
setInterval(() => void syncBreaksAhead(), 60 * 60 * 1000).unref();

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
