import { hc } from 'hono/client'
import type { AppType } from '../../src/server/index'
import { assertSecureUrl, cliFetch } from './transport.js'

export class HiyoriApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HiyoriApiError'
  }
}

export const createCliApi = (apiUrl: string, token?: string) => {
  assertSecureUrl(apiUrl)
  return hc<AppType>(apiUrl, {
    fetch: cliFetch,
    headers: () => (token ? { Authorization: `Bearer ${token}` } : ({ } as Record<string, string>)),
  })
}

export type CliApi = ReturnType<typeof createCliApi>

interface ResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export async function unwrap<T>(res: ResponseLike): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore parse errors
    }
    throw new HiyoriApiError(res.status, message)
  }
  return res.json() as Promise<T>
}
