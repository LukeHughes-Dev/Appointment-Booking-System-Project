import type { Pool } from 'pg';
import type { AppointmentSummary } from './notifications.js';
import { WINDOW_MINUTES_AFTER_START } from './rules.js';

export type CancelResult =
  | { ok: true; reference: string; appointment: AppointmentSummary }
  | { ok: false; reason: 'not_found' | 'already_cancelled' | 'already_started' };

// Cancels a client's own appointment. The row is kept with status 'cancelled' (the
// overlap rule ignores cancelled rows, so the slot opens up again).
export async function cancelAppointment(
  pool: Pool,
  reference: string,
  clientId: string,
  clientEmail: string,
  now: Date,
): Promise<CancelResult> {
  // Filtering on client_id means another client's reference looks exactly like one
  // that does not exist.
  const found = await pool.query(
    `SELECT a.status, a.starts_at, s.name AS service, b.id::text AS branch_id, b.name AS branch_name,
            b.timezone, c.id::text AS consultant_id, c.name AS consultant_name
     FROM appointments a
     JOIN service_types s ON s.id = a.service_type_id
     JOIN branches b      ON b.id = a.branch_id
     JOIN consultants c   ON c.id = a.consultant_id
     WHERE a.reference = $1 AND a.client_id = $2`,
    [reference, clientId],
  );
  const appointment = found.rows[0];
  if (!appointment) return { ok: false, reason: 'not_found' };
  if (appointment.status === 'cancelled') return { ok: false, reason: 'already_cancelled' };

  const lastChance = new Date(appointment.starts_at.getTime() + WINDOW_MINUTES_AFTER_START * 60_000);
  if (now > lastChance) return { ok: false, reason: 'already_started' };

  // The status check here is the final judge: if two cancellations arrive together,
  // only one changes the row, and the other is told it was already cancelled.
  const updated = await pool.query(
    `UPDATE appointments SET status = 'cancelled'
     WHERE reference = $1 AND client_id = $2 AND status = 'booked'
     RETURNING reference`,
    [reference, clientId],
  );
  if (updated.rowCount === 0) return { ok: false, reason: 'already_cancelled' };
  return {
    ok: true,
    reference,
    appointment: {
      reference,
      service: appointment.service,
      branch: { id: appointment.branch_id, name: appointment.branch_name, timezone: appointment.timezone },
      consultant: { id: appointment.consultant_id, name: appointment.consultant_name },
      clientEmail,
      startsAt: appointment.starts_at.toISOString(),
    },
  };
}
