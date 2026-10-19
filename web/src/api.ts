import { config } from './config'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface Options {
  token?: string | null
  signal?: AbortSignal
  method?: string
  body?: unknown
}

export async function apiFetch<T>(path: string, { token, signal, method, body }: Options = {}): Promise<T> {
  const response = await fetch(`${config.apiBase}${path}`, {
    signal,
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(response.status, body.error ?? response.statusText)
  }
  return response.json() as Promise<T>
}
