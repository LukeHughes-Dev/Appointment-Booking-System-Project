import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syncBreaks, type ScheduleProvider } from '../src/schedule.js';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// This file owns Tue 19 Jan to Sun 24 Jan 2027. Nomsa works at Menlyn.
const DAY = '2027-01-19';
const SUNDAY = '2027-01-24';
const MENLYN = '4';
const NOMSA = { sub: 'brk-nomsa', email: 'nomsa@example.com', roles: ['consultant'] };

const pool = createTestPool();
const app = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
const onTheDay = buildTestApp(() => new Date('2027-01-19T10:00:00Z')); // 12:00 on the day
const afterTheDay = buildTestApp(() => new Date('2027-01-20T10:00:00Z'));
let nomsaId: string;

// Everyone's lunch is 13:00 to 14:00, Monday to Friday.
const lunchAtOne: ScheduleProvider = {
  async breaks(ids, from, to) {
    const out = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      for (const consultantId of ids) {
        out.push({ consultantId, date: d.toISOString().slice(0, 10), startTime: '13:00', minutes: 60 });
      }
    }
    return out;
  },
};

async function call(method: 'GET' | 'PUT', date: string, user: object, payload?: object, target = onTheDay) {
  return target.inject({
    method,
    url: `/staff/breaks?date=${date}`,
    headers: { authorization: `Bearer ${await tokenFor(user)}` },
    payload,
  });
}
const move = (pieces: { start: string; end: string }[], date = DAY, target = onTheDay) =>
  call('PUT', date, NOMSA, { breaks: pieces }, target);

beforeAll(async () => {
  nomsaId = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Nomsa'")).rows[0].id;
});

beforeEach(async () => {
  await syncBreaks(pool, lunchAtOne, DAY, SUNDAY);
});

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'brk-%'");
  await pool.query("DELETE FROM consultant_breaks WHERE day BETWEEN '2027-01-19' AND '2027-01-24'");
  await pool.query("DELETE FROM break_changes WHERE day BETWEEN '2027-01-19' AND '2027-01-24'");
});

afterAll(async () => {
  await Promise.all([app.close(), onTheDay.close(), afterTheDay.close()]);
  await pool.end();
});

describe('GET /staff/breaks', () => {
  it('shows the day\'s break in the branch\'s local time', async () => {
    const res = await call('GET', DAY, NOMSA);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      date: DAY,
      totalMinutes: 60,
      breaks: [{ start: '13:00', end: '14:00', source: 'scheduled' }],
      clashes: [],
    });
  });

  it('needs sign-in, the consultant role, and a linked consultant', async () => {
    expect((await onTheDay.inject({ method: 'GET', url: `/staff/breaks?date=${DAY}` })).statusCode).toBe(401);
    expect((await call('GET', DAY, { sub: 'brk-x', email: 'client@example.com', roles: [] })).statusCode).toBe(403);
    expect((await call('GET', DAY, { sub: 'brk-y', email: 'nobody@example.com', roles: ['consultant'] })).statusCode).toBe(404);
  });
});

describe('PUT /staff/breaks', () => {
  it('moves the break and marks it edited', async () => {
    const res = await move([{ start: '15:00', end: '16:00' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().breaks).toEqual([{ start: '15:00', end: '16:00', source: 'edited' }]);
  });

  it('splits the break, as long as the total time stays the same', async () => {
    const res = await move([
      { start: '12:00', end: '12:30' },
      { start: '15:00', end: '15:30' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().breaks.map((b: { start: string }) => b.start)).toEqual(['12:00', '15:00']);
    expect(res.json().totalMinutes).toBe(60);
  });

  it('records who changed it, and what it was before and after', async () => {
    await move([{ start: '15:00', end: '16:00' }]);
    const { rows } = await pool.query('SELECT changed_by, before, after FROM break_changes WHERE consultant_id = $1 AND day = $2', [nomsaId, DAY]);
    expect(rows).toHaveLength(1);
    expect(rows[0].changed_by).toBe('nomsa@example.com');
    expect(rows[0].before).toEqual([{ start: '13:00', end: '14:00' }]);
    expect(rows[0].after).toEqual([{ start: '15:00', end: '16:00' }]);
  });

  it('lets an existing appointment win, and shows the clash', async () => {
    const booked = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${await tokenFor({ sub: 'brk-client', email: 'c@booking-test.example' })}` },
      payload: { branchId: MENLYN, service: 'Save', startsAt: '2027-01-19T13:00:00Z', consultantId: nomsaId }, // 15:00 local
    });
    expect(booked.statusCode).toBe(201);

    const res = await move([{ start: '15:00', end: '16:00' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().clashes.map((c: { reference: string }) => c.reference)).toEqual([booked.json().reference]);
    const row = await pool.query('SELECT status FROM appointments WHERE reference = $1', [booked.json().reference]);
    expect(row.rows[0].status).toBe('booked'); // the appointment is untouched
  });

  it('makes the old time bookable again and the new time unbookable', async () => {
    await move([{ start: '15:00', end: '16:00' }]);
    const slots = (
      await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=${DAY}&service=Save` })
    ).json() as { startsAt: string; consultants: { id: string }[] }[];
    const free = (iso: string) => slots.find((s) => s.startsAt === iso)?.consultants.map((c) => c.id) ?? [];
    expect(free('2027-01-19T11:00:00.000Z')).toContain(nomsaId); // 13:00 local, no longer lunch
    expect(free('2027-01-19T13:00:00.000Z')).not.toContain(nomsaId); // 15:00 local, now lunch
  });

  it('refuses a different total, odd times, and overlapping pieces', async () => {
    expect((await move([{ start: '13:00', end: '13:30' }])).statusCode).toBe(422);
    expect((await move([{ start: '13:10', end: '14:10' }])).statusCode).toBe(422);
    expect((await move([{ start: '13:00', end: '13:45' }, { start: '13:30', end: '13:45' }])).statusCode).toBe(422);
    expect((await move([{ start: '13:00', end: '13:45' }, { start: '13:30', end: '13:45' }])).json().error).toContain('overlap');
    expect((await call('GET', DAY, NOMSA)).json().breaks[0].source).toBe('scheduled'); // nothing changed
  });

  it('refuses days that are over, and days with no break', async () => {
    const past = await move([{ start: '15:00', end: '16:00' }], DAY, afterTheDay);
    expect(past.statusCode).toBe(409);
    expect((await move([{ start: '13:00', end: '14:00' }], SUNDAY)).statusCode).toBe(404);
  });

  it('only changes the signed-in consultant\'s own break', async () => {
    const other = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Johan'")).rows[0].id;
    await move([{ start: '15:00', end: '16:00' }]);
    const johan = await pool.query('SELECT source FROM consultant_breaks WHERE consultant_id = $1 AND day = $2', [other, DAY]);
    expect(johan.rows[0].source).toBe('scheduled');
  });

  it('keeps the day consistent when two changes arrive at the same time', async () => {
    const [a, b] = await Promise.all([
      move([{ start: '15:00', end: '16:00' }]),
      move([{ start: '12:00', end: '12:30' }, { start: '16:00', end: '16:30' }]),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS pieces, sum(extract(epoch FROM ends_at - starts_at) / 60)::int AS minutes FROM consultant_breaks WHERE consultant_id = $1 AND day = $2",
      [nomsaId, DAY],
    );
    expect(rows[0].minutes).toBe(60); // never doubled, never lost
    const log = await pool.query('SELECT count(*)::int AS n FROM break_changes WHERE consultant_id = $1 AND day = $2', [nomsaId, DAY]);
    expect(log.rows[0].n).toBe(2);
  });
});
