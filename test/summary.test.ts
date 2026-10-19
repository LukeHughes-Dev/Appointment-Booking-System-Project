import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// Bookings are made on 20 Nov 2026; the summary is read "later", on 10 Dec 2026.
const bookingApp = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
const laterApp = buildTestApp(() => new Date('2026-12-10T06:00:00Z'));
const pool = createTestPool();

const MENLYN = '4';
const MONDAY = '2026-12-07';
const MANAGER = { sub: 'summary-manager', email: 'manager@example.com', roles: ['manager'] };
const NOMSA = { sub: 'summary-nomsa', email: 'nomsa@example.com', roles: ['consultant'] };

let nomsaId: string;
let counter = 0;

beforeAll(async () => {
  nomsaId = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Nomsa'")).rows[0].id;
});
afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'summary-%'");
});
afterAll(async () => {
  await bookingApp.close();
  await laterApp.close();
  await pool.end();
});

async function bookNomsa(startsAt: string) {
  counter += 1;
  const client = { sub: `summary-client-${counter}`, email: `s${counter}@booking-test.example` };
  const res = await bookingApp.inject({
    method: 'POST',
    url: '/appointments',
    headers: { authorization: `Bearer ${await tokenFor(client)}` },
    payload: { branchId: MENLYN, service: 'Transact', startsAt, consultantId: nomsaId },
  });
  expect(res.statusCode).toBe(201);
  return { reference: res.json().reference as string, client };
}

async function summary(query: string, user = MANAGER) {
  return laterApp.inject({
    method: 'GET',
    url: `/staff/summary${query}`,
    headers: { authorization: `Bearer ${await tokenFor(user)}` },
  });
}

describe('GET /staff/summary', () => {
  it('is for managers only', async () => {
    expect((await laterApp.inject({ method: 'GET', url: `/staff/summary?from=${MONDAY}&to=${MONDAY}` })).statusCode).toBe(401);
    expect((await summary(`?from=${MONDAY}&to=${MONDAY}`, NOMSA)).statusCode).toBe(403);
  });

  it('rejects a backwards or far too long period', async () => {
    expect((await summary('?from=2026-12-08&to=2026-12-07')).statusCode).toBe(400);
    expect((await summary('?from=2020-01-01&to=2026-12-07')).statusCode).toBe(400);
    expect((await summary('?from=2026-12-07')).statusCode).toBe(400);
  });

  it('counts attended, no-show, not recorded and cancelled per branch and consultant', async () => {
    const attended = await bookNomsa('2026-12-07T06:00:00Z'); // 08:00
    const noShow = await bookNomsa('2026-12-07T06:30:00Z');
    await bookNomsa('2026-12-07T07:00:00Z'); // outcome left empty
    const cancelled = await bookNomsa('2026-12-07T07:30:00Z');

    for (const [booking, outcome] of [[attended, 'attended'], [noShow, 'no_show']] as const) {
      const res = await laterApp.inject({
        method: 'PATCH',
        url: `/staff/appointments/${booking.reference}/outcome`,
        headers: { authorization: `Bearer ${await tokenFor(NOMSA)}` },
        payload: { outcome },
      });
      expect(res.statusCode).toBe(200);
    }
    await bookingApp.inject({
      method: 'DELETE',
      url: `/appointments/${cancelled.reference}`,
      headers: { authorization: `Bearer ${await tokenFor(cancelled.client)}` },
    });

    const res = await summary(`?from=${MONDAY}&to=${MONDAY}`);
    expect(res.statusCode).toBe(200);
    const menlyn = res.json().find((b: { branch: { id: string } }) => b.branch.id === MENLYN);
    const counts = { upcoming: 0, attended: 1, noShow: 1, notRecorded: 1, cancelled: 1 };
    expect(menlyn.totals).toEqual(counts);
    expect(menlyn.consultants).toEqual([{ consultant: { id: nomsaId, name: 'Nomsa' }, ...counts }]);
  });

  it('only counts the chosen days', async () => {
    await bookNomsa('2026-12-07T06:00:00Z');
    expect((await summary('?from=2026-12-08&to=2026-12-09')).json()).toEqual([]);
  });

  it('counts a future appointment as upcoming', async () => {
    await bookNomsa('2026-12-07T06:00:00Z');
    const early = await bookingApp.inject({
      method: 'GET',
      url: `/staff/summary?from=${MONDAY}&to=${MONDAY}`,
      headers: { authorization: `Bearer ${await tokenFor(MANAGER)}` },
    });
    expect(early.json()[0].totals.upcoming).toBe(1);
  });
});
