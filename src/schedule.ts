import type { Pool } from 'pg';

// One break the scheduling system wants a consultant to take: a local date and start time.
export interface ScheduledBreak {
  consultantId: string;
  date: string; // YYYY-MM-DD, the branch's local date
  startTime: string; // HH:MM, the branch's local time
  minutes: number;
}

// Where breaks come from. A real version would call the workforce scheduling system. This
// project ships a simulated one with fictional data, behind the same interface.
export interface ScheduleProvider {
  breaks(consultantIds: string[], from: string, to: string): Promise<ScheduledBreak[]>;
}

// A small stable number from some text, so the "random" lunch hour is the same every run.
function hash(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Simulated feed: one hour for lunch, on the hour, Monday to Friday, at 12:00, 13:00 or 14:00
// depending on the consultant and the day.
export const simulatedSchedule: ScheduleProvider = {
  async breaks(consultantIds, from, to) {
    const result: ScheduledBreak[] = [];
    const end = new Date(`${to}T00:00:00Z`);
    for (let day = new Date(`${from}T00:00:00Z`); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      const weekday = day.getUTCDay(); // 0 = Sunday
      if (weekday === 0 || weekday === 6) continue;
      const date = day.toISOString().slice(0, 10);
      for (const consultantId of consultantIds) {
        const hour = 12 + (hash(`${consultantId}:${date}`) % 3);
        result.push({ consultantId, date, startTime: `${hour}:00`, minutes: 60 });
      }
    }
    return result;
  },
};

export interface SyncResult {
  written: number; // breaks copied from the feed
  keptEdited: number; // days left alone because staff had changed them
}

// Copies the feed's breaks into the table for a range of local dates (both inclusive).
// Safe to run any number of times. A day that staff have edited is never touched, and a day
// the consultant is not working at a branch gets no break.
export async function syncBreaks(
  pool: Pool,
  provider: ScheduleProvider,
  from: string,
  to: string,
): Promise<SyncResult> {
  const ids = (await pool.query('SELECT id::text FROM consultants WHERE is_active')).rows.map((r) => r.id);
  const feed = await provider.breaks(ids, from, to);

  const client = await pool.connect();
  const result: SyncResult = { written: 0, keptEdited: 0 };
  try {
    await client.query('BEGIN');
    for (const b of feed) {
      const edited = await client.query(
        "SELECT 1 FROM consultant_breaks WHERE consultant_id = $1 AND day = $2 AND source = 'edited'",
        [b.consultantId, b.date],
      );
      if (edited.rowCount) {
        result.keptEdited += 1;
        continue;
      }
      await client.query(
        "DELETE FROM consultant_breaks WHERE consultant_id = $1 AND day = $2 AND source = 'scheduled'",
        [b.consultantId, b.date],
      );
      // The branch the consultant works at on that date decides the time zone.
      const inserted = await client.query(
        `INSERT INTO consultant_breaks (consultant_id, day, starts_at, ends_at, source)
         SELECT $1, $2::date, t.starts_at, t.starts_at + make_interval(mins => $4::int), 'scheduled'
         FROM (
           SELECT (($2::date + $3::time) AT TIME ZONE br.timezone) AS starts_at
           FROM consultant_assignments a
           JOIN branches br ON br.id = a.branch_id
           WHERE a.consultant_id = $1
             AND $2::date BETWEEN a.valid_from AND coalesce(a.valid_to, 'infinity')
           LIMIT 1
         ) t`,
        [b.consultantId, b.date, b.startTime, b.minutes],
      );
      result.written += inserted.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return result;
}
