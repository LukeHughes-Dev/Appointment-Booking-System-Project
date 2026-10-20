import type { Pool } from 'pg';

export interface Piece {
  start: string; // HH:MM, the branch's local time
  end: string;
}

export interface BreakDay {
  date: string;
  timezone: string;
  totalMinutes: number;
  breaks: (Piece & { source: 'scheduled' | 'edited' })[];
  // Booked appointments that overlap a break. They win: the break stays where staff put it
  // and the clash is shown, so staff can decide what to do about it.
  clashes: { reference: string; service: string; startsAt: string; endsAt: string }[];
}

export type ChangeFailure =
  | 'no_break' // nothing is scheduled that day
  | 'past_day'
  | 'bad_total' // moving or splitting must keep the same total time
  | 'overlap'; // two pieces overlap each other

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/; // on the quarter hour, like appointments

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// The consultant's breaks on a local date, and any appointments they overlap.
export async function breakDay(pool: Pool, consultantId: string, date: string): Promise<BreakDay | null> {
  const zone = await pool.query(
    `SELECT br.timezone FROM consultant_assignments a JOIN branches br ON br.id = a.branch_id
     WHERE a.consultant_id = $1 AND $2::date BETWEEN a.valid_from AND coalesce(a.valid_to, 'infinity') LIMIT 1`,
    [consultantId, date],
  );
  if (zone.rowCount === 0) return null;
  const timezone = zone.rows[0].timezone as string;

  const rows = await pool.query(
    `SELECT to_char(starts_at AT TIME ZONE $3, 'HH24:MI') AS start,
            to_char(ends_at AT TIME ZONE $3, 'HH24:MI') AS "end", source
     FROM consultant_breaks WHERE consultant_id = $1 AND day = $2::date ORDER BY starts_at`,
    [consultantId, date, timezone],
  );
  const clashes = await pool.query(
    `SELECT DISTINCT a.reference, s.name AS service, a.starts_at, a.ends_at
     FROM appointments a
     JOIN service_types s ON s.id = a.service_type_id
     JOIN consultant_breaks b ON b.consultant_id = a.consultant_id AND b.day = $2::date
     WHERE a.consultant_id = $1 AND a.status = 'booked'
       AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
     ORDER BY a.starts_at`,
    [consultantId, date],
  );

  const breaks = rows.rows as BreakDay['breaks'];
  return {
    date,
    timezone,
    totalMinutes: breaks.reduce((sum, b) => sum + minutesOf(b.end) - minutesOf(b.start), 0),
    breaks,
    clashes: clashes.rows.map((r) => ({
      reference: r.reference,
      service: r.service,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
    })),
  };
}

// Replaces the day's break with the given pieces (moving it, or splitting it in two or more).
// The total time must stay the same. The consultant's row is locked while this happens, so two
// people editing the same day (the consultant and a manager) cannot interleave their changes.
export async function replaceBreakDay(
  pool: Pool,
  consultantId: string,
  date: string,
  pieces: Piece[],
  changedBy: string,
  now: Date,
): Promise<{ ok: true; day: BreakDay } | { ok: false; reason: ChangeFailure }> {
  const current = await breakDay(pool, consultantId, date);
  if (!current || current.breaks.length === 0) return { ok: false, reason: 'no_break' };

  const today = (
    await pool.query("SELECT (($1::timestamptz) AT TIME ZONE $2)::date::text AS d", [now.toISOString(), current.timezone])
  ).rows[0].d as string;
  if (date < today) return { ok: false, reason: 'past_day' };

  const total = pieces.reduce((sum, p) => sum + minutesOf(p.end) - minutesOf(p.start), 0);
  const valid = pieces.every((p) => TIME.test(p.start) && TIME.test(p.end) && minutesOf(p.end) > minutesOf(p.start));
  if (!valid || total !== current.totalMinutes) return { ok: false, reason: 'bad_total' };

  const sorted = [...pieces].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (minutesOf(sorted[i]!.start) < minutesOf(sorted[i - 1]!.end)) return { ok: false, reason: 'overlap' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM consultants WHERE id = $1 FOR UPDATE', [consultantId]);
    // Read again under the lock: someone else may have changed the day since we looked.
    const before = await client.query(
      `SELECT to_char(starts_at AT TIME ZONE $3, 'HH24:MI') AS start,
              to_char(ends_at AT TIME ZONE $3, 'HH24:MI') AS "end"
       FROM consultant_breaks WHERE consultant_id = $1 AND day = $2::date ORDER BY starts_at`,
      [consultantId, date, current.timezone],
    );
    await client.query('DELETE FROM consultant_breaks WHERE consultant_id = $1 AND day = $2::date', [consultantId, date]);
    for (const p of sorted) {
      await client.query(
        `INSERT INTO consultant_breaks (consultant_id, day, starts_at, ends_at, source)
         VALUES ($1, $2::date, ($2::date + $3::time) AT TIME ZONE $5, ($2::date + $4::time) AT TIME ZONE $5, 'edited')`,
        [consultantId, date, p.start, p.end, current.timezone],
      );
    }
    await client.query(
      'INSERT INTO break_changes (consultant_id, day, changed_by, before, after) VALUES ($1, $2::date, $3, $4, $5)',
      [consultantId, date, changedBy, JSON.stringify(before.rows), JSON.stringify(sorted)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23P01') return { ok: false, reason: 'overlap' };
    throw err;
  } finally {
    client.release();
  }

  return { ok: true, day: (await breakDay(pool, consultantId, date))! };
}
