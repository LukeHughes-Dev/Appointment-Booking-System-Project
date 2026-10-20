import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// This file owns Tue 26 Jan 2027 (Ayanda and Fatima work at Menlyn until 31 Jan) at Menlyn, where Ayanda, Fatima, Johan and Nomsa work.
// All times are before lunch (12:00) so a break could not get in the way.
const MENLYN = '4';
const at = (hour: number) => `2027-01-26T${String(hour - 2).padStart(2, '0')}:00:00Z`; // local = UTC + 2

const pool = createTestPool();
const app = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
let counter = 0;
const ids: Record<string, string> = {};

async function book(startsAt: string, consultantId?: string) {
  counter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/appointments',
    headers: { authorization: `Bearer ${await tokenFor({ sub: `busy-${counter}`, email: `busy${counter}@booking-test.example` })}` },
    payload: { branchId: MENLYN, service: 'Save', startsAt, ...(consultantId ? { consultantId } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return res.json().consultant.name as string;
}

beforeAll(async () => {
  const { rows } = await pool.query("SELECT id::text, name FROM consultants WHERE name IN ('Ayanda','Fatima','Johan','Nomsa')");
  for (const r of rows) ids[r.name] = r.id;
});

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'busy-%'");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('"any consultant"', () => {
  it('goes to the consultant with the fewest appointments that day, then spreads out', async () => {
    await book(at(8), ids.Ayanda); // Ayanda now has 1; first alphabetically, so she would win a tie
    expect(await book(at(9))).toBe('Fatima'); // not Ayanda
    expect(await book(at(10))).toBe('Johan');
    expect(await book(at(11))).toBe('Nomsa');
    // Everyone has one now. At 08:00 Ayanda is busy, so of the rest it is alphabetical again.
    expect(await book(at(8))).toBe('Fatima');
  });

  it('only counts the same day', async () => {
    // Ayanda is busy the day before, but on this day everyone has none, so alphabetical wins.
    await book('2027-01-25T06:00:00Z', ids.Ayanda);
    await book('2027-01-25T07:00:00Z', ids.Ayanda);
    expect(await book(at(9))).toBe('Ayanda');
  });

  it('still keeps to a named consultant, and falls back when only some are free', async () => {
    expect(await book(at(9), ids.Nomsa)).toBe('Nomsa');
    await book(at(10), ids.Ayanda);
    await book(at(10), ids.Fatima);
    await book(at(10), ids.Johan);
    expect(await book(at(10))).toBe('Nomsa'); // the only one free at 10:00
  });
});
