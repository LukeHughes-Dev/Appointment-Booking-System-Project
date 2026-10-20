import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth/AuthContext'
import { Chat } from '../components/Chat'
import type { Appointment } from '../types'

function formatWhen(a: Appointment) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: a.branch.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.startsAt))
}

export function MyAppointments() {
  const { session, loading, signIn } = useAuth()
  const token = session?.accessToken
  const [items, setItems] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [chatting, setChatting] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setItems(await apiFetch<Appointment[]>('/appointments', { token, signal }))
      } catch {
        if (!signal?.aborted) setError('We could not load your appointments. Please try again.')
      }
    },
    [token],
  )

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    const start = setTimeout(() => void load(controller.signal), 0)
    // Refresh now and then, so the window buttons appear and disappear on time.
    const refresh = setInterval(() => void load(controller.signal), 30_000)
    return () => {
      clearTimeout(start)
      clearInterval(refresh)
      controller.abort()
    }
  }, [token, load])

  async function cancel(reference: string) {
    setMessage(null)
    setError(null)
    try {
      await apiFetch(`/appointments/${reference}`, { method: 'DELETE', token })
      setMessage(`Appointment ${reference} is cancelled.`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    }
    setConfirming(null)
    await load()
  }

  async function reschedule(reference: string) {
    setMessage(null)
    setError(null)
    try {
      const moved = await apiFetch<{ startsAt: string }>(`/appointments/${reference}/reschedule`, {
        method: 'POST',
        token,
      })
      const when = items?.find((a) => a.reference === reference)
      const text = new Intl.DateTimeFormat('en-GB', {
        timeZone: when?.branch.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(moved.startsAt))
      setMessage(`Appointment ${reference} is moved to ${text}.`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    }
    await load()
  }

  if (loading) return null

  if (!session) {
    return (
      <>
        <h1>My appointments</h1>
        <p className="notice">Sign in to see your appointments.</p>
        <p>
          <button type="button" className="button" onClick={() => void signIn('/appointments')}>
            Sign in
          </button>
        </p>
      </>
    )
  }

  return (
    <>
      <h1>My appointments</h1>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {items === null && !error && <p>Loading…</p>}
      {items?.length === 0 && (
        <p className="notice">
          You have no upcoming appointments. <Link to="/">Find a branch</Link> to book one.
        </p>
      )}
      <ul className="list">
        {items?.map((a) => (
          <li key={a.reference} className="card">
            <div className="card-main">
              <strong>{a.service} at {a.branch.name}</strong>
              <span>{formatWhen(a)} with {a.consultant.name}</span>
              <span>Reference: {a.reference}</span>
            </div>
            <div className="card-actions">
              {a.window === 'open' && confirming !== a.reference && (
                <>
                  <button
                    type="button"
                    className="button quiet"
                    aria-expanded={chatting === a.reference}
                    onClick={() => setChatting(chatting === a.reference ? null : a.reference)}
                  >
                    Chat with {a.consultant.name}
                  </button>
                  <button type="button" className="button" onClick={() => void reschedule(a.reference)}>
                    Move to next available
                  </button>
                </>
              )}
              {confirming === a.reference ? (
                <>
                  <button type="button" className="button danger" onClick={() => void cancel(a.reference)}>
                    Yes, cancel it
                  </button>
                  <button type="button" className="button quiet" onClick={() => setConfirming(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="button quiet" onClick={() => setConfirming(a.reference)}>
                  Cancel appointment
                </button>
              )}
            </div>
            {a.window === 'open' && chatting === a.reference && (
              <Chat
                path={`/appointments/${a.reference}/messages`}
                token={token}
                me="client"
                otherName={a.consultant.name}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
