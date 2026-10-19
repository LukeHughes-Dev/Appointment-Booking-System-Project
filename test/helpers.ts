import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import type { Pool } from 'pg';

// Same defaults as docker-compose.yml, so tests run after `docker compose up -d`.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://booking:booking_dev_password@localhost:5432/booking';

export function buildTestApp(now?: () => Date) {
  return buildApp({ pool: createPool(databaseUrl), now });
}

// A separate pool for tests that need to look at, or clean up, the database directly.
export function createTestPool(): Pool {
  return createPool(databaseUrl);
}
