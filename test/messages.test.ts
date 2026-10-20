import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// Appointment: Thursday 17 Dec 2026, 10:00 in South Africa. This file owns that date.
const START = '2026-12-17T08:00:00Z';
const at = (minutesFromStart: number) => () => new Date(new Date(START).getTime() + minutesFromStart * 60_000);

const bookingApp = buildTestApp(() => new Date('2026-12-10T06:00:00Z'));
const inWindow = buildTestApp(at(-2));
const tooEarly = buildTestApp(at(-10));
const tooLate = buildTestApp(at(6));
const pool = createTestPool();

const CLIENT = { sub: 'chat-client', email: 'chat-client@booking-test.example' };
const OTHER_CLIENT = { sub: 'chat-other', email: 'chat-other@booking-test.example' };
const NOMSA = { sub: 'chat-nomsa', email: 'nomsa@example.com', roles: ['consultant'] };
const JOHAN = { sub: 'chat-johan', email: 'johan@example.com', roles: ['consultant'] };

let reference: string;

beforeAll(async () => {
  const nomsaId = (await pool.query("SELECT id::text FROM consultants WHERE name = 'Nomsa'")).rows[0].id;
  const res = await bookingApp.inject({
    method: 'POST',
    url: '/appointments',
    headers: { authorization: `Bearer ${await tokenFor(CLIENT)}` },
    payload: { branchId: '4', service: 'Save', startsAt: START, consultantId: nomsaId },
  });
  expect(res.statusCode).toBe(201);
  reference = res.json().reference;
});

afterEach(async () => {
  await pool.query(
    "DELETE FROM messages WHERE appointment_id IN (SELECT id FROM appointments WHERE client_id LIKE 'chat-%')",
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM messages WHERE appointment_id IN (SELECT id FROM appointments WHERE client_id LIKE 'chat-%')");
  await pool.query("DELETE FROM appointments WHERE client_id LIKE 'chat-%'");
  await Promise.all([bookingApp.close(), inWindow.close(), tooEarly.close(), tooLate.close()]);
  await pool.end();
});

const clientUrl = () => `/appointments/${reference}/messages`;
const staffUrl = () => `/staff/appointments/${reference}/messages`;

async function call(app: typeof inWindow, method: 'GET' | 'POST', url: string, user: object, payload?: object) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${await tokenFor(user)}` }, payload });
}

describe('messages between a client and their consultant', () => {
  it('lets each side send during the window and both see the whole thread in order', async () => {
    expect((await call(inWindow, 'POST', clientUrl(), CLIENT, { body: 'I am at the door' })).statusCode).toBe(201);
    const reply = await call(inWindow, 'POST', staffUrl(), NOMSA, { body: 'Coming now' });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().from).toBe('consultant');

    for (const res of [
      await call(inWindow, 'GET', clientUrl(), CLIENT),
      await call(inWindow, 'GET', staffUrl(), NOMSA),
    ]) {
      expect(res.json().map((m: { from: string; body: string }) => [m.from, m.body])).toEqual([
        ['client', 'I am at the door'],
        ['consultant', 'Coming now'],
      ]);
    }
  });

  it('returns only newer messages when asked after an id', async () => {
    const first = (await call(inWindow, 'POST', clientUrl(), CLIENT, { body: 'one' })).json();
    await call(inWindow, 'POST', clientUrl(), CLIENT, { body: 'two' });
    const res = await call(inWindow, 'GET', `${clientUrl()}?after=${first.id}`, CLIENT);
    expect(res.json().map((m: { body: string }) => m.body)).toEqual(['two']);
  });

  it('refuses to send before the window opens or after it closes, but the thread stays readable', async () => {
    await call(inWindow, 'POST', clientUrl(), CLIENT, { body: 'hello' });
    expect((await call(tooEarly, 'POST', clientUrl(), CLIENT, { body: 'too soon' })).statusCode).toBe(409);
    expect((await call(tooLate, 'POST', staffUrl(), NOMSA, { body: 'too late' })).statusCode).toBe(409);
    expect((await call(tooLate, 'GET', clientUrl(), CLIENT)).json()).toHaveLength(1);
  });

  it('keeps the thread private: another client or another consultant gets 404', async () => {
    expect((await call(inWindow, 'GET', clientUrl(), OTHER_CLIENT)).statusCode).toBe(404);
    expect((await call(inWindow, 'POST', clientUrl(), OTHER_CLIENT, { body: 'hi' })).statusCode).toBe(404);
    expect((await call(inWindow, 'GET', staffUrl(), JOHAN)).statusCode).toBe(404);
  });

  it('keeps the staff endpoint for consultants only', async () => {
    expect((await call(inWindow, 'GET', staffUrl(), CLIENT)).statusCode).toBe(403);
    expect((await inWindow.inject({ method: 'GET', url: clientUrl() })).statusCode).toBe(401);
  });

  it('rejects empty, blank and over-long messages', async () => {
    for (const body of ['', '   ', 'x'.repeat(501)]) {
      expect((await call(inWindow, 'POST', clientUrl(), CLIENT, { body })).statusCode).toBe(400);
    }
  });
});
