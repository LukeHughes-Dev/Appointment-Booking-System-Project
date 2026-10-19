import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

// Fixed clock: 20 Nov 2026, so Hatfield is inside its revamp closure (2 Nov 2026 to 31 Jan 2027).
const app = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
afterAll(() => app.close());

type Branch = { name: string; distanceKm: number | null; closure: { from: string; to: string } | null };

async function list(query = '') {
  const res = await app.inject({ method: 'GET', url: `/branches${query}` });
  return { res, branches: res.json() as Branch[] };
}

describe('GET /branches', () => {
  it('lists the seeded branches by name, with their position', async () => {
    const { res, branches } = await list();
    expect(res.statusCode).toBe(200);
    expect(branches).toHaveLength(6);
    expect(branches.map((b) => b.name)).toEqual([...branches.map((b) => b.name)].sort());
    expect(branches[0]).toMatchObject({ latitude: expect.any(Number), longitude: expect.any(Number) });
    expect(branches[0]?.distanceKm).toBeNull();
  });

  it('shows the revamp closure on the branch that is closed today', async () => {
    const { branches } = await list();
    const hatfield = branches.find((b) => b.name === 'Pretoria Hatfield');
    expect(hatfield?.closure).toMatchObject({ from: '2026-11-02', to: '2027-01-31' });
    expect(branches.filter((b) => b.closure)).toHaveLength(1);
  });

  it('shows no closure once the revamp is over', async () => {
    const later = buildTestApp(() => new Date('2027-02-05T06:00:00Z'));
    const res = await later.inject({ method: 'GET', url: '/branches' });
    await later.close();
    expect((res.json() as Branch[]).every((b) => b.closure === null)).toBe(true);
  });

  it('sorts by distance from the client, nearest first', async () => {
    // Standing in Pretoria East, close to Menlyn.
    const { branches } = await list('?lat=-25.78&lng=28.28');
    expect(branches.slice(0, 3).map((b) => b.name)).toEqual([
      'Pretoria Menlyn',
      'Pretoria Hatfield',
      'Pretoria Centurion',
    ]);
    expect(branches[0]?.distanceKm).toBeLessThan(2);
    // Cape Town is about 1,200 km away.
    const capeTown = branches.find((b) => b.name === 'Cape Town Waterfront');
    expect(capeTown?.distanceKm).toBeGreaterThan(1000);
    expect(branches.at(-1)?.name).toBe('Cape Town Waterfront');
  });

  it('searches by part of the name, ignoring case', async () => {
    const { branches } = await list('?q=pretoria');
    expect(branches).toHaveLength(3);
    expect((await list('?q=nowhere')).branches).toEqual([]);
  });

  it('treats % and _ in a search as plain characters', async () => {
    expect((await list('?q=%25')).branches).toEqual([]);
  });

  it('combines search with distance', async () => {
    const { branches } = await list('?q=pretoria&lat=-25.86&lng=28.19');
    expect(branches.map((b) => b.name)[0]).toBe('Pretoria Centurion');
  });

  it('rejects an impossible or incomplete position', async () => {
    expect((await list('?lat=95&lng=10')).res.statusCode).toBe(400);
    expect((await list('?lat=10')).res.statusCode).toBe(400);
  });
});
