import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const BASE = 'https://example.com'

function preflight(origin: string, requestedHeaders: string) {
  return SELF.fetch(`${BASE}/api/events`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': requestedHeaders,
    },
  })
}

describe('API CORS preflight', () => {
  it('allows the same origin and normalizes requested header names', async () => {
    const response = await preflight(BASE, 'content-type,   authorization')
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(BASE)
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type,authorization')
  })

  it('does not allow a different origin', async () => {
    const response = await preflight('https://other.example', 'content-type')
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('handles whitespace-heavy requested headers', async () => {
    // Exercise the parser affected by GHSA-8j4g-w8fx-2239 without a timing assertion.
    const response = await preflight(BASE, `content-type,${' '.repeat(8000)}authorization`)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type,authorization')
  })
})
