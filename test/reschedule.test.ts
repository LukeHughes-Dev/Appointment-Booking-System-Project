import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestPool, tokenFor } from './helpers.js';

// Fixed clock: Wednesday 16 Dec 2026, 08:00 in South Africa. This file owns 16 and 18 Dec.
const fixedNow = () => new Date('2026-12-16T06:00:00Z');
const MENLYN = '4';
const SANDTON = '1';
const TEN_AM = '2026-12-16T08:00:00Z';
const ONE_PM = '2026-12-16T11:00:00Z';
const ELEVEN_AM = '2026-12-16T09:00:00Z';
const NEXT_DAY_9AM = '2026-12-18T07:00:00Z';

const pool = createTestPool();
const app = buildTestApp(fixedNow);
const clientA = { sub: 'resched-a', email: 'a@booking-test.example' };
const clientB = { sub: 'resched-b', email: 'b@booking-test.example' };

async function bookAs(client: typeof clientA, startsAt: string, options: { branchId?: string; consultantId?: string } = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/appointments',
    headers: { authorization: `Bearer ${await tokenFor(client)}` },
    payload: { branchId: options.branchId ?? MENLYN, service: 'Save', startsAt, consultantId: options.consultantId },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function reschedule(reference: string, payload: object, client = clientA, target = app) {
  return target.inject({
    method: 'POST',
    url: `/appointments/${reference}/reschedule`,
    headers: { authorization: `Bearer ${await tokenFor(client)}` },
    payload,
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
  it('moves to the time the client chose, with the same consultant, keeping the reference', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const res = await reschedule(booking.reference, { startsAt: ONE_PM });

    expect(res.statusCode).toBe(200);
    expect(res.json().reference).toBe(booking.reference);
    expect(res.json().startsAt).toBe('2026-12-16T11:00:00.000Z');
    expect(res.json().consultant.id).toBe(booking.consultant.id);

    const mine = await app.inject({
      method: 'GET',
      url: '/appointments',
      headers: { authorization: `Bearer ${await tokenFor(clientA)}` },
    });
    expect(mine.json()).toHaveLength(1);
    expect(mine.json()[0].startsAt).toBe('2026-12-16T11:00:00.000Z');
  });

  it('can move to another day', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const res = await reschedule(booking.reference, { startsAt: NEXT_DAY_9AM });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-12-18T07:00:00.000Z');
  });

  it('says who is free when the consultant is not available then, and lets the client pick someone else', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await bookAs(clientB, ONE_PM, { consultantId: booking.consultant.id }); // takes the consultant at 13:00

    const refused = await reschedule(booking.reference, { startsAt: ONE_PM });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('consultant_unavailable');
    expect(refused.json().error).toContain(booking.consultant.name);
    const others = refused.json().available as { id: string; name: string }[];
    expect(others.length).toBeGreaterThan(0);
    expect(others.map((c) => c.id)).not.toContain(booking.consultant.id);

    const moved = await reschedule(booking.reference, { startsAt: ONE_PM, consultantId: others[0]!.id });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().consultant.id).toBe(others[0]!.id);
  });

  it('refuses a time when the client already has another appointment then', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await bookAs(clientA, ELEVEN_AM, { branchId: SANDTON });
    const res = await reschedule(booking.reference, { startsAt: ELEVEN_AM });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already have an appointment');
  });

  it('refuses a time the branch does not offer, and the time the client already has', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    expect((await reschedule(booking.reference, { startsAt: '2026-12-16T01:00:00Z' })).statusCode).toBe(422);
    expect((await reschedule(booking.reference, { startsAt: TEN_AM })).statusCode).toBe(422);
  });

  it('answers 404 for another client\'s appointment', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    expect((await reschedule(booking.reference, { startsAt: ONE_PM }, clientB)).statusCode).toBe(404);
  });

  it('refuses a cancelled appointment', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await app.inject({
      method: 'DELETE',
      url: `/appointments/${booking.reference}`,
      headers: { authorization: `Bearer ${await tokenFor(clientA)}` },
    });
    expect((await reschedule(booking.reference, { startsAt: ONE_PM })).statusCode).toBe(409);
  });

  it('refuses once the window has closed, 5 minutes after the start', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const later = buildTestApp(() => new Date('2026-12-16T08:06:00Z'));
    const res = await reschedule(booking.reference, { startsAt: NEXT_DAY_9AM }, clientA, later);
    await later.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already started');
  });

  it('requires sign-in and a time', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    expect((await app.inject({ method: 'POST', url: '/appointments/APT-0123456789/reschedule', payload: { startsAt: ONE_PM } })).statusCode).toBe(401);
    expect((await reschedule(booking.reference, {})).statusCode).toBe(400);
  });
});

