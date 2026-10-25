// OAuth return destinations remain origin-relative paths. Validate with the same
// WHATWG URL parser as browsers, both before putting a path in state and again
// before emitting Location. State's return path is untrusted even with valid CSRF.
export function safeReturnTo(value: unknown, requestUrl: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/'
  try {
    const origin = new URL(requestUrl).origin
    const normalized = new URL(value, origin)
    let candidate = value
    // Inspect decoded variants without using them as the returned destination:
    // query encodings (including literal percent signs) must remain intact.
    for (let depth = 0; depth < 8; depth++) {
      if (!candidate.startsWith('/') || candidate.startsWith('//') ||
        [...candidate].some((char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return '/'
      const parsed = new URL(candidate, origin)
      // A normalized pathname beginning // would become an authority if emitted
      // as a relative Location, even if the input URL initially had this origin.
      if (parsed.origin !== origin || parsed.pathname.startsWith('//')) return '/'
      const decoded = candidate.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      if (decoded === candidate) {
        const location = normalized.pathname + normalized.search + normalized.hash
        return new URL(location, origin).origin === origin ? location : '/'
      }
      candidate = decoded
    }
  } catch { /* Invalid or excessively encoded destinations fail closed. */ }
  return '/'
}
