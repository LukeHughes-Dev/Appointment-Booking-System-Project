import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

// Fixed clock: 20 Nov 2026, 08:00 in South Africa. The tests below all look at later dates.
const fixedNow = () => new Date('2026-11-20T06:00:00Z');

const MENLYN = 4;
const HATFIELD = 6;
const SANDTON = 1;

async function getSlots(branchId: number, query: string, now = fixedNow) {
  const app = buildTestApp(now);
  const res = await app.inject({ method: 'GET', url: `/branches/${branchId}/slots?${query}` });
  await app.close();
  return res;
}

describe('GET /branches/:id/slots', () => {
  it('lists every 15 minutes from opening to the last slot that still finishes by closing', async () => {
    const res = await getSlots(MENLYN, 'date=2026-12-01&service=Save');
    const slots = res.json();
    expect(res.statusCode).toBe(200);
    expect(slots).toHaveLength(33); // 08:00 to 16:00 inclusive
    expect(slots[0].startsAt).toBe('2026-12-01T06:00:00.000Z'); // 08:00 in Johannesburg
    expect(slots.at(-1).endsAt).toBe('2026-12-01T15:00:00.000Z'); // ends at 17:00 closing
    expect(slots[0].consultants.map((c: { name: string }) => c.name)).toEqual([
      'Ayanda', 'Fatima', 'Johan', 'Nomsa',
    ]);
    expect(slots[0].available).toBe(true);
  });

  it('gives no slots while the branch is closed for its revamp', async () => {
    const res = await getSlots(HATFIELD, 'date=2026-12-01&service=Save');
    expect(res.json()).toEqual([]);
  });

  it('gives no slots on a Sunday at a branch that does not trade on Sundays', async () => {
    const res = await getSlots(MENLYN, 'date=2026-12-06&service=Save');
    expect(res.json()).toEqual([]);
  });

  it('trades on Sundays where hours exist', async () => {
    const res = await getSlots(SANDTON, 'date=2026-12-06&service=Save');
    expect(res.json()).toHaveLength(13); // 09:00 to 12:00
  });

  it('keeps longer services inside opening hours', async () => {
    const res = await getSlots(MENLYN, 'date=2026-12-01&service=Credit');
    const slots = res.json();
    expect(slots.at(-1).startsAt).toBe('2026-12-01T13:30:00.000Z'); // 15:30 local
    expect(slots.at(-1).endsAt).toBe('2026-12-01T15:00:00.000Z'); // 17:00 local
  });

  it('hides slots closer than 30 minutes from now', async () => {
    const now = () => new Date('2026-12-01T07:40:00Z'); // 09:40 local
    const res = await getSlots(MENLYN, 'date=2026-12-01&service=Save', now);
    expect(res.json()[0].startsAt).toBe('2026-12-01T08:15:00.000Z'); // 10:15 local
  });

  it('shows nothing for a date that has already passed', async () => {
    const now = () => new Date('2026-12-02T07:00:00Z');
    const res = await getSlots(MENLYN, 'date=2026-12-01&service=Save', now);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 for an unknown branch or service and 400 for a bad date', async () => {
    expect((await getSlots(999, 'date=2026-12-01&service=Save')).statusCode).toBe(404);
    expect((await getSlots(MENLYN, 'date=2026-12-01&service=Nope')).statusCode).toBe(404);
    expect((await getSlots(MENLYN, 'date=tomorrow&service=Save')).statusCode).toBe(400);
  });
});
