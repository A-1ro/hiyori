import { hc } from 'hono/client'
import type { AppType } from '../../src/server/index'

export class HiyoriApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HiyoriApiError'
  }
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  )
}

export const createCliApi = (apiUrl: string, token?: string) => {
  if (token) {
    try {
      const u = new URL(apiUrl)
      if (u.protocol === 'http:' && !isLocalHost(u.hostname)) {
        console.error('警告: 平文 HTTP に認証トークンを送信します')
      }
    } catch {
      // ignore invalid URL
    }
  }
  return hc<AppType>(apiUrl, {
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
