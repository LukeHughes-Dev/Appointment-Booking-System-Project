// Fills the system with believable appointments (fictional clients), so every screen has
// something to show and the system can be judged working, not blank.
//
//   npm run seed:demo
//
//   Past, last 3 weeks:   every consultant, every branch, weekdays: attended, no-show, cancelled.
//                         The latest working day is left "not recorded", so the manager summary
//                         and My day show what still needs a decision.
//   Next 2 weeks:         about half of the usual times booked, so branches look busy but not full.
//
// The mix looks random but is derived from a hash, so every run gives the same data. Safe to run
// again: it replaces its own rows (client ids starting "demo-") and nothing else. The app itself
// cannot book the past, which is why this goes straight to the database.
import { createPool } from '../src/db.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

const pool = createPool(databaseUrl);

// Working days from `from` to `to` (offsets from today, in South Africa), for each consultant at
// the branch they work at that day, skipping closed branches. Three times a day.
const plan = (hours: string, from: string, to: string) => `
  SELECT g.day::date AS day, a.consultant_id, c.name AS consultant, a.branch_id, br.timezone, hr,
         abs(hashtext(g.day::date::text || c.name || hr::text)) AS h
  FROM generate_series(
         (SELECT d FROM today) + ${from}, (SELECT d FROM today) + ${to}, interval '1 day') AS g(day)
  JOIN consultant_assignments a ON g.day::date BETWEEN a.valid_from AND coalesce(a.valid_to, 'infinity')
  JOIN consultants c ON c.id = a.consultant_id AND c.is_active
  JOIN branches br ON br.id = a.branch_id
  CROSS JOIN unnest(ARRAY[${hours}]) AS hr
  WHERE extract(isodow FROM g.day) BETWEEN 1 AND 5
    AND NOT EXISTS (
      SELECT 1 FROM branch_closures x
      WHERE x.branch_id = a.branch_id AND g.day::date BETWEEN x.closed_from AND x.closed_to)`;

const withToday = `
  today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
  -- The latest working day before today: yesterday, or the Friday if that is a weekend.
  last_working AS (
    SELECT CASE extract(isodow FROM d)::int WHEN 1 THEN d - 3 WHEN 7 THEN d - 2 ELSE d - 1 END AS d
    FROM today
  )`;

const insert = (source: string, status: string, outcome: string, where: string) => `
  WITH ${withToday},
  plan AS (${source}),
  rows AS (
    SELECT p.*, s.id AS service_id, s.duration_minutes,
           (p.day + make_interval(hours => p.hr)) AT TIME ZONE p.timezone AS starts_at,
           p.h % 100 AS roll
    FROM plan p
    JOIN LATERAL (
      SELECT id, duration_minutes FROM service_types ORDER BY id OFFSET (p.h % 3) LIMIT 1
    ) s ON true
  )
  INSERT INTO appointments
    (reference, branch_id, consultant_id, service_type_id, client_id, client_email,
     starts_at, ends_at, status, outcome)
  SELECT 'APT-' || upper(substr(md5(r.day::text || r.consultant || r.hr::text), 1, 10)),
         r.branch_id, r.consultant_id, r.service_id,
         'demo-' || md5(r.day::text || r.consultant || r.hr::text),
         'client' || (r.h % 40) || '@demo.example',
         r.starts_at,
         r.starts_at + make_interval(mins => r.duration_minutes),
         ${status}, ${outcome}
  FROM rows r
  WHERE ${where}`;

try {
  await pool.query('BEGIN');
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'demo-%'");

  const past = await pool.query(
    insert(
      plan('9, 11, 14', '-21', '-1'),
      "CASE WHEN r.roll < 8 THEN 'cancelled' ELSE 'booked' END",
      `CASE WHEN r.roll < 8 OR r.day = (SELECT d FROM last_working) THEN NULL
            WHEN r.roll < 18 THEN 'no_show' ELSE 'attended' END`,
      'true',
    ),
  );

  // Future times keep clear of lunch breaks and of anything already booked, so nothing clashes.
  const overlap = (table: string, alias: string, extra: string) => `
    NOT EXISTS (
      SELECT 1 FROM ${table} ${alias}
      WHERE ${alias}.consultant_id = r.consultant_id ${extra}
        AND tstzrange(${alias}.starts_at, ${alias}.ends_at, '[)')
            && tstzrange(r.starts_at, r.starts_at + make_interval(mins => r.duration_minutes), '[)'))`;
  const future = await pool.query(
    insert(
      plan('9, 11, 15', '1', '14'),
      "'booked'",
      'NULL',
      `r.roll < 55 AND ${overlap('consultant_breaks', 'b', '')} AND ${overlap('appointments', 'x', "AND x.status = 'booked'")}`,
    ),
  );

  await pool.query('COMMIT');
  console.log(`Added ${past.rowCount} past and ${future.rowCount} upcoming demo appointments.`);
} catch (err) {
  await pool.query('ROLLBACK');
  throw err;
} finally {
  await pool.end();
}
