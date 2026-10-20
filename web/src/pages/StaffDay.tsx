import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth/AuthContext'
import { Chat } from '../components/Chat'
import type { Outcome, StaffAppointment } from '../types'

const today = () => new Date().toLocaleDateString('en-CA')

function formatWhen(a: StaffAppointment, withDate: boolean) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: a.branch.timezone,
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.startsAt))
}

export function StaffDay() {
  const { session } = useAuth()
  const token = session?.accessToken
  const [date, setDate] = useState(today())
  const [all, setAll] = useState(false)
  const [items, setItems] = useState<StaffAppointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chatting, setChatting] = useState<string | null>(null)
  const [asOf, setAsOf] = useState(0) // when the list was loaded: decides what has started

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const query = all ? '' : `?date=${date}`
        setItems(await apiFetch<StaffAppointment[]>(`/staff/appointments${query}`, { token, signal }))
        setAsOf(Date.now())
      } catch (e) {
        if (signal?.aborted) return
        setItems([])
        setError(
          e instanceof ApiError && e.status === 403
            ? 'This page is for consultants.'
            : e instanceof ApiError && e.status === 404
              ? e.message
              : 'We could not load the appointments. Please try again.',
        )
      }
    },
    [token, date, all],
  )

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    const start = setTimeout(() => void load(controller.signal), 0)
    // Refresh now and then, so a chat button appears when an appointment's window opens.
    const refresh = setInterval(() => void load(controller.signal), 30_000)
    return () => {
      clearTimeout(start)
      clearInterval(refresh)
      controller.abort()
    }
  }, [token, load])

  async function record(a: StaffAppointment, outcome: Outcome) {
    setError(null)
    try {
      await apiFetch(`/staff/appointments/${a.reference}/outcome`, {
        method: 'PATCH',
        token,
        body: { outcome: a.outcome === outcome ? null : outcome }, // pressing again clears it
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    }
    await load()
  }

  return (
    <>
      <h1>My day</h1>
      <div className="toolbar">
        <label>
          Date{' '}
          <input type="date" value={date} disabled={all} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all
          dates
        </label>
      </div>

      {error && <p className="notice error" role="alert">{error}</p>}
      {items === null && !error && <p>Loading…</p>}
      {items?.length === 0 && !error && <p className="notice">No appointments for this selection.</p>}

      <ul className="list">
        {items?.map((a) => {
          const started = new Date(a.startsAt).getTime() <= asOf
          const canRecord = a.status === 'booked' && started
          return (
            <li key={a.reference} className={a.status === 'cancelled' ? 'card cancelled' : 'card'}>
              <div className="card-main">
                <strong>
                  {formatWhen(a, all)} · {a.service}
                </strong>
                <span>
                  {a.clientEmail} · {a.branch.name}
                </span>
                <span>
                  {a.reference}
                  {a.status === 'cancelled' ? ' · Cancelled' : ''}
                </span>
              </div>
              {a.status === 'booked' && a.window === 'open' && (
                <div className="card-actions">
                  <button
                    type="button"
                    className="button quiet"
                    aria-expanded={chatting === a.reference}
                    onClick={() => setChatting(chatting === a.reference ? null : a.reference)}
                  >
                    Chat with client
                  </button>
                </div>
              )}
              {canRecord && (
                <div className="card-actions" role="group" aria-label={`Outcome for ${a.reference}`}>
                  <button
                    type="button"
                    className="choice"
                    aria-pressed={a.outcome === 'attended'}
                    onClick={() => void record(a, 'attended')}
                  >
                    Attended
                  </button>
                  <button
                    type="button"
                    className="choice"
                    aria-pressed={a.outcome === 'no_show'}
                    onClick={() => void record(a, 'no_show')}
                  >
                    No-show
                  </button>
                </div>
              )}
              {a.status === 'booked' && a.window === 'open' && chatting === a.reference && (
                <Chat
                  path={`/staff/appointments/${a.reference}/messages`}
                  token={token}
                  me="consultant"
                  otherName="the client"
                />
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
