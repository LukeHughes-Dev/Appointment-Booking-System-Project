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
  // Fetching a thread is reading it: remember how far this side has got (never backwards).
  if (rows.length > 0) {
    await pool.query(
      `INSERT INTO message_reads (appointment_id, reader, last_read_id) VALUES ($1, $2, $3::bigint)
       ON CONFLICT (appointment_id, reader)
       DO UPDATE SET last_read_id = GREATEST(message_reads.last_read_id, EXCLUDED.last_read_id)`,
      [appointment.id, who.kind, rows[rows.length - 1].id],
    );
  }
  return rows.map(toMessage);
}

// SQL for "how many messages from the other side has this reader not read yet", for an
// appointment row aliased `a`. `reader` is a fixed word, never user input.
export function unreadMessagesSql(reader: 'client' | 'consultant') {
  return `(SELECT count(*)::int FROM messages m
           WHERE m.appointment_id = a.id AND m.sender <> '${reader}'
             AND m.id > COALESCE((SELECT r.last_read_id FROM message_reads r
                                  WHERE r.appointment_id = a.id AND r.reader = '${reader}'), 0)
          ) AS unread_messages`;
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
