import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth/AuthContext'
import type { BranchSummary, Counts } from '../types'

const isoDate = (d: Date) => d.toLocaleDateString('en-CA')

function lastThirtyDays() {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - 29)
  return { from: isoDate(from), to: isoDate(to) }
}

const COLUMNS: { key: keyof Counts; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'attended', label: 'Attended' },
  { key: 'noShow', label: 'No-show' },
  { key: 'notRecorded', label: 'Not recorded' },
  { key: 'cancelled', label: 'Cancelled' },
]

export function StaffSummary() {
  const { session } = useAuth()
  const token = session?.accessToken
  const [range, setRange] = useState(lastThirtyDays)
  const [data, setData] = useState<BranchSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !range.from || !range.to) return
    const controller = new AbortController()
    const start = setTimeout(() => {
      apiFetch<BranchSummary[]>(`/staff/summary?from=${range.from}&to=${range.to}`, {
        token,
        signal: controller.signal,
      })
        .then((result) => {
          setData(result)
          setError(null)
        })
        .catch((e) => {
          if (controller.signal.aborted) return
          setData([])
          setError(
            e instanceof ApiError && e.status === 403
              ? 'This page is for managers.'
              : e instanceof ApiError && (e.status === 400 || e.status === 404)
                ? e.message
                : 'We could not load the summary. Please try again.',
          )
        })
    }, 0)
    return () => {
      clearTimeout(start)
      controller.abort()
    }
  }, [token, range])

  return (
    <>
      <h1>Branch summary</h1>
      <div className="toolbar">
        <label>
          From{' '}
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label>
          To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
      </div>

      {error && <p className="notice error" role="alert">{error}</p>}
      {data === null && !error && <p>Loading…</p>}
      {data?.length === 0 && !error && <p className="notice">No appointments in this period.</p>}

      {data?.map((b) => (
        <div className="table-wrap" key={b.branch.id}>
          <table className="summary-table">
            <caption>{b.branch.name}</caption>
            <thead>
              <tr>
                <th scope="col">Consultant</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.consultants.map((c) => (
                <tr key={c.consultant.id}>
                  <th scope="row">{c.consultant.name}</th>
                  {COLUMNS.map((col) => (
                    <td key={col.key}>{c[col.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Branch total</th>
                {COLUMNS.map((col) => (
                  <td key={col.key}>{b.totals[col.key]}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </>
  )
}
