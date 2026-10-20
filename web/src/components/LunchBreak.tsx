import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api'
import type { BreakDay, BreakPiece } from '../types'

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const total = (pieces: BreakPiece[]) =>
  pieces.reduce((sum, p) => (p.start && p.end ? sum + minutes(p.end) - minutes(p.start) : sum), 0)

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

interface LunchBreakProps {
  date: string
  token: string | undefined
  canEdit: boolean // false for days that are over
}

// The consultant's lunch for the chosen day: see it, move it, or split it. The total time
// stays the same. Appointments already booked win; if lunch overlaps one, it is shown.
export function LunchBreak({ date, token, canEdit }: LunchBreakProps) {
  const [day, setDay] = useState<BreakDay | null>(null)
  const [editing, setEditing] = useState<BreakPiece[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setDay(await apiFetch<BreakDay>(`/staff/breaks?date=${date}`, { token, signal }))
        setError(null)
      } catch (e) {
        if (signal?.aborted) return
        setDay(null)
        // No lunch on days off is normal, so only real failures are shown.
        setError(e instanceof ApiError && e.status === 404 ? null : 'We could not load your lunch break.')
      }
    },
    [date, token],
  )

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    const start = setTimeout(() => {
      setEditing(null)
      void load(controller.signal)
    }, 0)
    return () => {
      clearTimeout(start)
      controller.abort()
    }
  }, [token, load])

  if (!day || day.breaks.length === 0) return error ? <p className="notice error" role="alert">{error}</p> : null

  const piecesOk = editing !== null && editing.every((p) => p.start && p.end && minutes(p.end) > minutes(p.start))
  const totalOk = editing !== null && total(editing) === day.totalMinutes

  function change(index: number, field: keyof BreakPiece, value: string) {
    setEditing((current) => current && current.map((p, i) => (i === index ? { ...p, [field]: value } : p)))
  }

  function split() {
    // Two equal halves, one where the break is now and one an hour later, to be adjusted.
    if (!day) return
    const first = day.breaks[0]!
    const half = day.totalMinutes / 2
    const at = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    setEditing([
      { start: first.start, end: at(minutes(first.start) + half) },
      { start: at(minutes(first.start) + 60 + half), end: at(minutes(first.start) + 60 + 2 * half) },
    ])
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      setDay(await apiFetch<BreakDay>(`/staff/breaks?date=${date}`, { method: 'PUT', token, body: { breaks: editing } }))
      setEditing(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card lunch" aria-label="Lunch break">
      <div className="card-main">
        <strong>Lunch</strong>
        {editing === null ? (
          <span>
            {day.breaks.map((b) => `${b.start}–${b.end}`).join(' and ')}
            {day.breaks.some((b) => b.source === 'edited') ? ' (changed by you)' : ''}
          </span>
        ) : (
          <>
            {editing.map((p, i) => (
              <span key={i} className="lunch-row">
                <input type="time" step={900} aria-label={`Lunch ${i + 1} start`} value={p.start} onChange={(e) => change(i, 'start', e.target.value)} />
                {' to '}
                <input type="time" step={900} aria-label={`Lunch ${i + 1} end`} value={p.end} onChange={(e) => change(i, 'end', e.target.value)} />
              </span>
            ))}
            <span className={totalOk ? undefined : 'lunch-bad'}>
              Total {total(editing)} minutes, it must be {day.totalMinutes}.
            </span>
          </>
        )}
        {day.clashes.length > 0 && (
          <span className="notice warn" role="status">
            Lunch overlaps {day.clashes.map((c) => `${c.service} at ${formatTime(c.startsAt, day.timezone)} (${c.reference})`).join(', ')}.
            Booked appointments stay, so you may want to move lunch or ask for cover.
          </span>
        )}
        {error && <span className="notice error" role="alert">{error}</span>}
      </div>
      {canEdit && (
        <div className="card-actions">
          {editing === null ? (
            <>
              <button type="button" className="button quiet" onClick={() => setEditing(day.breaks.map(({ start, end }) => ({ start, end })))}>
                Move lunch
              </button>
              {day.breaks.length === 1 && (
                <button type="button" className="button quiet" onClick={split}>
                  Split lunch
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="button" disabled={!piecesOk || !totalOk || saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save lunch'}
              </button>
              <button type="button" className="button quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
