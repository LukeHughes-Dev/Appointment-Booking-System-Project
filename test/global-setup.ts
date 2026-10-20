import { createTestPool } from './helpers.js';

// A running dev server copies breaks into the database for the next four weeks. The booking
// tests use fixed dates from 20 Nov to Dec 2026 and assume nobody is on a break, so clear any
// breaks on those dates before the run. (The break tests use their own dates in 2027.)
export default async function setup() {
  const pool = createTestPool();
  await pool.query("DELETE FROM consultant_breaks WHERE day BETWEEN '2026-11-20' AND '2026-12-31'");
  await pool.end();
}