describe('choosing a new time', () => {
  async function get(url: string, client = clientA) {
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await tokenFor(client)}` } });
  }

  it('lets a client move part-way into their own slot, because their own time does not block them', async () => {
    const booking = await bookAs(clientA, TEN_AM); // 10:00-11:00
    const res = await reschedule(booking.reference, { startsAt: '2026-12-16T08:45:00Z' }); // 10:45
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-12-16T08:45:00.000Z');
    expect(res.json().consultant.id).toBe(booking.consultant.id);
  });

  it('still refuses part-way moves when someone else holds that part of the time', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await bookAs(clientB, ONE_PM, { consultantId: booking.consultant.id }); // 13:00-14:00
    const res = await reschedule(booking.reference, { startsAt: '2026-12-16T10:45:00Z' }); // 12:45-13:45
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('consultant_unavailable');
  });

  it('shows the client\'s own time as free in the picker, but not to others', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const url = `/appointments/${booking.reference}/slots?date=2026-12-16`;
    const mine = (await get(url)).json() as { startsAt: string; consultants: { id: string }[] }[];
    const at1045 = mine.find((s) => s.startsAt === '2026-12-16T08:45:00.000Z');
    expect(at1045?.consultants.map((c) => c.id)).toContain(booking.consultant.id);

    const publicList = (
      await app.inject({ method: 'GET', url: `/branches/${MENLYN}/slots?date=2026-12-16&service=Save` })
    ).json() as typeof mine;
    const publicAt1045 = publicList.find((s) => s.startsAt === '2026-12-16T08:45:00.000Z');
    expect(publicAt1045?.consultants.map((c) => c.id) ?? []).not.toContain(booking.consultant.id);

    expect((await get(url, clientB)).statusCode).toBe(404);
  });

  it('lists the consultant\'s next free times, soonest first, across days', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    const consultantId = booking.consultant.id;
    const res = await get(
      `/appointments/${booking.reference}/next-available?consultantId=${consultantId}&after=2026-12-16T14:00:00Z`,
    );
    const slots = res.json() as { startsAt: string; consultants: { id: string }[] }[];
    expect(res.statusCode).toBe(200);
    expect(slots).toHaveLength(5);
    expect(slots.every((s) => s.consultants.some((c) => c.id === consultantId))).toBe(true);
    expect(slots.map((s) => s.startsAt)).toEqual([...slots.map((s) => s.startsAt)].sort());
    expect(new Date(slots[0]!.startsAt).getTime()).toBeGreaterThan(new Date('2026-12-16T14:00:00Z').getTime());
  });

  it('leaves out times the consultant is busy, and checks its input', async () => {
    const booking = await bookAs(clientA, TEN_AM);
    await bookAs(clientB, ONE_PM, { consultantId: booking.consultant.id });
    const base = `/appointments/${booking.reference}/next-available?consultantId=${booking.consultant.id}`;
    const starts = ((await get(`${base}&after=2026-12-16T10:00:00Z`)).json() as { startsAt: string }[]).map((s) => s.startsAt);
    expect(starts).not.toContain('2026-12-16T11:00:00.000Z');
    expect(starts).not.toContain('2026-12-16T11:15:00.000Z');
    expect((await get(`/appointments/${booking.reference}/next-available?consultantId=abc`)).statusCode).toBe(400);
    expect((await get(base, clientB)).statusCode).toBe(404);
  });
});
