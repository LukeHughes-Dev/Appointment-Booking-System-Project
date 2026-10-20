import { generateKeyPair, SignJWT } from 'jose';
import type { Pool } from 'pg';
import { buildApp, type AppOptions } from '../src/app.js';
import { createPool } from '../src/db.js';

// Same defaults as docker-compose.yml, so tests run after `docker compose up -d`.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://booking:booking_dev_password@localhost:5432/booking';

// Tests sign their own tokens with a throwaway key, so they need no identity provider.
export const TEST_ISSUER = 'http://identity.test/realms/booking';
export const TEST_AUDIENCE = 'booking-api';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const otherKeys = await generateKeyPair('ES256'); // a key the app does not trust

export function buildTestApp(now?: () => Date, extra: Partial<Pick<AppOptions, 'rateLimit'>> = {}) {
  return buildApp({
    ...extra,
    pool: createPool(databaseUrl),
    auth: { issuer: TEST_ISSUER, audience: TEST_AUDIENCE, getKey: async () => publicKey },
    now,
  });
}

interface TokenOptions {
  sub?: string;
  email?: string;
  name?: string;
  roles?: string[];
  issuer?: string;
  audience?: string;
  expiresIn?: string; // e.g. '5m', or '-1m' for one that has already expired
  signedByUntrustedKey?: boolean;
}

// Builds a sign-in token like the identity provider would issue.
export async function tokenFor(options: TokenOptions = {}) {
  const claims: Record<string, unknown> = { email: options.email ?? 'client@booking-test.example' };
  if (options.name) claims.name = options.name;
  if (options.roles) claims.realm_access = { roles: options.roles };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(options.sub ?? 'test-client')
    .setIssuer(options.issuer ?? TEST_ISSUER)
    .setAudience(options.audience ?? TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.signedByUntrustedKey ? otherKeys.privateKey : privateKey);
}

// A separate pool for tests that need to look at, or clean up, the database directly.
export function createTestPool(): Pool {
  return createPool(databaseUrl);
}
