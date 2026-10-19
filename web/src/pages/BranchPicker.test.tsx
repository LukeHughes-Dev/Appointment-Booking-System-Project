import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Branch } from '../types'
import { BranchPicker } from './BranchPicker'

const branch = (over: Partial<Branch>): Branch => ({
  id: '1',
  name: 'Pretoria Menlyn',
  timezone: 'Africa/Johannesburg',
  latitude: -25.78,
  longitude: 28.27,
  distanceKm: null,
  closure: null,
  ...over,
})

const hatfield = branch({
  id: '6',
  name: 'Pretoria Hatfield',
  closure: { from: '2026-11-02', to: '2027-01-31', reason: 'Planned branch revamp' },
})

let fetchMock: ReturnType<typeof vi.fn>

function answerWith(branches: Branch[]) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => branches })
}

function mockGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: impl },
  })
}

function show() {
  render(
    <MemoryRouter>
      <BranchPicker />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const lastUrl = () => String(fetchMock.mock.calls.at(-1)?.[0])

describe('BranchPicker', () => {
  it('lists the branches with a way to book', async () => {
    answerWith([branch({}), branch({ id: '2', name: 'Cape Town Waterfront' })])
    show()
    expect(await screen.findByRole('heading', { name: 'Pretoria Menlyn' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Book here' })[0]).toHaveAttribute('href', '/branches/1/book')
    expect(screen.queryByText(/km away/)).not.toBeInTheDocument()
  })

  it('searches by name as the client types', async () => {
    answerWith([branch({})])
    show()
    await screen.findByRole('heading', { name: 'Pretoria Menlyn' })

    await userEvent.type(screen.getByLabelText('Search branches'), 'menl')
    await waitFor(() => expect(lastUrl()).toBe('/api/branches?q=menl'))
  })

  it('says so when nothing matches', async () => {
    answerWith([])
    show()
    await userEvent.type(screen.getByLabelText('Search branches'), 'zzz')
    expect(await screen.findByText(/No branches match/)).toBeInTheDocument()
  })

  it('sorts by distance after the client allows location, sending a rounded position', async () => {
    answerWith([branch({ distanceKm: 0.8 })])
    mockGeolocation((ok) =>
      ok({ coords: { latitude: -25.78123, longitude: 28.27987 } } as GeolocationPosition),
    )
    show()
    await screen.findByRole('heading', { name: 'Pretoria Menlyn' })

    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    await waitFor(() => expect(lastUrl()).toBe('/api/branches?lat=-25.78&lng=28.28'))
    expect(await screen.findByText('0.8 km away')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop using my location' })).toBeInTheDocument()
  })

  it('carries on working when location is refused', async () => {
    answerWith([branch({})])
    mockGeolocation((_ok, fail) => fail({ code: 1 } as GeolocationPositionError))
    show()
    await screen.findByRole('heading', { name: 'Pretoria Menlyn' })

    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText(/Location is switched off/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pretoria Menlyn' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // no new search without a position
  })

  it('stops using the location when asked', async () => {
    answerWith([branch({ distanceKm: 0.8 })])
    mockGeolocation((ok) => ok({ coords: { latitude: -25.78, longitude: 28.28 } } as GeolocationPosition))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop using my location' }))
    await waitFor(() => expect(lastUrl()).toBe('/api/branches'))
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeInTheDocument()
  })

  it('shows a closed branch as closed and points to the nearest open one', async () => {
    answerWith([
      branch({ distanceKm: 0.8 }),
      { ...hatfield, distanceKm: 5.5 },
    ])
    mockGeolocation((ok) => ok({ coords: { latitude: -25.78, longitude: 28.28 } } as GeolocationPosition))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }))

    const closedCard = (await screen.findByRole('heading', { name: 'Pretoria Hatfield' })).closest('li')!
    expect(closedCard).toHaveTextContent('Closed until 31 January 2027 (planned branch revamp)')
    expect(closedCard).toHaveTextContent('Nearest open branch: Pretoria Menlyn (0.8 km)')
    expect(screen.getByRole('button', { name: 'Closed for now' })).toBeDisabled()
    expect(screen.getAllByRole('link', { name: 'Book here' })).toHaveLength(1)
  })

  it('tells the client when the branches cannot be loaded', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) })
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the branches')
  })
})
