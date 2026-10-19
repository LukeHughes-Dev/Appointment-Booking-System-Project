import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool } from './helpers.js';

// Fixed clock: 20 Nov 2026, 08:00 in South Africa. Every booking below is for later dates.
const fixedNow = () => new Date('2026-11-20T06:00:00Z');

const MENLYN = '4';
const HATFIELD = '6';
const WEDNESDAY_10AM = '2026-12-02T08:00:00Z'; // 10:00 in Johannesburg

const pool = createTestPool();
const app = buildTestApp(fixedNow);
let counter = 0;

function book(body: Record<string, unknown>) {
  counter += 1;
  return app.inject({
    method: 'POST',
    url: '/appointments',
    payload: {
      branchId: MENLYN,
      service: 'Save',
      startsAt: WEDNESDAY_10AM,
      customerEmail: `customer${counter}@booking-test.example`,
      ...body,
    },
  });
}

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE customer_email LIKE '%@booking-test.example'");
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

  it('books the consultant the customer asked for', async () => {
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
    expect((await book({ customerEmail: 'not-an-email' })).statusCode).toBe(400);
    expect((await book({ startsAt: 'tomorrow' })).statusCode).toBe(400);
    expect((await book({ branchId: '999' })).statusCode).toBe(404);
    expect((await book({ service: 'Nope' })).statusCode).toBe(404);
  });
});
