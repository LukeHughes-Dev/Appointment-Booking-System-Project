import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';

// Same defaults as docker-compose.yml, so tests run after `docker compose up -d`.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://booking:booking_dev_password@localhost:5432/booking';

export function buildTestApp() {
  return buildApp({ pool: createPool(databaseUrl) });
}
