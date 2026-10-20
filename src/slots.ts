import type { Pool } from 'pg';

export const SLOT_GRID_MINUTES = 15; // slots start every 15 minutes
export const MIN_NOTICE_MINUTES = 30; // nothing can be booked closer than this, so walk-ins can be helped

export interface SlotQuery {
  branchId: string;
  date: string; // local date at the branch, YYYY-MM-DD
  service: string;
  now: Date;
  gridMinutes: number;
  noticeMinutes: number;
  ignoreReference?: string; // an appointment being moved: its own time does not block anyone
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  available: boolean;
  consultants: { id: string; name: string }[];
}

// Every start time on the grid between opening and (closing - service duration),
// each with the consultants who are free for the whole slot. Closed days (closures,
// or no trading hours that weekday) give no rows. Slots earlier than now + notice
// are dropped. Times are worked out in the branch's own timezone.
const SLOTS_SQL = `
  WITH params AS (
    SELECT b.id AS branch_id, b.timezone, $2::date AS day,
           s.duration_minutes, extract(isodow FROM $2::date)::int AS weekday
    FROM branches b
    JOIN service_types s ON s.name = $3
    WHERE b.id = $1
  ),
  trading AS (
    SELECT p.*, h.opens_at, h.closes_at
    FROM params p
    JOIN branch_hours h ON h.branch_id = p.branch_id AND h.weekday = p.weekday
    WHERE NOT EXISTS (
      SELECT 1 FROM branch_closures c
      WHERE c.branch_id = p.branch_id AND p.day BETWEEN c.closed_from AND c.closed_to
    )
  ),
  slots AS (
    SELECT t.branch_id,
           gs AS starts_at,
           gs + make_interval(mins => t.duration_minutes) AS ends_at
    FROM trading t
    CROSS JOIN LATERAL generate_series(
      (t.day + t.opens_at) AT TIME ZONE t.timezone,
      (t.day + t.closes_at) AT TIME ZONE t.timezone - make_interval(mins => t.duration_minutes),
      make_interval(mins => $5::int)
    ) AS gs
    WHERE gs >= $4::timestamptz + make_interval(mins => $6::int)
  ),
  staff AS (
    SELECT a.consultant_id, c.name
    FROM consultant_assignments a
    JOIN consultants c ON c.id = a.consultant_id
    WHERE a.branch_id = $1 AND c.is_active
      AND $2::date BETWEEN a.valid_from AND coalesce(a.valid_to, 'infinity')
  )
  SELECT sl.starts_at, sl.ends_at,
         coalesce(
           json_agg(json_build_object('id', st.consultant_id::text, 'name', st.name) ORDER BY st.name)
             FILTER (WHERE st.consultant_id IS NOT NULL),
           '[]') AS free_consultants
  FROM slots sl
  LEFT JOIN staff st ON NOT EXISTS (
    SELECT 1 FROM appointments ap
    WHERE ap.consultant_id = st.consultant_id
      AND ap.status = 'booked'
      AND ($7::text IS NULL OR ap.reference <> $7)
      AND tstzrange(ap.starts_at, ap.ends_at, '[)') && tstzrange(sl.starts_at, sl.ends_at, '[)')
  )
  GROUP BY sl.starts_at, sl.ends_at
  ORDER BY sl.starts_at
`;

export async function findSlots(pool: Pool, q: SlotQuery): Promise<Slot[]> {
  const { rows } = await pool.query(SLOTS_SQL, [
    q.branchId,
    q.date,
    q.service,
    q.now.toISOString(),
    q.gridMinutes,
    q.noticeMinutes,
    q.ignoreReference ?? null,
  ]);
  return rows.map((r) => ({
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    available: r.free_consultants.length > 0,
    consultants: r.free_consultants,
  }));
}

export interface NextSlotsQuery {
  branchId: string;
  service: string;
  consultantId: string;
  after: Date; // only slots starting after this moment
  now: Date;
  limit: number;
  days: number; // how many days ahead to look
  ignoreReference?: string;
}

// The next times a particular consultant is free, soonest first, across as many days as
// needed. Uses findSlots day by day, so these are always real bookable times.
export async function findNextSlots(pool: Pool, q: NextSlotsQuery): Promise<Slot[]> {
  const { rows } = await pool.query(
    "SELECT (($1::timestamptz) AT TIME ZONE timezone)::date::text AS day FROM branches WHERE id = $2",
    [q.now.toISOString(), q.branchId],
  );
  if (rows.length === 0) return [];

  const found: Slot[] = [];
  for (let offset = 0; offset < q.days && found.length < q.limit; offset++) {
    const day = new Date(`${rows[0].day}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const slots = await findSlots(pool, {
      branchId: q.branchId,
      date: day.toISOString().slice(0, 10),
      service: q.service,
      now: q.now,
      gridMinutes: SLOT_GRID_MINUTES,
      noticeMinutes: MIN_NOTICE_MINUTES,
      ignoreReference: q.ignoreReference,
    });
    for (const slot of slots) {
      if (new Date(slot.startsAt) <= q.after) continue;
      if (!slot.consultants.some((c) => c.id === q.consultantId)) continue;
      found.push(slot);
      if (found.length >= q.limit) break;
    }
  }
  return found;
}
