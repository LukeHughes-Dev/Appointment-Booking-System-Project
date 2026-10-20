import type { Pool } from 'pg';
import { windowState } from './rules.js';
import { findSlots, MIN_NOTICE_MINUTES, SLOT_GRID_MINUTES } from './slots.js';

const EXCLUSION_VIOLATION = '23P01';
const SEARCH_DAYS = 14; // how far ahead we look for the consultant's next free slot

export type RescheduleResult =
  | { ok: true; reference: string; startsAt: string; endsAt: string; consultant: { id: string; name: string } }
  | { ok: false; reason: 'not_found' | 'not_booked' | 'already_over' | 'no_availability' };

// Moves a client's own appointment to the same consultant's next free slot, in one step.
// The reference stays the same; only the time changes. The database exclusion
// constraints are the final judge, so if someone takes the slot first we try the next one.
export async function rescheduleAppointment(
  pool: Pool,
  reference: string,
  clientId: string,
  now: Date,
): Promise<RescheduleResult> {
  const found = await pool.query(
    `SELECT a.status, a.starts_at, a.branch_id::text, a.consultant_id::text,
            c.name AS consultant_name, s.name AS service,
            (($1::timestamptz) AT TIME ZONE b.timezone)::date::text AS today
     FROM appointments a
     JOIN consultants c   ON c.id = a.consultant_id
     JOIN service_types s ON s.id = a.service_type_id
     JOIN branches b      ON b.id = a.branch_id
     WHERE a.reference = $2 AND a.client_id = $3`,
    [now.toISOString(), reference, clientId],
  );
  const appt = found.rows[0];
  if (!appt) return { ok: false, reason: 'not_found' };
  if (appt.status !== 'booked') return { ok: false, reason: 'not_booked' };
  if (windowState(appt.starts_at, now) === 'closed') return { ok: false, reason: 'already_over' };

  for (let offset = 0; offset < SEARCH_DAYS; offset++) {
    const day = new Date(`${appt.today}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);

    const slots = await findSlots(pool, {
      branchId: appt.branch_id,
      date: day.toISOString().slice(0, 10),
      service: appt.service,
      now,
      gridMinutes: SLOT_GRID_MINUTES,
      noticeMinutes: MIN_NOTICE_MINUTES,
    });

    for (const slot of slots) {
      if (!slot.consultants.some((c) => c.id === appt.consultant_id)) continue;
      if (new Date(slot.startsAt) <= appt.starts_at) continue; // next means later than the current time

      try {
        const updated = await pool.query(
          `UPDATE appointments a
           SET starts_at = $3::timestamptz,
               ends_at = $3::timestamptz + make_interval(mins => s.duration_minutes)
           FROM service_types s
           WHERE a.service_type_id = s.id AND a.reference = $1 AND a.client_id = $2
             AND a.status = 'booked'
           RETURNING a.starts_at, a.ends_at`,
          [reference, clientId, slot.startsAt],
        );
        if (updated.rowCount === 0) return { ok: false, reason: 'not_booked' };
        const row = updated.rows[0];
        return {
          ok: true,
          reference,
          startsAt: row.starts_at.toISOString(),
          endsAt: row.ends_at.toISOString(),
          consultant: { id: appt.consultant_id, name: appt.consultant_name },
        };
      } catch (err) {
        // Taken in the meantime, or it clashes with another of the client's own
        // appointments: either way, try the next slot.
        if ((err as { code?: string }).code === EXCLUSION_VIOLATION) continue;
        throw err;
      }
    }
  }
  return { ok: false, reason: 'no_availability' };
}
