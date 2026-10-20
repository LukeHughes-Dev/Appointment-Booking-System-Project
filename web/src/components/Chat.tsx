import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../api'
import type { ChatMessage } from '../types'

const POLL_MS = 3000

interface ChatProps {
  path: string // e.g. /appointments/APT-…/messages
  token: string | undefined
  me: ChatMessage['from'] // which side this screen is, so our messages sit on the right
  otherName: string
}

// A short chat for one appointment. It polls for newer messages while it is on screen.
export function Chat({ path, token, me, otherName }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lastId = useRef('0')

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()

    async function fetchNew() {
      try {
        const fresh = await apiFetch<ChatMessage[]>(`${path}?after=${lastId.current}`, {
          token,
          signal: controller.signal,
        })
        if (fresh.length > 0) {
          lastId.current = fresh[fresh.length - 1].id
          setMessages((current) => [...current, ...fresh])
        }
      } catch {
        // A missed poll is harmless: the next one catches up.
      }
    }

    const first = setTimeout(() => void fetchNew(), 0)
    const poll = setInterval(() => void fetchNew(), POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(poll)
      controller.abort()
    }
  }, [path, token])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    setError(null)
    try {
      const sent = await apiFetch<ChatMessage>(path, { method: 'POST', token, body: { body } })
      setDraft('')
      // The poll may already have fetched it: only add it if it is new.
      if (BigInt(sent.id) > BigInt(lastId.current)) {
        lastId.current = sent.id
        setMessages((current) => [...current, sent])
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Your message was not sent. Please try again.')
    }
  }

  return (
    <section className="chat" aria-label={`Chat with ${otherName}`}>
      <ul className="chat-messages" aria-live="polite">
        {messages.length === 0 && <li className="chat-empty">No messages yet. Say hello to {otherName}.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.from === me ? 'chat-bubble mine' : 'chat-bubble theirs'}>
            {m.body}
          </li>
        ))}
      </ul>
      {error && <p className="notice error" role="alert">{error}</p>}
      <form className="chat-form" onSubmit={(e) => void send(e)}>
        <input
          type="text"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Message to ${otherName}`}
          placeholder="Type a message"
        />
        <button type="submit" className="button" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
