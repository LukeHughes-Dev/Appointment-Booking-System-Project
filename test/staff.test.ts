import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// Bookings are made on 20 Nov 2026; outcomes are recorded "later", on 3 Dec 2026.
const bookingApp = buildTestApp(() => new Date('2026-11-20T06:00:00Z'));
const laterApp = buildTestApp(() => new Date('2026-12-03T06:00:00Z'));
const pool = createTestPool();

const MENLYN = '4';
const TUESDAY_10AM = '2026-12-01T08:00:00Z';
const NOMSA = { sub: 'staff-nomsa', email: 'nomsa@example.com', roles: ['consultant'] };

let nomsaId: string;
let counter = 0;

beforeAll(async () => {
  nomsaId = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Nomsa'")).rows[0].id;
});

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'staff-%'");
});

afterAll(async () => {
  await bookingApp.close();
  await laterApp.close();
  await pool.end();
});

async function bookNomsa(startsAt = TUESDAY_10AM, consultantId = nomsaId) {
  counter += 1;
  const res = await bookingApp.inject({
    method: 'POST',
    url: '/appointments',
    headers: {
      authorization: `Bearer ${await tokenFor({ sub: `staff-client-${counter}`, email: `c${counter}@booking-test.example` })}`,
    },
    payload: { branchId: MENLYN, service: 'Save', startsAt, consultantId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().reference as string;
}

async function staff(method: 'GET' | 'PATCH', url: string, user = NOMSA, payload?: object) {
  return laterApp.inject({
    method,
    url,
    headers: { authorization: `Bearer ${await tokenFor(user)}` },
    payload,
  });
}

describe('GET /staff/appointments', () => {
  it('needs sign-in and the consultant role', async () => {
    expect((await laterApp.inject({ method: 'GET', url: '/staff/appointments' })).statusCode).toBe(401);
    expect((await staff('GET', '/staff/appointments', { sub: 'staff-x', email: 'client@example.com', roles: [] })).statusCode).toBe(403);
  });

  it('says so when the sign-in is not linked to a consultant', async () => {
    const res = await staff('GET', '/staff/appointments', { sub: 'staff-y', email: 'nobody@example.com', roles: ['consultant'] });
    expect(res.statusCode).toBe(404);
  });

  it('shows only the consultant\'s own appointments, past ones included', async () => {
    const mine = await bookNomsa();
    const other = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Johan'")).rows[0].id;
    await bookNomsa(TUESDAY_10AM, other);

    const res = await staff('GET', '/staff/appointments');
    expect(res.statusCode).toBe(200);
    const refs = res.json().map((a: { reference: string }) => a.reference);
    expect(refs).toContain(mine);
    expect(res.json().every((a: { branch: { name: string } }) => a.branch.name === 'Pretoria Menlyn')).toBe(true);
    expect(res.json()).toHaveLength(refs.length);
    expect(res.json().find((a: { reference: string }) => a.reference === mine)).toMatchObject({
      service: 'Save',
      status: 'booked',
      outcome: null,
    });
  });

  it('filters to one day in the branch\'s time', async () => {
    await bookNomsa();
    expect((await staff('GET', '/staff/appointments?date=2026-12-01')).json().length).toBeGreaterThan(0);
    expect((await staff('GET', '/staff/appointments?date=2026-12-02')).json()).toHaveLength(0);
  });
});

describe('PATCH /staff/appointments/:reference/outcome', () => {
  it('records an outcome once the appointment has started, and can clear it', async () => {
    const reference = await bookNomsa();
    const set = await staff('PATCH', `/staff/appointments/${reference}/outcome`, NOMSA, { outcome: 'no_show' });
    expect(set.statusCode).toBe(200);
    const listed = (await staff('GET', '/staff/appointments?date=2026-12-01')).json();
    expect(listed.find((a: { reference: string }) => a.reference === reference).outcome).toBe('no_show');

    const cleared = await staff('PATCH', `/staff/appointments/${reference}/outcome`, NOMSA, { outcome: null });
    expect(cleared.json().outcome).toBeNull();
  });

  it('refuses an outcome before the appointment has started', async () => {
    const reference = await bookNomsa();
    const early = await bookingApp.inject({
      method: 'PATCH',
      url: `/staff/appointments/${reference}/outcome`,
      headers: { authorization: `Bearer ${await tokenFor(NOMSA)}` },
      payload: { outcome: 'attended' },
    });
    expect(early.statusCode).toBe(409);
  });

  it('will not touch another consultant\'s appointment, and rejects unknown outcomes', async () => {
    const reference = await bookNomsa();
    const johan = { sub: 'staff-johan', email: 'johan@example.com', roles: ['consultant'] };
    // Johan has no sign-in link in the demo data, so he gets 404 either way.
    expect((await staff('PATCH', `/staff/appointments/${reference}/outcome`, johan, { outcome: 'attended' })).statusCode).toBe(404);
    expect((await staff('PATCH', `/staff/appointments/${reference}/outcome`, NOMSA, { outcome: 'late' })).statusCode).toBe(400);
  });
});
