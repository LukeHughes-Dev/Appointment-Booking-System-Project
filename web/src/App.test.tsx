import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AuthContext, type AuthState } from './auth/AuthContext'

function show(session: AuthState['session']) {
  const auth: AuthState = { session, loading: false, signIn: vi.fn(), signOut: vi.fn() }
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: '', json: async () => [] })))
})
afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('starts a consultant on My day, with no client links', async () => {
    show({ name: 'Nomsa', email: 'nomsa@example.com', accessToken: 'tok', roles: ['consultant'] })
    expect(await screen.findByRole('heading', { name: 'My day' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Find a branch' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My appointments' })).not.toBeInTheDocument()
  })

  it('shows a client the branch finder and My appointments', async () => {
    show({ name: 'Client', email: 'client@example.com', accessToken: 'tok', roles: [] })
    expect(await screen.findByRole('heading', { name: /branch/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My appointments' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My day' })).not.toBeInTheDocument()
  })
})
