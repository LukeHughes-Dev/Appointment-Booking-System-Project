import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { findSlots, MIN_NOTICE_MINUTES, SLOT_GRID_MINUTES } from './slots.js';

const EXCLUSION_VIOLATION = '23P01'; // the consultant already has a booked appointment that overlaps
const UNIQUE_VIOLATION = '23505'; // only the reference is unique, so this means a reference clash

export interface BookingRequest {
  branchId: string;
  service: string;
  startsAt: string;
  customerEmail: string;
  consultantId?: string; // leave out to take any free consultant
}

export interface Booking {
  reference: string;
  status: 'booked';
  branch: { id: string; name: string; timezone: string };
  consultant: { id: string; name: string };
  service: string;
  customerEmail: string;
  startsAt: string;
  endsAt: string;
}

export type BookingFailure =
  | 'branch_not_found'
  | 'service_not_found'
  | 'not_a_slot' // not a time the branch offers: closed, off the grid, too soon or in the past
  | 'unavailable'; // a real slot, but nobody (or not the chosen consultant) is free

export type BookingResult = { ok: true; booking: Booking } | { ok: false; reason: BookingFailure };

function newReference() {
  return `APT-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function isPgError(err: unknown, code: string) {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

export async function createBooking(pool: Pool, req: BookingRequest, now: Date): Promise<BookingResult> {
  const startsAt = new Date(req.startsAt).toISOString();

  // The branch's own calendar date decides which day's hours and closures apply.
  const branchRes = await pool.query(
    `SELECT id::text, name, timezone, (($1::timestamptz) AT TIME ZONE timezone)::date::text AS day
     FROM branches WHERE id = $2`,
    [startsAt, req.branchId],
  );
  const branch = branchRes.rows[0];
  if (!branch) return { ok: false, reason: 'branch_not_found' };

  const serviceRes = await pool.query('SELECT 1 FROM service_types WHERE name = $1', [req.service]);
  if (serviceRes.rowCount === 0) return { ok: false, reason: 'service_not_found' };

  // Reuse the slot rules, so booking and availability can never disagree.
  const slots = await findSlots(pool, {
    branchId: req.branchId,
    date: branch.day,
    service: req.service,
    now,
    gridMinutes: SLOT_GRID_MINUTES,
    noticeMinutes: MIN_NOTICE_MINUTES,
  });
  const slot = slots.find((s) => s.startsAt === startsAt);
  if (!slot) return { ok: false, reason: 'not_a_slot' };

  const candidates = req.consultantId
    ? slot.consultants.filter((c) => c.id === req.consultantId)
    : slot.consultants;

  // The check above only tells us who looked free a moment ago. The real guarantee is
  // the database exclusion constraint: if someone else got there first, the insert is
  // refused and we move on to the next consultant (or give up).
  for (const consultant of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const inserted = await pool.query(
          `INSERT INTO appointments
             (reference, branch_id, consultant_id, service_type_id, customer_email, starts_at, ends_at)
           SELECT $1, $2, $3, s.id, $4, $5::timestamptz,
                  $5::timestamptz + make_interval(mins => s.duration_minutes)
           FROM service_types s WHERE s.name = $6
           RETURNING reference, ends_at`,
          [newReference(), req.branchId, consultant.id, req.customerEmail, startsAt, req.service],
        );
        const row = inserted.rows[0];
        return {
          ok: true,
          booking: {
            reference: row.reference,
            status: 'booked',
            branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
            consultant,
            service: req.service,
            customerEmail: req.customerEmail,
            startsAt,
            endsAt: row.ends_at.toISOString(),
          },
        };
      } catch (err) {
        if (isPgError(err, EXCLUSION_VIOLATION)) break; // taken: try the next consultant
        if (isPgError(err, UNIQUE_VIOLATION)) continue; // reference clash: try a new reference
        throw err;
      }
    }
  }
  return { ok: false, reason: 'unavailable' };
}
