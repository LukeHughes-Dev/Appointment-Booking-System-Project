// Fills Pretoria Menlyn with about three weeks of past appointments (fictional clients), so
// the consultant and manager screens have something to show. The app itself cannot book
// the past, which is why this goes straight to the database.
//
//   npm run seed:demo
//
// Safe to run again: it replaces its own rows (client ids starting "demo-") and nothing else.
import { createPool } from '../src/db.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

const pool = createPool(databaseUrl);

try {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'demo-%'");

  // Weekdays of the last 21 days, three appointments per consultant per day (09:00, 11:00,
  // 14:00). The "random" mix is derived from a hash, so every run gives the same data:
  // about 8% cancelled, 10% no-shows, the rest attended. Yesterday's outcomes are left
  // empty, to show "not recorded" on the manager summary.
  const inserted = await pool.query(`
    WITH today AS (
      SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d
    ),
    plan AS (
      SELECT day, c.id AS consultant_id, c.name AS consultant, hr,
             abs(hashtext(day::text || c.name || hr::text)) AS h
      FROM today,
           generate_series(today.d - 21, today.d - 1, interval '1 day') AS g(day),
           consultants c,
           unnest(ARRAY[9, 11, 14]) AS hr
      WHERE c.name IN ('Nomsa', 'Johan')
        AND extract(isodow FROM day) BETWEEN 1 AND 5
    ),
    rows AS (
      SELECT p.*, s.id AS service_id, s.duration_minutes,
             (p.day::date + make_interval(hours => p.hr)) AT TIME ZONE 'Africa/Johannesburg' AS starts_at,
             p.h % 100 AS roll,
             p.day::date = (SELECT d FROM today) - 1 AS yesterday
      FROM plan p
      JOIN LATERAL (
        SELECT id, duration_minutes FROM service_types ORDER BY id OFFSET (p.h % 3) LIMIT 1
      ) s ON true
    )
    INSERT INTO appointments
      (reference, branch_id, consultant_id, service_type_id, client_id, client_email,
       starts_at, ends_at, status, outcome)
    SELECT 'APT-' || upper(substr(md5(r.day::text || r.consultant || r.hr::text), 1, 10)),
           (SELECT id FROM branches WHERE name = 'Pretoria Menlyn'),
           r.consultant_id, r.service_id,
           'demo-' || md5(r.day::text || r.consultant || r.hr::text),
           'client' || (r.h % 40) || '@demo.example',
           r.starts_at,
           r.starts_at + make_interval(mins => r.duration_minutes),
           CASE WHEN r.roll < 8 THEN 'cancelled' ELSE 'booked' END,
           CASE WHEN r.roll < 8 OR r.yesterday THEN NULL
                WHEN r.roll < 18 THEN 'no_show'
                ELSE 'attended' END
    FROM rows r
  `);
  console.log(`Added ${inserted.rowCount} demo appointments at Pretoria Menlyn.`);
} finally {
  await pool.end();
}
