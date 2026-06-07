// Alphabet excludes visually ambiguous characters (I, O, 0, 1).
// 24 letters + 8 digits = 32 chars. Power-of-2 alphabet means floor(256/32)*32 = 256,
// so rejection sampling threshold is never reached (no bias exists with 32-char alphabet).
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ALPHABET_LEN = USER_CODE_ALPHABET.length // 32
const REJECTION_THRESHOLD = Math.floor(256 / ALPHABET_LEN) * ALPHABET_LEN // 256

export function generateDeviceCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateUserCode(): string {
  const chars: string[] = []
  // Rejection sampling: discard bytes >= REJECTION_THRESHOLD to eliminate modulo bias.
  // With ALPHABET_LEN=32, REJECTION_THRESHOLD=256, so no byte is ever discarded.
  while (chars.length < 8) {
    const buf = crypto.getRandomValues(new Uint8Array(8))
    for (const byte of buf) {
      if (byte >= REJECTION_THRESHOLD) continue
      chars.push(USER_CODE_ALPHABET[byte % ALPHABET_LEN]!)
      if (chars.length === 8) break
    }
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`
}

export function normalizeUserCode(input: string): string {
  const upper = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (upper.length === 8) {
    return `${upper.slice(0, 4)}-${upper.slice(4)}`
  }
  return upper
}
