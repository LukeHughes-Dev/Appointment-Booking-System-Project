import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { MyAppointments } from './MyAppointments'

const appointment = {
  reference: 'APT-0123456789',
  branch: { id: '1', name: 'Pretoria Menlyn', timezone: 'Africa/Johannesburg' },
  consultant: { id: '7', name: 'Nomsa' },
  service: 'Save',
  startsAt: '2030-01-07T06:00:00.000Z',
  endsAt: '2030-01-07T07:00:00.000Z',
  window: 'upcoming' as const,
}

let fetchMock: ReturnType<typeof vi.fn>
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })

function show(session: AuthState['session']) {
  const auth: AuthState = { session, loading: false, signIn: vi.fn(), signOut: vi.fn() }
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <MyAppointments />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}
const signedIn = { name: 'Client', email: 'client@example.com', accessToken: 'tok', roles: [] }

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyAppointments', () => {
  it('asks a signed-out client to sign in', () => {
    show(null)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists upcoming appointments in the branch time', async () => {
    fetchMock.mockResolvedValue(reply(200, [appointment]))
    show(signedIn)
    expect(await screen.findByText('Save at Pretoria Menlyn')).toBeInTheDocument()
    expect(screen.getByText(/08:00 with Nomsa/)).toBeInTheDocument()
  })

  it('says so when there is nothing booked', async () => {
    fetchMock.mockResolvedValue(reply(200, []))
    show(signedIn)
    expect(await screen.findByText(/no upcoming appointments/)).toBeInTheDocument()
  })

  it('asks for confirmation, then cancels and refreshes the list', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [appointment]))
      .mockResolvedValueOnce(reply(200, { reference: appointment.reference, status: 'cancelled' }))
      .mockResolvedValueOnce(reply(200, []))
    show(signedIn)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel appointment' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    expect(await screen.findByText(/APT-0123456789 is cancelled/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(await screen.findByText(/no upcoming appointments/)).toBeInTheDocument()
  })

  it('shows the reason when a cancel is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [appointment]))
      .mockResolvedValueOnce(reply(409, { error: 'You have already cancelled this appointment.' }))
      .mockResolvedValueOnce(reply(200, [appointment]))
    show(signedIn)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel appointment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already cancelled')
  })

  it('offers one-click reschedule only while the window is open', async () => {
    fetchMock.mockResolvedValue(reply(200, [appointment]))
    show(signedIn)
    await screen.findByText('Save at Pretoria Menlyn')
    expect(screen.queryByRole('button', { name: 'Move to next available' })).not.toBeInTheDocument()
  })

  it('moves the appointment in one click and shows the new time', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [{ ...appointment, window: 'open' }]))
      .mockResolvedValueOnce(reply(200, { reference: appointment.reference, startsAt: '2030-01-07T07:00:00.000Z' }))
      .mockResolvedValueOnce(reply(200, [{ ...appointment, startsAt: '2030-01-07T07:00:00.000Z', window: 'upcoming' }]))
    show(signedIn)
    await userEvent.click(await screen.findByRole('button', { name: 'Move to next available' }))
    expect(await screen.findByText(/is moved to .*09:00/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toContain('/appointments/APT-0123456789/reschedule')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(screen.queryByRole('button', { name: 'Move to next available' })).not.toBeInTheDocument()
  })

  it('shows the reason when a reschedule is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [{ ...appointment, window: 'open' }]))
      .mockResolvedValueOnce(reply(409, { error: 'Your consultant has no free time in the next two weeks. Please book again.' }))
      .mockResolvedValueOnce(reply(200, [{ ...appointment, window: 'open' }]))
    show(signedIn)
    await userEvent.click(await screen.findByRole('button', { name: 'Move to next available' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no free time')
  })

  it('opens a chat with the consultant while the window is open', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/messages') ? reply(200, []) : reply(200, [{ ...appointment, window: 'open' }]),
    )
    show(signedIn)
    await userEvent.click(await screen.findByRole('button', { name: 'Chat with Nomsa' }))
    expect(await screen.findByLabelText('Message to Nomsa')).toBeInTheDocument()
  })
})
