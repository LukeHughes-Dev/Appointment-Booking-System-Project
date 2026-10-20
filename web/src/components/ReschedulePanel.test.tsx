import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReschedulePanel } from './ReschedulePanel'

const appointment = {
  reference: 'APT-0123456789',
  branch: { id: '4', name: 'Pretoria Menlyn', timezone: 'Africa/Johannesburg' },
  consultant: { id: '7', name: 'Nomsa' },
  service: 'Save',
  startsAt: '2030-01-07T08:00:00.000Z', // 10:00 on a Monday
  endsAt: '2030-01-07T09:00:00.000Z',
  window: 'upcoming' as const,
}
const confirmation = (who: string) => ({ to: 'client@example.com', message: `Your Save appointment with ${who} has moved. Reference: APT-0123456789.` })
const NOMSA = { id: '7', name: 'Nomsa' }
const JOHAN = { id: '8', name: 'Johan' }
const slot = (startsAt: string, consultants: { id: string; name: string }[]) => ({
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString(),
  available: consultants.length > 0,
  consultants,
})
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })

let fetchMock: ReturnType<typeof vi.fn>
const onMoved = vi.fn()

// Answers each call by its method and address, so the order of the calls does not matter.
type Answer = (url: string) => ReturnType<typeof reply>
function api(routes: Record<string, Answer>) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    const match = Object.keys(routes).find((r) => r.startsWith(`${method} `) && url.includes(r.slice(method.length + 1)))
    if (!match) throw new Error(`Unexpected call: ${method} ${url}`)
    return routes[match]!(url)
  })
}

function show(others: typeof appointment[] = []) {
  render(<ReschedulePanel appointment={appointment} others={others} token="tok" onMoved={onMoved} onClose={vi.fn()} />)
}

beforeEach(() => {
  fetchMock = vi.fn()
  onMoved.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('ReschedulePanel', () => {
  it('moves to a chosen time when the consultant is free', async () => {
    api({
      'GET /slots': () => reply(200, [slot('2030-01-07T11:00:00.000Z', [NOMSA, JOHAN])]),
      'POST /reschedule': () => reply(200, { confirmation: confirmation('Nomsa') }),
    })
    show()
    await userEvent.click(await screen.findByRole('button', { name: '13:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move to 13:00 with Nomsa' }))
    expect(onMoved).toHaveBeenCalledWith(expect.stringContaining('has moved. Reference: APT-0123456789. A confirmation was sent to client@example.com (simulated)'))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ startsAt: '2030-01-07T11:00:00.000Z' })
  })

  it('asks what to do when the consultant is not free then, and lets the client see someone else', async () => {
    api({
      'GET /slots': () => reply(200, [slot('2030-01-07T11:00:00.000Z', [JOHAN])]),
      'POST /reschedule': () => reply(200, { confirmation: confirmation('Johan') }),
    })
    show()
    await userEvent.click(await screen.findByRole('button', { name: '13:00' }))
    expect(screen.getByText(/Nomsa is not available at 13:00/)).toBeInTheDocument()
    expect(screen.getByText(/see someone else, or would you like to see the next available time for Nomsa/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'See someone else' }))
    await userEvent.selectOptions(screen.getByLabelText('Consultant'), 'Johan')
    await userEvent.click(screen.getByRole('button', { name: 'Move with this consultant' }))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ startsAt: '2030-01-07T11:00:00.000Z', consultantId: '8' })
    expect(onMoved).toHaveBeenCalledWith(expect.stringContaining('with Johan'))
  })

  it('shows the consultant\'s next available times, which can be on another day, and moves to one', async () => {
    const later = '2030-01-09T07:00:00.000Z' // Wednesday 09:00
    api({
      'GET /slots': (url) =>
        reply(200, [slot(url.includes('2030-01-09') ? later : '2030-01-07T11:00:00.000Z', url.includes('2030-01-09') ? [NOMSA] : [JOHAN])]),
      'GET /next-available': () => reply(200, [slot(later, [NOMSA])]),
      'POST /reschedule': () => reply(200, { confirmation: confirmation('Nomsa') }),
    })
    show()
    await userEvent.click(await screen.findByRole('button', { name: '13:00' }))
    await userEvent.click(screen.getByRole('button', { name: /Nomsa's next available time/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Wednesday 9 January/ }))
    await userEvent.click(await screen.findByRole('button', { name: /^Move to 09:00 with Nomsa/ }))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ startsAt: later })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('consultantId=7'))).toBe(true)
  })

  it('asks the same question when the API says the consultant was taken meanwhile', async () => {
    api({
      'GET /slots': () => reply(200, [slot('2030-01-07T11:00:00.000Z', [NOMSA, JOHAN])]),
      'POST /reschedule': () =>
        reply(409, { error: 'Nomsa is not available at that time.', code: 'consultant_unavailable', available: [JOHAN] }),
    })
    show()
    await userEvent.click(await screen.findByRole('button', { name: '13:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move to 13:00 with Nomsa' }))
    expect(await screen.findByText(/Nomsa is not available at 13:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See someone else' })).toBeInTheDocument()
    expect(onMoved).not.toHaveBeenCalled()
  })

  it('greys out times that clash with the client\'s other appointments', async () => {
    api({ 'GET /slots': () => reply(200, [slot('2030-01-07T11:00:00.000Z', [NOMSA])]) })
    show([{ ...appointment, reference: 'APT-0000000002', startsAt: '2030-01-07T11:00:00.000Z', endsAt: '2030-01-07T12:00:00.000Z' }])
    expect(await screen.findByRole('button', { name: '13:00' })).toBeDisabled()
  })
})
