import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// Fixed clock: 20 Nov 2026, 08:00 in South Africa. Every booking below is for later dates.
const fixedNow = () => new Date('2026-11-20T06:00:00Z');

const MENLYN = '4';
const HATFIELD = '6';
const WEDNESDAY_10AM = '2026-12-02T08:00:00Z'; // 10:00 in Johannesburg

const pool = createTestPool();
const app = buildTestApp(fixedNow);
let counter = 0;

// Each call is a different signed-in client, unless one is given.
async function book(body: Record<string, unknown>, client?: { sub: string; email: string }) {
  counter += 1;
  const who = client ?? { sub: `test-client-${counter}`, email: `client${counter}@booking-test.example` };
  return app.inject({
    method: 'POST',
    url: '/appointments',
    headers: { authorization: `Bearer ${await tokenFor(who)}` },
    payload: { branchId: MENLYN, service: 'Save', startsAt: WEDNESDAY_10AM, ...body },
  });
}

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'test-%'");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('POST /appointments', () => {
  it('books a slot and returns a reference and a simulated confirmation', async () => {
    const res = await book({});
    const body = res.json();
    expect(res.statusCode).toBe(201);
    expect(body.reference).toMatch(/^APT-[0-9A-F]{10}$/);
    expect(body.status).toBe('booked');
    expect(body.branch.name).toBe('Pretoria Menlyn');
    expect(body.startsAt).toBe('2026-12-02T08:00:00.000Z');
    expect(body.endsAt).toBe('2026-12-02T09:00:00.000Z'); // Save takes 60 minutes
    expect(body.confirmation.message).toContain(body.reference);
    expect(body.confirmation.message).toContain('10:00');
  });

  it('records the booking against the signed-in client, not anything in the body', async () => {
    const res = await book({}, { sub: 'test-luke', email: 'luke@booking-test.example' });
    expect(res.json().clientEmail).toBe('luke@booking-test.example');
    const row = await pool.query('SELECT client_id FROM appointments WHERE reference = $1', [res.json().reference]);
    expect(row.rows[0].client_id).toBe('test-luke');
  });

  it('requires sign-in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      payload: { branchId: MENLYN, service: 'Save', startsAt: WEDNESDAY_10AM },
    });
    expect(res.statusCode).toBe(401);
  });

  it('ignores an email sent in the body and uses the one in the token', async () => {
    const res = await book(
      { clientEmail: 'someone.else@example.com' },
      { sub: 'test-real', email: 'real@booking-test.example' },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().clientEmail).toBe('real@booking-test.example');
  });

  it('books the consultant the client asked for', async () => {
    const slots = await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=2026-12-02&service=Save` });
    const johan = slots.json()[8].consultants.find((c: { name: string }) => c.name === 'Johan');
    const res = await book({ consultantId: johan.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().consultant.name).toBe('Johan');
  });

  it('removes the consultant from the slot list once booked', async () => {
    const res = await book({});
    const bookedId = res.json().consultant.id;
    const slots = await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=2026-12-02&service=Save` });
    const at10 = slots.json().find((s: { startsAt: string }) => s.startsAt === '2026-12-02T08:00:00.000Z');
    expect(at10.consultants).toHaveLength(3);
    expect(at10.consultants.map((c: { id: string }) => c.id)).not.toContain(bookedId);
  });

  it('refuses a second booking for the same consultant and time with 409', async () => {
    const first = await book({});
    const consultantId = first.json().consultant.id;
    const second = await book({ consultantId });
    expect(second.statusCode).toBe(409);
  });

  it('lets exactly one of two simultaneous bookings for the same consultant succeed', async () => {
    const slots = await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=2026-12-02&service=Save` });
    const consultantId = slots.json()[8].consultants[0].id;
    const results = await Promise.all([book({ consultantId }), book({ consultantId })]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
  });

  it('spreads simultaneous bookings across consultants, then runs out', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => book({})));
    const created = results.filter((r) => r.statusCode === 201);
    expect(created).toHaveLength(4); // Menlyn has four consultants that day
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
    const names = created.map((r) => r.json().consultant.id);
    expect(new Set(names).size).toBe(4);
  });

  it('allows back-to-back appointments for the same consultant', async () => {
    const first = await book({});
    const consultantId = first.json().consultant.id;
    const next = await book({ consultantId, startsAt: '2026-12-02T09:00:00Z' }); // 11:00 local
    expect(next.statusCode).toBe(201);
  });

  it('rejects times the branch does not offer with 422', async () => {
    expect((await book({ startsAt: '2026-12-02T08:07:00Z' })).statusCode).toBe(422); // off the 15-minute grid
    expect((await book({ branchId: HATFIELD })).statusCode).toBe(422); // closed for the revamp
    expect((await book({ startsAt: '2026-12-06T08:00:00Z' })).statusCode).toBe(422); // Sunday, Menlyn is shut
    expect((await book({ startsAt: '2026-11-20T06:10:00Z' })).statusCode).toBe(422); // less than 30 minutes ahead
  });

  it('rejects bad input', async () => {
    expect((await book({ consultantId: 'abc' })).statusCode).toBe(400);
    expect((await book({ startsAt: 'tomorrow' })).statusCode).toBe(400);
    expect((await book({ branchId: '999' })).statusCode).toBe(404);
    expect((await book({ service: 'Nope' })).statusCode).toBe(404);
  });
});

describe('GET /appointments', () => {
  const alice = { sub: 'test-alice', email: 'alice@booking-test.example' };
  const bob = { sub: 'test-bob', email: 'bob@booking-test.example' };

  async function mine(who: { sub: string; email: string }, from = app) {
    return from.inject({
      method: 'GET',
      url: '/appointments',
      headers: { authorization: `Bearer ${await tokenFor(who)}` },
    });
  }

  it('lists only the signed-in client\'s booked appointments, soonest first', async () => {
    await book({ startsAt: '2026-12-03T10:00:00Z' }, alice); // later one first, to prove the ordering
    await book({ startsAt: '2026-12-02T08:00:00Z' }, alice);
    await book({ startsAt: '2026-12-02T08:00:00Z' }, bob);

    const res = await mine(alice);
    const list = res.json();
    expect(res.statusCode).toBe(200);
    expect(list).toHaveLength(2);
    expect(list.map((a: { startsAt: string }) => a.startsAt)).toEqual([
      '2026-12-02T08:00:00.000Z',
      '2026-12-03T10:00:00.000Z',
    ]);
    expect(list[0]).toMatchObject({
      status: 'booked',
      service: 'Save',
      branch: { name: 'Pretoria Menlyn', timezone: 'Africa/Johannesburg' },
    });
    expect(list[0].reference).toMatch(/^APT-/);
    expect(list[0].consultant.name).toEqual(expect.any(String));
  });

  it('never shows one client another client\'s appointments', async () => {
    await book({}, alice);
    expect((await mine(bob)).json()).toEqual([]);
  });

  it('leaves out cancelled appointments', async () => {
    const booked = await book({}, alice);
    await pool.query("UPDATE appointments SET status = 'cancelled' WHERE reference = $1", [booked.json().reference]);
    expect((await mine(alice)).json()).toEqual([]);
  });

  it('leaves out appointments that are already over', async () => {
    await book({}, alice); // 2 December, 10:00 to 11:00 local
    const later = buildTestApp(() => new Date('2026-12-02T09:30:00Z')); // 11:30 local that day
    const res = await mine(alice, later);
    await later.close();
    expect(res.json()).toEqual([]);
  });

  it('requires sign-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/appointments' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /appointments/:reference', () => {
  const alice = { sub: 'test-alice', email: 'alice@booking-test.example' };
  const bob = { sub: 'test-bob', email: 'bob@booking-test.example' };

  async function cancel(reference: string, who: { sub: string; email: string } | null, from = app) {
    return from.inject({
      method: 'DELETE',
      url: `/appointments/${reference}`,
      headers: who ? { authorization: `Bearer ${await tokenFor(who)}` } : {},
    });
  }

  async function freeConsultantsAt10() {
    const slots = await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=2026-12-02&service=Save` });
    return slots.json().find((s: { startsAt: string }) => s.startsAt === WEDNESDAY_10AM.replace('Z', '.000Z')).consultants.length;
  }

  it('cancels the client\'s own appointment and frees the slot', async () => {
    const booked = await book({}, alice);
    expect(await freeConsultantsAt10()).toBe(3);

    const res = await cancel(booked.json().reference, alice);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reference: booked.json().reference, status: 'cancelled' });
    expect(await freeConsultantsAt10()).toBe(4);

    const row = await pool.query('SELECT status FROM appointments WHERE reference = $1', [booked.json().reference]);
    expect(row.rows[0].status).toBe('cancelled'); // kept, not deleted
  });

  it('answers 404 in the same way for another client\'s appointment and for one that does not exist', async () => {
    const booked = await book({}, alice);
    const someoneElses = await cancel(booked.json().reference, bob);
    const missing = await cancel('APT-0000000000', bob);
    expect(someoneElses.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(someoneElses.json()).toEqual(missing.json());
    expect(someoneElses.json().error).toBe('We could not find that appointment.');

    const row = await pool.query('SELECT status FROM appointments WHERE reference = $1', [booked.json().reference]);
    expect(row.rows[0].status).toBe('booked'); // untouched
  });

  it('says so when the appointment was already cancelled', async () => {
    const booked = await book({}, alice);
    await cancel(booked.json().reference, alice);
    const again = await cancel(booked.json().reference, alice);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('You have already cancelled this appointment.');
  });

  it('lets exactly one of two simultaneous cancellations succeed', async () => {
    const booked = await book({}, alice);
    const results = await Promise.all([
      cancel(booked.json().reference, alice),
      cancel(booked.json().reference, alice),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('allows cancelling until 5 minutes after the start, not after', async () => {
    const first = await book({}, alice);
    const second = await book({ startsAt: '2026-12-03T08:00:00Z' }, alice);

    const at4 = buildTestApp(() => new Date('2026-12-02T08:04:00Z')); // 4 minutes after the start
    expect((await cancel(first.json().reference, alice, at4)).statusCode).toBe(200);
    await at4.close();

    const at6 = buildTestApp(() => new Date('2026-12-03T08:06:00Z')); // 6 minutes after the start
    const late = await cancel(second.json().reference, alice, at6);
    await at6.close();
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('This appointment has already started and can no longer be cancelled.');
  });

  it('requires sign-in', async () => {
    expect((await cancel('APT-0000000000', null)).statusCode).toBe(401);
  });

  it('rejects a reference that is not in the right format', async () => {
    expect((await cancel('not-a-reference', alice)).statusCode).toBe(400);
  });
});
