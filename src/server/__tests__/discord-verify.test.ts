import { describe, it, expect } from 'vitest'
import { verifyDiscordSignature } from '../discord/verify'

async function generateKeyPair(): Promise<{ privateKey: CryptoKey; publicKeyHex: string }> {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const privateKey = (keyPair as CryptoKeyPair).privateKey
  const publicKey = (keyPair as CryptoKeyPair).publicKey
  const rawPublicKey = await crypto.subtle.exportKey('raw', publicKey)
  const publicKeyHex = Array.from(new Uint8Array(rawPublicKey))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { privateKey, publicKeyHex }
}

async function sign(privateKey: CryptoKey, message: string): Promise<string> {
  const encoded = new TextEncoder().encode(message)
  const sig = await crypto.subtle.sign('Ed25519', privateKey, encoded)
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyDiscordSignature', () => {
  it('T7: 正しい署名を検証する', async () => {
    const { privateKey, publicKeyHex } = await generateKeyPair()
    const rawBody = '{"type":1}'
    const timestamp = '1234567890'
    const signature = await sign(privateKey, timestamp + rawBody)

    const result = await verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex)
    expect(result).toBe(true)
  })

  it('T8: 不正署名を拒否する', async () => {
    const { publicKeyHex } = await generateKeyPair()
    const { privateKey: otherPrivateKey } = await generateKeyPair()

    const rawBody = '{"type":1}'
    const timestamp = '1234567890'
    const wrongSignature = await sign(otherPrivateKey, timestamp + rawBody)

    const result = await verifyDiscordSignature(rawBody, wrongSignature, timestamp, publicKeyHex)
    expect(result).toBe(false)
  })
})
