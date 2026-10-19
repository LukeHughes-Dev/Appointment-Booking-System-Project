import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { StaffDay } from './StaffDay'

const past = {
  reference: 'APT-0000000001',
  status: 'booked',
  outcome: null,
  clientEmail: 'client@example.com',
  branch: { id: '4', name: 'Pretoria Menlyn', timezone: 'Africa/Johannesburg' },
  service: 'Save',
  startsAt: '2020-01-07T08:00:00.000Z',
  endsAt: '2020-01-07T09:00:00.000Z',
}
const future = { ...past, reference: 'APT-0000000002', startsAt: '2999-01-07T08:00:00.000Z', endsAt: '2999-01-07T09:00:00.000Z' }
const cancelled = { ...past, reference: 'APT-0000000003', status: 'cancelled' }

let fetchMock: ReturnType<typeof vi.fn>
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })
const consultant = { name: 'Nomsa', email: 'nomsa@example.com', accessToken: 'tok', roles: ['consultant'] }

function show(session: AuthState['session']) {
  const auth: AuthState = { session, loading: false, signIn: vi.fn(), signOut: vi.fn() }
  render(
    <AuthContext.Provider value={auth}>
      <StaffDay />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('StaffDay', () => {
  it('asks a signed-out visitor to sign in', () => {
    show(null)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for the chosen day, and for every day when "Show all dates" is ticked', async () => {
    fetchMock.mockResolvedValue(reply(200, []))
    show(consultant)
    await waitFor(() => expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/staff\/appointments\?date=\d{4}-\d{2}-\d{2}$/))
    await userEvent.click(screen.getByLabelText(/Show all dates/))
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/staff/appointments'))
  })

  it('offers outcomes only for booked appointments that have started', async () => {
    fetchMock.mockResolvedValue(reply(200, [past, future, cancelled]))
    show(consultant)
    expect(await screen.findAllByRole('group')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Outcome for APT-0000000001' })).toBeInTheDocument()
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument()
  })

  it('records an outcome, and clears it when pressed again', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [past]))
      .mockResolvedValueOnce(reply(200, { outcome: 'no_show' }))
      .mockResolvedValueOnce(reply(200, [{ ...past, outcome: 'no_show' }]))
      .mockResolvedValueOnce(reply(200, { outcome: null }))
      .mockResolvedValueOnce(reply(200, [past]))
    show(consultant)
    await userEvent.click(await screen.findByRole('button', { name: 'No-show' }))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ outcome: 'no_show' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'No-show' })).toHaveAttribute('aria-pressed', 'true'))
    await userEvent.click(screen.getByRole('button', { name: 'No-show' }))
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ outcome: null })
  })

  it('explains when the person is not a consultant', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: 'You do not have access to this' }))
    show({ ...consultant, roles: [] })
    expect(await screen.findByRole('alert')).toHaveTextContent('This page is for consultants.')
  })
})
