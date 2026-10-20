import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

// Read-only: nothing is booked here. The clock is fixed before every date used.
const app = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
const MENLYN = '4';
const SANDTON = '1';

afterAll(() => app.close());

// The last time a 60-minute Save can start, in the branch's local time (South Africa is UTC+2).
async function lastSaveStart(branchId: string, date: string) {
  const res = await app.inject({ method: 'GET', url: `/branches/${branchId}/slots?date=${date}&service=Save` });
  const slots = res.json() as { startsAt: string }[];
  const last = slots.at(-1)?.startsAt;
  return last ? new Date(new Date(last).getTime() + 2 * 3600_000).toISOString().slice(11, 16) : null;
}

describe('month-end trading hours (25th to the 1st, weekdays until 17:30)', () => {
  it('keeps the normal 17:00 close on ordinary weekdays', async () => {
    expect(await lastSaveStart(MENLYN, '2027-01-18')).toBe('16:00'); // Mon 18th
    expect(await lastSaveStart(MENLYN, '2027-02-02')).toBe('16:00'); // Tue 2nd
    expect(await lastSaveStart(MENLYN, '2027-02-24')).toBe('16:00'); // Wed 24th, the day before
  });

  it('closes at 17:30 on weekdays from the 25th', async () => {
    expect(await lastSaveStart(MENLYN, '2027-01-25')).toBe('16:30'); // Mon 25th
    expect(await lastSaveStart(MENLYN, '2027-01-29')).toBe('16:30'); // Fri 29th
    expect(await lastSaveStart(MENLYN, '2027-02-25')).toBe('16:30'); // Thu 25th, the next month
  });

  it('includes the 1st of the next month, which crosses the month end', async () => {
    expect(await lastSaveStart(MENLYN, '2027-02-01')).toBe('16:30'); // Mon 1st
    expect(await lastSaveStart(MENLYN, '2026-12-01')).toBe('16:30'); // Tue 1 December
  });

  it('does not change weekends', async () => {
    expect(await lastSaveStart(MENLYN, '2027-01-30')).toBe('12:00'); // Sat 30th: closes 13:00, so the last hour starts at 12:00
    expect(await lastSaveStart(SANDTON, '2027-01-31')).toBe('12:00'); // Sun 31st: closes 13:00
  });

  it('is not limited to one month length: the rule works over a month with 30 days', async () => {
    expect(await lastSaveStart(MENLYN, '2027-04-30')).toBe('16:30'); // Fri 30 April
    expect(await lastSaveStart(MENLYN, '2027-05-03')).toBe('16:00'); // Mon 3 May
  });

  it('opens up longer slots for a 90-minute service too', async () => {
    const res = await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=2027-01-25&service=Credit` });
    const last = (res.json() as { startsAt: string }[]).at(-1)!.startsAt;
    expect(new Date(new Date(last).getTime() + 2 * 3600_000).toISOString().slice(11, 16)).toBe('16:00'); // 16:00 + 90 = 17:30
  });
});
