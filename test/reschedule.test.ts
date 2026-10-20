import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// Fixed clock: Wednesday 16 Dec 2026, 08:00 in South Africa. This file owns that date.
const fixedNow = () => new Date('2026-12-16T06:00:00Z');
const MENLYN = '4';
const SANDTON = '1';
const TEN_AM = '2026-12-16T08:00:00Z';
const ELEVEN_AM = '2026-12-16T09:00:00Z';

const pool = createTestPool();
const app = buildTestApp(fixedNow);
const clientA = { sub: 'resched-a', email: 'a@booking-test.example' };
const clientB = { sub: 'resched-b', email: 'b@booking-test.example' };

async function bookAs(client: typeof clientA, startsAt: string, branchId = MENLYN) {
  const res = await app.inject({
    method: 'POST',
    url: '/appointments',
    headers: { authorization: `Bearer ${await tokenFor(client)}` },
    payload: { branchId, service: 'Save', startsAt },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function reschedule(reference: string, client = clientA, target = app) {
  return target.inject({
    method: 'POST',
    url: `/appointments/${reference}/reschedule`,
    headers: { authorization: `Bearer ${await tokenFor(client)}` },
  });
}

afterEach(async () => {
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'resched-%'");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('POST /appointments/:reference/reschedule', () => {
  it('moves the appointment to the same consultant\'s next free slot and keeps the reference', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const res = await reschedule(booking.reference);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.reference).toBe(booking.reference);
    expect(body.consultant.id).toBe(booking.consultant.id);
    expect(new Date(body.startsAt).getTime()).toBeGreaterThan(new Date(TEN_AM).getTime());

    const mine = await app.inject({
      method: 'GET',
      url: '/appointments',
      headers: { authorization: `Bearer ${await tokenFor(clientA)}` },
    });
    expect(mine.json()).toHaveLength(1);
    expect(mine.json()[0].startsAt).toBe(body.startsAt);
  });

  it('skips a time when the client already has another appointment then', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await bookAs(clientA, ELEVEN_AM, SANDTON); // clashes with the consultant\'s next free hour
    const res = await reschedule(booking.reference);

    expect(res.statusCode).toBe(200);
    expect(new Date(res.json().startsAt).getTime()).toBeGreaterThan(new Date(ELEVEN_AM).getTime());
  });

  it('answers 404 for another client\'s appointment', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const res = await reschedule(booking.reference, clientB);
    expect(res.statusCode).toBe(404);
  });

  it('refuses a cancelled appointment', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await app.inject({
      method: 'DELETE',
      url: `/appointments/${booking.reference}`,
      headers: { authorization: `Bearer ${await tokenFor(clientA)}` },
    });
    const res = await reschedule(booking.reference);
    expect(res.statusCode).toBe(409);
  });

  it('refuses once the window has closed, 5 minutes after the start', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const later = buildTestApp(() => new Date('2026-12-16T08:06:00Z'));
    const res = await reschedule(booking.reference, clientA, later);
    await later.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already started');
  });

  it('requires sign-in', async () => {
    const res = await app.inject({ method: 'POST', url: '/appointments/APT-0123456789/reschedule' });
    expect(res.statusCode).toBe(401);
  });
});
