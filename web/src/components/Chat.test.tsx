import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Chat } from './Chat'

const PATH = '/appointments/APT-0123456789/messages'
let fetchMock: ReturnType<typeof vi.fn>
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: '', json: async () => body })

function show() {
  render(<Chat path={PATH} token="tok" me="client" otherName="Nomsa" />)
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('Chat', () => {
  it('shows the thread so far', async () => {
    fetchMock.mockResolvedValue(
      reply(200, [
        { id: '1', from: 'client', body: 'I am at the door', sentAt: '2030-01-07T05:56:00.000Z' },
        { id: '2', from: 'consultant', body: 'Coming now', sentAt: '2030-01-07T05:57:00.000Z' },
      ]),
    )
    show()
    expect(await screen.findByText('I am at the door')).toBeInTheDocument()
    expect(screen.getByText('Coming now')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toContain(`${PATH}?after=0`)
  })

  it('sends a message and shows it', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, []))
      .mockResolvedValueOnce(reply(201, { id: '5', from: 'client', body: 'Hello', sentAt: '2030-01-07T05:56:00.000Z' }))
    show()
    await screen.findByText(/No messages yet/)
    await userEvent.type(screen.getByLabelText('Message to Nomsa'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ body: 'Hello' })
  })

  it('shows the reason when sending is refused and keeps the draft', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, []))
      .mockResolvedValueOnce(reply(409, { error: 'Messages can only be sent during the window.' }))
    show()
    await screen.findByText(/No messages yet/)
    await userEvent.type(screen.getByLabelText('Message to Nomsa'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('during the window')
    expect(screen.getByLabelText('Message to Nomsa')).toHaveValue('Hello')
  })

  it('does not allow sending an empty message', async () => {
    fetchMock.mockResolvedValue(reply(200, []))
    show()
    await screen.findByText(/No messages yet/)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })
})
