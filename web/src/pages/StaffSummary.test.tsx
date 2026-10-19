import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { StaffSummary } from './StaffSummary'

const data = [
  {
    branch: { id: '4', name: 'Pretoria Menlyn' },
    totals: { upcoming: 1, attended: 3, noShow: 1, notRecorded: 2, cancelled: 0 },
    consultants: [
      { consultant: { id: '7', name: 'Nomsa' }, upcoming: 1, attended: 3, noShow: 1, notRecorded: 2, cancelled: 0 },
    ],
  },
]
let fetchMock: ReturnType<typeof vi.fn>
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })

function show() {
  const auth: AuthState = {
    session: { name: 'Manager', email: 'manager@example.com', accessToken: 'tok', roles: ['manager'] },
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }
  render(
    <AuthContext.Provider value={auth}>
      <StaffSummary />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('StaffSummary', () => {
  it('shows each branch with its consultants and a branch total', async () => {
    fetchMock.mockResolvedValue(reply(200, data))
    show()
    const table = await screen.findByRole('table', { name: 'Pretoria Menlyn' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/staff\/summary\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
    const nomsa = within(table).getByRole('row', { name: /Nomsa/ })
    expect(within(nomsa).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '3', '1', '2', '0'])
    expect(within(table).getByRole('row', { name: /Branch total/ })).toBeInTheDocument()
  })

  it('says so when there is nothing in the period', async () => {
    fetchMock.mockResolvedValue(reply(200, []))
    show()
    expect(await screen.findByText('No appointments in this period.')).toBeInTheDocument()
  })

  it('explains when the person is not a manager', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: 'You do not have access to this' }))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('This page is for managers.')
  })

  it('shows the message when no branch is linked to the manager', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: 'No branch is linked to this sign-in' }))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('No branch is linked to this sign-in')
  })
})
