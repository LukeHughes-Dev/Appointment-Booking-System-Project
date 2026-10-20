import type { Pool } from 'pg';
import { windowState } from './rules.js';

export type Party =
  | { kind: 'client'; clientId: string }
  | { kind: 'consultant'; consultantId: string };

export interface Message {
  id: string;
  from: 'client' | 'consultant';
  body: string;
  sentAt: string;
}

export type SendResult =
  | { ok: true; message: Message }
  | { ok: false; reason: 'not_found' | 'not_open' };

// The appointment, but only if it belongs to this person. Someone else's reference looks
// exactly like one that does not exist.
async function findAppointment(pool: Pool, reference: string, who: Party) {
  const { rows } = await pool.query(
    `SELECT id, status, starts_at FROM appointments
     WHERE reference = $1 AND ${who.kind === 'client' ? 'client_id' : 'consultant_id'} = $2`,
    [reference, who.kind === 'client' ? who.clientId : who.consultantId],
  );
  return rows[0] as { id: string; status: string; starts_at: Date } | undefined;
}

function toMessage(r: { id: string; sender: 'client' | 'consultant'; body: string; sent_at: Date }): Message {
  return { id: r.id, from: r.sender, body: r.body, sentAt: r.sent_at.toISOString() };
}

// The thread, oldest first. Pass the last id you have seen as `after` to get only newer ones.
export async function listMessages(
  pool: Pool,
  reference: string,
  who: Party,
  after = '0',
): Promise<Message[] | null> {
  const appointment = await findAppointment(pool, reference, who);
  if (!appointment) return null;
  const { rows } = await pool.query(
    `SELECT id::text, sender, body, sent_at FROM messages
     WHERE appointment_id = $1 AND id > $2::bigint ORDER BY id`,
    [appointment.id, after],
  );
  return rows.map(toMessage);
}

// Sending is only possible while the appointment is booked and its 10-minute window is open.
export async function sendMessage(
  pool: Pool,
  reference: string,
  who: Party,
  body: string,
  now: Date,
): Promise<SendResult> {
  const appointment = await findAppointment(pool, reference, who);
  if (!appointment) return { ok: false, reason: 'not_found' };
  if (appointment.status !== 'booked' || windowState(appointment.starts_at, now) !== 'open') {
    return { ok: false, reason: 'not_open' };
  }
  const { rows } = await pool.query(
    `INSERT INTO messages (appointment_id, sender, body) VALUES ($1, $2, $3)
     RETURNING id::text, sender, body, sent_at`,
    [appointment.id, who.kind, body.trim()],
  );
  return { ok: true, message: toMessage(rows[0]) };
}
