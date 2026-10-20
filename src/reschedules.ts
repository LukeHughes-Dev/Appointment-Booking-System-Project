import type { Pool } from 'pg';
import { windowState } from './rules.js';
import { findSlots, MIN_NOTICE_MINUTES, SLOT_GRID_MINUTES } from './slots.js';

const EXCLUSION_VIOLATION = '23P01';
const CLIENT_OVERLAP_CONSTRAINT = 'appointments_client_no_overlap';

export type RescheduleResult =
  | { ok: true; reference: string; startsAt: string; endsAt: string; consultant: { id: string; name: string } }
  | { ok: false; reason: 'not_found' | 'not_booked' | 'already_over' | 'not_a_slot' | 'same_time' | 'client_busy' }
  // The chosen consultant is not free then. `available` lists who is, so the client can
  // pick someone else or ask for the chosen consultant's next free time.
  | { ok: false; reason: 'consultant_unavailable'; consultant: { id: string; name: string }; available: { id: string; name: string }[] };

// Moves a client's own appointment to a time they choose, at the same branch and for the
// same service. It stays with the same consultant unless another is named. The reference
// stays the same; only the time (and perhaps the consultant) changes. The database
// exclusion constraints are the final judge if someone else takes the slot first.
export async function rescheduleAppointment(
  pool: Pool,
  reference: string,
  clientId: string,
  choice: { startsAt: string; consultantId?: string },
  now: Date,
): Promise<RescheduleResult> {
  const found = await pool.query(
    `SELECT a.status, a.starts_at, a.branch_id::text, a.consultant_id::text,
            s.name AS service,
            (($1::timestamptz) AT TIME ZONE b.timezone)::date::text AS today,
            (($4::timestamptz) AT TIME ZONE b.timezone)::date::text AS day
     FROM appointments a
     JOIN service_types s ON s.id = a.service_type_id
     JOIN branches b      ON b.id = a.branch_id
     WHERE a.reference = $2 AND a.client_id = $3`,
    [now.toISOString(), reference, clientId, new Date(choice.startsAt).toISOString()],
  );
  const appt = found.rows[0];
  if (!appt) return { ok: false, reason: 'not_found' };
  if (appt.status !== 'booked') return { ok: false, reason: 'not_booked' };
  if (windowState(appt.starts_at, now) === 'closed') return { ok: false, reason: 'already_over' };

  const startsAt = new Date(choice.startsAt).toISOString();
  const consultantId = choice.consultantId ?? appt.consultant_id;
  if (startsAt === appt.starts_at.toISOString() && consultantId === appt.consultant_id) {
    return { ok: false, reason: 'same_time' };
  }

  // The same slot rules as booking, so a reschedule can only land on a real bookable time.
  const slots = await findSlots(pool, {
    branchId: appt.branch_id,
    date: appt.day,
    service: appt.service,
    now,
    gridMinutes: SLOT_GRID_MINUTES,
    noticeMinutes: MIN_NOTICE_MINUTES,
    ignoreReference: reference, // the time being given up is free to take
  });
  const slot = slots.find((s) => s.startsAt === startsAt);
  if (!slot) return { ok: false, reason: 'not_a_slot' };

  const chosen = slot.consultants.find((c) => c.id === consultantId);
  if (!chosen) {
    const name = await pool.query('SELECT name FROM consultants WHERE id = $1', [consultantId]);
    return {
      ok: false,
      reason: 'consultant_unavailable',
      consultant: { id: consultantId, name: name.rows[0]?.name ?? 'Your consultant' },
      available: slot.consultants,
    };
  }

  try {
    const updated = await pool.query(
      `UPDATE appointments a
       SET starts_at = $3::timestamptz,
           ends_at = $3::timestamptz + make_interval(mins => s.duration_minutes),
           consultant_id = $4
       FROM service_types s
       WHERE a.service_type_id = s.id AND a.reference = $1 AND a.client_id = $2
         AND a.status = 'booked'
       RETURNING a.starts_at, a.ends_at`,
      [reference, clientId, startsAt, chosen.id],
    );
    if (updated.rowCount === 0) return { ok: false, reason: 'not_booked' };
    const row = updated.rows[0];
    return { ok: true, reference, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), consultant: chosen };
  } catch (err) {
    if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
      if ((err as { constraint?: string }).constraint === CLIENT_OVERLAP_CONSTRAINT) {
        return { ok: false, reason: 'client_busy' };
      }
      // Taken in the meantime: the same answer as if they had not been free to begin with.
      return {
        ok: false,
        reason: 'consultant_unavailable',
        consultant: chosen,
        available: slot.consultants.filter((c) => c.id !== chosen.id),
      };
    }
    throw err;
  }
}
