import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth/AuthContext'
import type { Booking, Branch, Slot } from '../types'

// Matches the seeded services. A later step can load these from the API.
const SERVICES = [
  { name: 'Save', minutes: 60 },
  { name: 'Transact', minutes: 30 },
  { name: 'Credit', minutes: 90 },
]

const today = () => new Date().toLocaleDateString('en-CA')

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function BookingPage() {
  const { id } = useParams()
  const { session, signIn } = useAuth()
  const [params, setParams] = useSearchParams()

  // The choices live in the address bar so they survive signing in and a page refresh.
  const service = params.get('service') ?? ''
  const date = params.get('date') ?? ''
  const start = params.get('start') ?? ''
  const consultant = params.get('consultant') ?? ''

  const [branch, setBranch] = useState<Branch | null>(null)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [booking, setBooking] = useState<Booking | null>(null)
  const [busy, setBusy] = useState(false)

  function choose(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const controller = new AbortController()
    apiFetch<Branch[]>('/branches', { signal: controller.signal })
      .then((all) => setBranch(all.find((b) => b.id === id) ?? null))
      .catch(() => {})
    return () => controller.abort()
  }, [id])

  useEffect(() => {
    if (!service || !date) return
    const controller = new AbortController()
    apiFetch<Slot[]>(`/branches/${id}/slots?date=${date}&service=${encodeURIComponent(service)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setSlots(result)
        setError(null)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError('We could not load the times. Please try again.')
        console.error(e)
      })
    return () => controller.abort()
  }, [id, service, date])

  const zone = branch?.timezone ?? 'Africa/Johannesburg'
  const visibleSlots = service && date ? slots : null
  const chosen = visibleSlots?.find((s) => s.startsAt === start && s.available) ?? null

  async function book() {
    if (!chosen || !id) return
    setBusy(true)
    setError(null)
    try {
      const made = await apiFetch<Booking>('/appointments', {
        method: 'POST',
        token: session?.accessToken,
        body: { branchId: id, service, startsAt: chosen.startsAt, ...(consultant ? { consultantId: consultant } : {}) },
      })
      setBooking(made)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
      if (e instanceof ApiError && e.status === 409) {
        choose({ start: '' })
        setSlots(await apiFetch<Slot[]>(`/branches/${id}/slots?date=${date}&service=${encodeURIComponent(service)}`))
      }
    } finally {
      setBusy(false)
    }
  }

  if (booking) {
    return (
      <>
        <h1>You are booked</h1>
        <p className="notice" role="status">{booking.confirmation.message}</p>
        <p>
          A confirmation was sent to {booking.confirmation.to} (simulated).{' '}
          <Link to="/appointments">See my appointments</Link>
        </p>
      </>
    )
  }

  return (
    <>
      <h1>Book at {branch?.name ?? 'this branch'}</h1>

      <section className="step" aria-labelledby="step-service">
        <h2 id="step-service">1. What do you need?</h2>
        <div className="choices">
          {SERVICES.map((s) => (
            <button
              key={s.name}
              type="button"
              className="choice"
              aria-pressed={service === s.name}
              onClick={() => choose({ service: s.name, start: '', consultant: '' })}
            >
              {s.name} ({s.minutes} min)
            </button>
          ))}
        </div>
      </section>

      <section className="step" aria-labelledby="step-date">
        <h2 id="step-date">2. Which day?</h2>
        <input
          type="date"
          aria-label="Date"
          value={date}
          min={today()}
          onChange={(e) => choose({ date: e.target.value, start: '', consultant: '' })}
        />
      </section>

      {service && date && (
        <section className="step" aria-labelledby="step-time">
          <h2 id="step-time">3. Pick a time</h2>
          {visibleSlots === null && !error && <p>Loading times…</p>}
          {visibleSlots?.length === 0 && <p className="notice">There are no times on this day. Try another day.</p>}
          <div className="choices">
            {visibleSlots?.map((s) => (
              <button
                key={s.startsAt}
                type="button"
                className="choice"
                disabled={!s.available}
                aria-pressed={start === s.startsAt}
                onClick={() => choose({ start: s.startsAt, consultant: '' })}
              >
                {formatTime(s.startsAt, zone)}
              </button>
            ))}
          </div>
        </section>
      )}

      {chosen && (
        <section className="step" aria-labelledby="step-consultant">
          <h2 id="step-consultant">4. Who would you like to see?</h2>
          <select
            aria-label="Consultant"
            value={consultant}
            onChange={(e) => choose({ consultant: e.target.value })}
          >
            <option value="">Any available consultant</option>
            {chosen.consultants.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </section>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}

      {chosen && (
        <p>
          {session ? (
            <button type="button" className="button" disabled={busy} onClick={book}>
              {busy ? 'Booking…' : 'Confirm booking'}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => signIn(`/branches/${id}/book?${params.toString()}`)}
            >
              Sign in to book
            </button>
          )}
        </p>
      )}
    </>
  )
}
