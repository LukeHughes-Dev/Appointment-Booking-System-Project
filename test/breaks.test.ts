import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { simulatedSchedule, syncBreaks, type ScheduleProvider } from '../src/schedule.js';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// This file owns Mon 11 Jan to Sun 17 Jan 2027. At Menlyn, Nomsa, Johan, Ayanda and Fatima work.
const MONDAY = '2027-01-11';
const TUESDAY = '2027-01-12';
const SUNDAY = '2027-01-17';
const MENLYN = '4';

const pool = createTestPool();
const app = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
let nomsaId: string;

const lunchAt = (hour: string): ScheduleProvider => ({
  async breaks(ids, from, to) {
    const all = await simulatedSchedule.breaks(ids, from, to);
    return all.map((b) => ({ ...b, startTime: hour }));
  },
});

async function breaksOn(date: string, consultantId = nomsaId) {
  const { rows } = await pool.query(
    `SELECT to_char(starts_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') AS start, source,
            (extract(epoch FROM ends_at - starts_at) / 60)::int AS minutes
     FROM consultant_breaks WHERE consultant_id = $1 AND day = $2 ORDER BY starts_at`,
    [consultantId, date],
  );
  return rows as { start: string; source: string; minutes: number }[];
}

beforeAll(async () => {
  nomsaId = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Nomsa'")).rows[0].id;
});

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'breaks-%'");
  await pool.query("DELETE FROM consultant_breaks WHERE day BETWEEN '2027-01-11' AND '2027-01-17'");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('the simulated schedule', () => {
  it('gives one hour on the hour, Monday to Friday only, at lunch time', async () => {
    const feed = await simulatedSchedule.breaks([nomsaId], MONDAY, SUNDAY);
    expect(feed.map((b) => b.date)).toEqual([
      '2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15',
    ]);
    for (const b of feed) {
      expect(b.minutes).toBe(60);
      expect(['12:00', '13:00', '14:00']).toContain(b.startTime);
    }
  });

  it('is the same every time it is asked', async () => {
    expect(await simulatedSchedule.breaks([nomsaId], MONDAY, SUNDAY)).toEqual(
      await simulatedSchedule.breaks([nomsaId], MONDAY, SUNDAY),
    );
  });
});

describe('syncBreaks', () => {
  it('writes a one-hour break per weekday for the consultant, and none at the weekend', async () => {
    await syncBreaks(pool, simulatedSchedule, MONDAY, SUNDAY);
    for (const date of [MONDAY, TUESDAY, '2027-01-15']) {
      const rows = await breaksOn(date);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.minutes).toBe(60);
      expect(rows[0]!.source).toBe('scheduled');
    }
    expect(await breaksOn(SUNDAY)).toHaveLength(0);
  });

  it('can run again without creating duplicates', async () => {
    await syncBreaks(pool, simulatedSchedule, MONDAY, SUNDAY);
    await syncBreaks(pool, simulatedSchedule, MONDAY, SUNDAY);
    expect(await breaksOn(TUESDAY)).toHaveLength(1);
  });

  it('follows the feed when it changes a break that nobody edited', async () => {
    await syncBreaks(pool, lunchAt('12:00'), MONDAY, MONDAY);
    expect((await breaksOn(MONDAY))[0]!.start).toBe('12:00');
    await syncBreaks(pool, lunchAt('14:00'), MONDAY, MONDAY);
    expect(await breaksOn(MONDAY)).toMatchObject([{ start: '14:00', source: 'scheduled' }]);
  });

  it('never overwrites a day that staff have edited', async () => {
    await syncBreaks(pool, lunchAt('12:00'), MONDAY, MONDAY);
    // Staff move Nomsa's lunch to 15:00 that day.
    await pool.query(
      `UPDATE consultant_breaks SET source = 'edited',
         starts_at = ('2027-01-11 15:00'::timestamp AT TIME ZONE 'Africa/Johannesburg'),
         ends_at   = ('2027-01-11 16:00'::timestamp AT TIME ZONE 'Africa/Johannesburg')
       WHERE consultant_id = $1 AND day = $2`,
      [nomsaId, MONDAY],
    );
    const result = await syncBreaks(pool, lunchAt('13:00'), MONDAY, MONDAY);
    expect(result.keptEdited).toBeGreaterThan(0);
    expect(await breaksOn(MONDAY)).toMatchObject([{ start: '15:00', source: 'edited' }]);
  });

  it('does not let one consultant have overlapping breaks', async () => {
    await syncBreaks(pool, lunchAt('12:00'), MONDAY, MONDAY);
    await expect(
      pool.query(
        `INSERT INTO consultant_breaks (consultant_id, day, starts_at, ends_at)
         SELECT $1, $2::date, starts_at + interval '30 minutes', ends_at + interval '30 minutes'
         FROM consultant_breaks WHERE consultant_id = $1 AND day = $2`,
        [nomsaId, MONDAY],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });
});

describe('breaks and booking', () => {
  async function slotsOn(date: string) {
    const res = await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=${date}&service=Save` });
    return res.json() as { startsAt: string; consultants: { id: string }[] }[];
  }

  it('takes a consultant off the slots that overlap their break', async () => {
    await syncBreaks(pool, lunchAt('13:00'), TUESDAY, TUESDAY);
    const slots = await slotsOn(TUESDAY);
    const during = slots.find((s) => s.startsAt === '2027-01-12T11:00:00.000Z'); // 13:00 local
    const before = slots.find((s) => s.startsAt === '2027-01-12T09:00:00.000Z'); // 11:00 local
    expect(during?.consultants.map((c) => c.id)).not.toContain(nomsaId);
    expect(before?.consultants.map((c) => c.id)).toContain(nomsaId);
    // A slot that starts before the break but runs into it is also not available.
    const overlapping = slots.find((s) => s.startsAt === '2027-01-12T10:30:00.000Z'); // 12:30 local
    expect(overlapping?.consultants.map((c) => c.id)).not.toContain(nomsaId);
  });

  it('refuses to book a consultant who is on their break', async () => {
    await syncBreaks(pool, lunchAt('13:00'), TUESDAY, TUESDAY);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { authorization: `Bearer ${await tokenFor({ sub: 'breaks-client', email: 'b@booking-test.example' })}` },
      payload: { branchId: MENLYN, service: 'Save', startsAt: '2027-01-12T11:00:00Z', consultantId: nomsaId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('leaves nobody free when everyone is on lunch', async () => {
    await syncBreaks(pool, lunchAt('13:00'), TUESDAY, TUESDAY);
    // The feed puts every consultant on lunch at 13:00, so the slot has nobody free.
    const slots = await slotsOn(TUESDAY);
    expect(slots.find((s) => s.startsAt === '2027-01-12T11:00:00.000Z')?.consultants).toHaveLength(0);
  });
});
