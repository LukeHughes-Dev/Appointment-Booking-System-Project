import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api'
import type { Branch } from '../types'

type Coords = { lat: number; lng: number }
type LocationState = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable'
type LoadState = 'loading' | 'ready' | 'error'

// Two decimal places is about 1 km: plenty for "nearest branch", and it means an exact
// address is never sent.
const roundTo2 = (n: number) => Math.round(n * 100) / 100

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T12:00:00`))

const LOCATION_MESSAGES: Record<LocationState, string> = {
  idle: 'Show the branches closest to you.',
  asking: 'Asking your device for your location…',
  ok: 'Showing the branches closest to you. Your location is only used to sort this list and is not saved.',
  denied: 'Location is switched off for this site. You can still search by name.',
  unavailable: 'We could not work out where you are. You can still search by name.',
}

export function BranchPicker() {
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [location, setLocation] = useState<LocationState>('idle')
  const [branches, setBranches] = useState<Branch[]>([])
  const [load, setLoad] = useState<LoadState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    // Wait a moment while the client is still typing, so we ask once, not per letter.
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams()
        if (query.trim()) params.set('q', query.trim())
        if (coords) {
          params.set('lat', String(coords.lat))
          params.set('lng', String(coords.lng))
        }
        const qs = params.toString()
        apiFetch<Branch[]>(`/branches${qs ? `?${qs}` : ''}`, { signal: controller.signal })
          .then((data) => {
            setBranches(data)
            setLoad('ready')
          })
          .catch(() => {
            if (!controller.signal.aborted) setLoad('error')
          })
      },
      query ? 250 : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, coords])

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setLocation('unavailable')
      return
    }
    setLocation('asking')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: roundTo2(position.coords.latitude), lng: roundTo2(position.coords.longitude) })
        setLocation('ok')
      },
      (error) => setLocation(error.code === 1 ? 'denied' : 'unavailable'),
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  }

  function stopUsingLocation() {
    setCoords(null)
    setLocation('idle')
  }

  // With a position, the first open branch is the nearest one that is not closed.
  const nearestOpen = coords ? branches.find((b) => !b.closure) : undefined

  return (
    <>
      <h1>Find a branch</h1>
      <p className="lead">Search by name, or let us find the branch closest to you.</p>

      <div className="finder">
        <div className="field">
          <label htmlFor="branch-search">Search branches</label>
          <input
            id="branch-search"
            type="search"
            value={query}
            placeholder="For example, Menlyn"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="locate">
          {location === 'ok' ? (
            <button type="button" className="button quiet" onClick={stopUsingLocation}>
              Stop using my location
            </button>
          ) : (
            <button type="button" className="button" onClick={useMyLocation} disabled={location === 'asking'}>
              Use my location
            </button>
          )}
          <p className="hint" role="status">
            {LOCATION_MESSAGES[location]}
          </p>
        </div>
      </div>

      <div aria-live="polite" className="results">
        {load === 'loading' && <p className="hint">Loading branches…</p>}
        {load === 'error' && (
          <p role="alert" className="notice error">
            We could not load the branches. Please check your connection and try again.
          </p>
        )}
        {load === 'ready' && branches.length === 0 && (
          <p className="notice">No branches match &ldquo;{query.trim()}&rdquo;.</p>
        )}
        {load === 'ready' && branches.length > 0 && (
          <ul className="branch-list">
            {branches.map((branch) => (
              <li key={branch.id} className={branch.closure ? 'card closed' : 'card'}>
                <div className="card-main">
                  <h2>{branch.name}</h2>
                  {branch.distanceKm !== null && <p className="distance">{branch.distanceKm} km away</p>}
                  {branch.closure && (
                    <p className="notice warn">
                      Closed until {formatDate(branch.closure.to)}
                      {branch.closure.reason ? ` (${branch.closure.reason.toLowerCase()})` : ''}.
                      {nearestOpen && (
                        <>
                          {' '}
                          Nearest open branch: <strong>{nearestOpen.name}</strong> ({nearestOpen.distanceKm} km).
                        </>
                      )}
                    </p>
                  )}
                </div>
                {branch.closure ? (
                  <button type="button" className="button" disabled>
                    Closed for now
                  </button>
                ) : (
                  <Link className="button" to={`/branches/${branch.id}/book`}>
                    Book here
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
