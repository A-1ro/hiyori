// /hiyori new スラッシュコマンド由来の Discord チャンネル ID を Hiyori 自身が HMAC で
// 署名し、イベント作成時のクライアントから提示させて検証する。これにより
// 「Hiyori にログインした任意のユーザーが任意のチャンネル ID を貼って Bot に投稿させる」
// 攻撃ベクトルを塞ぐ（Discord 側のスラッシュコマンド実行権限が暗黙のチャンネル所属チェックになる）。

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 日

interface ChannelTokenPayload {
  channelId: string
  expiresAt: number // unix seconds
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (normalized.length % 4)) % 4
  const decoded = atob(normalized + '='.repeat(pad))
  const buf = new ArrayBuffer(decoded.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

export async function signChannelToken(
  secret: string,
  channelId: string,
  options: { ttlSeconds?: number; now?: () => Date } = {},
): Promise<string> {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const now = options.now ?? (() => new Date())
  const payload: ChannelTokenPayload = {
    channelId,
    expiresAt: Math.floor(now().getTime() / 1000) + ttl,
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const key = await importHmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes))
  return `${toBase64Url(payloadBytes)}.${toBase64Url(sig)}`
}

export async function verifyChannelToken(
  secret: string,
  token: string,
  options: { now?: () => Date } = {},
): Promise<{ channelId: string } | null> {
  const now = options.now ?? (() => new Date())
  const parts = token.split('.')
  if (parts.length !== 2) return null

  let payloadBytes: Uint8Array<ArrayBuffer>
  let sigBytes: Uint8Array<ArrayBuffer>
  try {
    payloadBytes = fromBase64Url(parts[0]!)
    sigBytes = fromBase64Url(parts[1]!)
  } catch {
    return null
  }

  const key = await importHmacKey(secret)
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes)
  if (!valid) return null

  let payload: ChannelTokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as ChannelTokenPayload
  } catch {
    return null
  }
  if (typeof payload.channelId !== 'string' || !/^\d{17,20}$/.test(payload.channelId)) return null
  if (typeof payload.expiresAt !== 'number') return null
  if (Math.floor(now().getTime() / 1000) > payload.expiresAt) return null
  return { channelId: payload.channelId }
}
