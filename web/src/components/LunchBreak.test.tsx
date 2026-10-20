import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LunchBreak } from './LunchBreak'

const day = {
  date: '2099-01-05',
  timezone: 'Africa/Johannesburg',
  totalMinutes: 60,
  breaks: [{ start: '13:00', end: '14:00', source: 'scheduled' as const }],
  clashes: [],
}
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })

let fetchMock: ReturnType<typeof vi.fn>
const show = (canEdit = true) => render(<LunchBreak date="2099-01-05" token="tok" canEdit={canEdit} />)

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('LunchBreak', () => {
  it('shows the day\'s lunch', async () => {
    fetchMock.mockResolvedValue(reply(200, day))
    show()
    expect(await screen.findByText('13:00–14:00')).toBeInTheDocument()
  })

  it('shows nothing on a day with no lunch, such as a day off', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: 'You are not working at a branch on that day.' }))
    show()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('Lunch')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('moves lunch: only saves when the total time is the same', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, day))
      .mockResolvedValueOnce(reply(200, { ...day, breaks: [{ start: '15:00', end: '16:00', source: 'edited' }] }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Move lunch' }))
    const end = screen.getByLabelText('Lunch 1 end')
    await userEvent.clear(end)
    await userEvent.type(end, '14:30')
    expect(screen.getByRole('button', { name: 'Save lunch' })).toBeDisabled()
    expect(screen.getByText(/Total 90 minutes, it must be 60/)).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Lunch 1 start'))
    await userEvent.type(screen.getByLabelText('Lunch 1 start'), '14:00')
    await userEvent.clear(end)
    await userEvent.type(end, '15:00')
    await userEvent.click(screen.getByRole('button', { name: 'Save lunch' }))

    expect(await screen.findByText(/15:00–16:00 \(changed by you\)/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ breaks: [{ start: '14:00', end: '15:00' }] })
  })

  it('splits lunch into two halves to adjust', async () => {
    fetchMock.mockResolvedValue(reply(200, day))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Split lunch' }))
    expect(screen.getByLabelText('Lunch 1 start')).toHaveValue('13:00')
    expect(screen.getByLabelText('Lunch 1 end')).toHaveValue('13:30')
    expect(screen.getByLabelText('Lunch 2 start')).toHaveValue('14:30')
    expect(screen.getByLabelText('Lunch 2 end')).toHaveValue('15:00')
    expect(screen.getByRole('button', { name: 'Save lunch' })).toBeEnabled()
  })

  it('warns when lunch overlaps a booked appointment, which stays', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { ...day, clashes: [{ reference: 'APT-0123456789', service: 'Save', startsAt: '2099-01-05T11:00:00.000Z', endsAt: '2099-01-05T12:00:00.000Z' }] }),
    )
    show()
    expect(await screen.findByText(/Lunch overlaps Save at 13:00 \(APT-0123456789\)/)).toBeInTheDocument()
    expect(screen.getByText(/Booked appointments stay/)).toBeInTheDocument()
  })

  it('shows the reason when a change is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, day))
      .mockResolvedValueOnce(reply(422, { error: 'The break pieces cannot overlap each other.' }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Split lunch' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save lunch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot overlap')
  })

  it('offers no editing for a day that is over', async () => {
    fetchMock.mockResolvedValue(reply(200, day))
    show(false)
    await screen.findByText('13:00–14:00')
    expect(screen.queryByRole('button', { name: 'Move lunch' })).not.toBeInTheDocument()
  })
})
