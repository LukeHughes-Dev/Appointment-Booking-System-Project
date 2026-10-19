import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { BookingPage } from './BookingPage'

const branches = [{ id: '1', name: 'Pretoria Menlyn', timezone: 'Africa/Johannesburg', closure: null }]
const slots = [
  { startsAt: '2030-01-07T06:00:00.000Z', endsAt: '2030-01-07T07:00:00.000Z', available: true, consultants: [{ id: '7', name: 'Nomsa' }] },
  { startsAt: '2030-01-07T07:00:00.000Z', endsAt: '2030-01-07T08:00:00.000Z', available: false, consultants: [] },
]
const booked = {
  reference: 'ABC123',
  confirmation: { to: 'client@example.com', message: 'Your Save appointment is booked. Reference: ABC123.' },
}

let fetchMock: ReturnType<typeof vi.fn>

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })

function show(session: AuthState['session'], signIn = vi.fn()) {
  const auth: AuthState = { session, loading: false, signIn, signOut: vi.fn() }
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/branches/1/book?service=Save&date=2030-01-07']}>
        <Routes>
          <Route path="/branches/:id/book" element={<BookingPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return signIn
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return reply(201, booked)
    if (url === '/api/appointments') return reply(200, [])
    return url.includes('/slots') ? reply(200, slots) : reply(200, branches)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('BookingPage', () => {
  it('shows taken times as unavailable', async () => {
    show(null)
    expect(await screen.findByRole('button', { name: '08:00' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '09:00' })).toBeDisabled()
  })

  it('greys out times that overlap the client\'s own appointment', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/appointments') {
        return reply(200, [{ reference: 'APT-1', startsAt: slots[0].startsAt, endsAt: '2030-01-07T06:30:00.000Z' }])
      }
      return url.includes('/slots') ? reply(200, slots) : reply(200, branches)
    })
    show({ name: 'Client', email: 'client@example.com', accessToken: 'tok' })
    await waitFor(() => expect(screen.getByRole('button', { name: '08:00' })).toBeDisabled())
  })

  it('asks a signed-out client to sign in before booking', async () => {
    const signIn = show(null)
    await userEvent.click(await screen.findByRole('button', { name: '08:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to book' }))
    expect(signIn).toHaveBeenCalledWith(expect.stringContaining('start=2030-01-07'))
  })

  it('books the chosen time and shows the confirmation', async () => {
    show({ name: 'Client', email: 'client@example.com', accessToken: 'tok' })
    await userEvent.click(await screen.findByRole('button', { name: '08:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(await screen.findByText(/Reference: ABC123/)).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ branchId: '1', service: 'Save', startsAt: slots[0].startsAt })
    expect(post[1].headers.Authorization).toBe('Bearer tok')
  })

  it('says so when someone else took the slot', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return reply(409, { error: 'That slot was just taken. Please choose another time.' })
      return url.includes('/slots') ? reply(200, slots) : reply(200, branches)
    })
    show({ name: 'Client', email: 'client@example.com', accessToken: 'tok' })
    await userEvent.click(await screen.findByRole('button', { name: '08:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('just taken'))
  })
})
