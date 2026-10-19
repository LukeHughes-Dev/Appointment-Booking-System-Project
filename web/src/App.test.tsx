import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AuthContext, type AuthState } from './auth/AuthContext'

const consultant = { name: 'Nomsa', email: 'nomsa@example.com', accessToken: 'tok', roles: ['consultant'] }
const manager = { name: 'Manager', email: 'manager@example.com', accessToken: 'tok', roles: ['manager'] }
const client = { name: 'Client', email: 'client@example.com', accessToken: 'tok', roles: [] }

function show(session: AuthState['session'], path = '/') {
  const auth: AuthState = { session, loading: false, signIn: vi.fn(), signOut: vi.fn() }
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: '', json: async () => [] })))
})
afterEach(() => vi.unstubAllGlobals())

describe('the two shells', () => {
  it('sends a signed-in consultant from the client home page to My day, with no client links', async () => {
    show(consultant)
    expect(await screen.findByRole('heading', { name: 'My day' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Find a branch' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My appointments' })).not.toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
  })

  it('starts a manager on the branch summary', async () => {
    show(manager)
    expect(await screen.findByRole('heading', { name: 'Branch summary' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My day' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument()
  })

  it('shows a client the branch finder and My appointments, and no staff links', async () => {
    show(client)
    expect(await screen.findByRole('heading', { name: /branch/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My appointments' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My day' })).not.toBeInTheDocument()
  })

  it('shows a signed-out visitor to /staff a staff sign-in and no client content', () => {
    show(null, '/staff')
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Find a branch' })).not.toBeInTheDocument()
  })

  it('tells a client who opens /staff that it is for staff', () => {
    show(client, '/staff')
    expect(screen.getByRole('heading', { name: 'This area is for staff' })).toBeInTheDocument()
  })

  it('remembers a staff device: the root address goes to the staff sign-in', async () => {
    show(consultant)
    await screen.findByRole('heading', { name: 'My day' })
    expect(localStorage.getItem('shell')).toBe('staff')
  })

  it('sends a signed-out visitor on a staff device to the staff sign-in, and others to branches', async () => {
    localStorage.setItem('shell', 'staff')
    show(null)
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument()
  })

  it('lets a visitor leave the staff sign-in for the client site and forgets the staff device', async () => {
    localStorage.setItem('shell', 'staff')
    show(null, '/staff')
    await userEvent.click(screen.getByRole('link', { name: 'Looking for the client site?' }))
    expect(await screen.findByRole('heading', { name: /branch/i })).toBeInTheDocument()
    expect(localStorage.getItem('shell')).toBeNull()
  })

  it('forgets the staff device when staff sign out', async () => {
    const signOut = vi.fn()
    localStorage.setItem('shell', 'staff')
    render(
      <AuthContext.Provider value={{ session: consultant, loading: false, signIn: vi.fn(), signOut }}>
        <MemoryRouter initialEntries={['/staff']}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
    expect(localStorage.getItem('shell')).toBeNull()
  })

  it('shows a signed-out visitor on a normal device the branch finder', async () => {
    show(null)
    expect(await screen.findByRole('heading', { name: /branch/i })).toBeInTheDocument()
  })
})
