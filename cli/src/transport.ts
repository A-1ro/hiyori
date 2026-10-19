import { isIP } from 'node:net'

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || (
    isIP(hostname) === 4 && hostname.split('.')[0] === '127'
  )
}

/** Validate without including a potentially credential-bearing URL in errors. */
export function assertSecureUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('無効な URL です')
  }
  if (url.username || url.password) {
    throw new Error('URL にユーザー名やパスワードを含めることはできません')
  }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return
  throw new Error('HTTPS URL を使用してください。HTTP は localhost / loopback の開発環境のみ許可されます')
}

/** Do not forward credentials or device-code request bodies through redirects. */
export const cliFetch: typeof fetch = (input, init) => {
  assertSecureUrl(input instanceof Request ? input.url : String(input))
  return fetch(input, { ...init, redirect: 'error' })
}
