import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api'
import type { Appointment, Slot } from '../types'

interface Person {
  id: string
  name: string
}

interface ReschedulePanelProps {
  appointment: Appointment
  others: Appointment[] // the client's other appointments, so overlapping times can be greyed out
  token: string | undefined
  onMoved: (message: string) => void
  onClose: () => void
}

const today = () => new Date().toLocaleDateString('en-CA')

function describe(iso: string, timeZone: string, withDay: boolean) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    ...(withDay ? { weekday: 'long', day: 'numeric', month: 'long' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

// Choose a new time for an appointment. If the consultant is not free then, the client
// decides: see someone else at that time, or see the consultant's next available times.
export function ReschedulePanel({ appointment, others, token, onMoved, onClose }: ReschedulePanelProps) {
  const zone = appointment.branch.timezone
  const base = `/appointments/${appointment.reference}`
  const consultant = appointment.consultant

  const [date, setDate] = useState(() => new Date(appointment.startsAt).toLocaleDateString('en-CA', { timeZone: zone }))
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [start, setStart] = useState('')
  const [step, setStep] = useState<'pick' | 'someone' | 'next'>('pick')
  const [replacement, setReplacement] = useState('') // consultant chosen under "someone else"
  const [next, setNext] = useState<Slot[] | null>(null)
  const [refused, setRefused] = useState<Person[] | null>(null) // who is free, after a "not available" answer
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const load = setTimeout(() => {
      apiFetch<Slot[]>(`${base}/slots?date=${date}`, { token, signal: controller.signal })
        .then((result) => {
          setSlots(result)
          setError(null)
        })
        .catch(() => {
          if (!controller.signal.aborted) setError('We could not load the times. Please try again.')
        })
    }, 0)
    return () => {
      clearTimeout(load)
      controller.abort()
    }
  }, [base, date, token])

  const clash = (s: Slot) =>
    others.some((a) => new Date(a.startsAt) < new Date(s.endsAt) && new Date(s.startsAt) < new Date(a.endsAt))
  const usable = (s: Slot) => s.available && !clash(s)
  const chosen = slots?.find((s) => s.startsAt === start) ?? null

  // Who is free at the chosen time: from the slot list, or from the API's last answer.
  const free: Person[] = refused ?? chosen?.consultants ?? []
  const consultantIsFree = refused === null && !!chosen?.consultants.some((c) => c.id === consultant.id)
  const alternatives = free.filter((c) => c.id !== consultant.id)

  function pick(startsAt: string) {
    setStart(startsAt)
    setStep('pick')
    setReplacement('')
    setRefused(null)
    setNext(null)
    setError(null)
  }

  function pickDate(value: string) {
    setDate(value)
    setSlots(null)
    pick('')
  }

  async function move(consultantId?: string) {
    setBusy(true)
    setError(null)
    try {
      const moved = await apiFetch<{ startsAt: string; consultant: Person }>(`${base}/reschedule`, {
        method: 'POST',
        token,
        body: { startsAt: start, ...(consultantId ? { consultantId } : {}) },
      })
      onMoved(
        `Appointment ${appointment.reference} is moved to ${describe(moved.startsAt, zone, true)} with ${moved.consultant.name}.`,
      )
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details.code === 'consultant_unavailable') {
        // Someone took it while the client was choosing: ask the same question again.
        setRefused((e.details.available as Person[]) ?? [])
        setStep('pick')
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
      }
      setBusy(false)
    }
  }

  async function showNext() {
    setStep('next')
    setError(null)
    try {
      setNext(
        await apiFetch<Slot[]>(
          `${base}/next-available?consultantId=${consultant.id}&after=${encodeURIComponent(start)}`,
          { token },
        ),
      )
    } catch {
      setError(`We could not load ${consultant.name}'s next times. Please try again.`)
    }
  }

  function takeNext(slot: Slot) {
    // Jump to that day with the time already chosen, so the usual "move" button applies.
    setDate(new Date(slot.startsAt).toLocaleDateString('en-CA', { timeZone: zone }))
    setSlots([slot])
    pick(slot.startsAt)
  }

  const notFree = chosen !== null && !consultantIsFree

  return (
    <section className="reschedule" aria-label="Change time">
      <h3>Change time</h3>
      <label>
        Day{' '}
        <input type="date" aria-label="Date" value={date} min={today()} onChange={(e) => pickDate(e.target.value)} />
      </label>

      {slots === null && !error && <p>Loading times…</p>}
      {slots?.length === 0 && <p className="notice">There are no times on this day. Try another day.</p>}
      <div className="choices">
        {slots?.map((s) => (
          <button
            key={s.startsAt}
            type="button"
            className="choice"
            disabled={!usable(s)}
            title={clash(s) ? 'You already have an appointment at this time' : undefined}
            aria-pressed={start === s.startsAt}
            onClick={() => pick(s.startsAt)}
          >
            {describe(s.startsAt, zone, false)}
          </button>
        ))}
      </div>

      {chosen && consultantIsFree && (
        <p>
          <button type="button" className="button" disabled={busy} onClick={() => void move()}>
            {busy ? 'Moving…' : `Move to ${describe(chosen.startsAt, zone, false)} with ${consultant.name}`}
          </button>
        </p>
      )}

      {notFree && step === 'pick' && (
        <div className="notice warn" role="status">
          <p>
            {consultant.name} is not available at {describe(chosen.startsAt, zone, false)}. Would you like to see
            someone else, or would you like to see the next available time for {consultant.name}?
          </p>
          <div className="card-actions">
            {alternatives.length > 0 && (
              <button type="button" className="button" onClick={() => setStep('someone')}>
                See someone else
              </button>
            )}
            <button type="button" className="button quiet" onClick={() => void showNext()}>
              See {consultant.name}&apos;s next available time
            </button>
          </div>
        </div>
      )}

      {notFree && step === 'someone' && (
        <div className="step">
          <label>
            Who would you like to see?{' '}
            <select aria-label="Consultant" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">Choose a consultant</option>
              {alternatives.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <p>
            <button type="button" className="button" disabled={!replacement || busy} onClick={() => void move(replacement)}>
              {busy ? 'Moving…' : 'Move with this consultant'}
            </button>
          </p>
        </div>
      )}

      {step === 'next' && (
        <div className="step">
          <p>{consultant.name}&apos;s next available times:</p>
          {next === null && !error && <p>Loading…</p>}
          {next?.length === 0 && <p className="notice">{consultant.name} has no free time in the next two weeks.</p>}
          <div className="choices">
            {next?.map((s) => (
              <button key={s.startsAt} type="button" className="choice" onClick={() => takeNext(s)}>
                {describe(s.startsAt, zone, true)}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}
      <p>
        <button type="button" className="button quiet" onClick={onClose}>
          Keep my current time
        </button>
      </p>
    </section>
  )
}
