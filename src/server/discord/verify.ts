export async function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string,
): Promise<boolean> {
  if (signature.length !== 128 || !/^[0-9a-fA-F]+$/.test(signature)) return false
  if (publicKeyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(publicKeyHex)) return false
  try {
    const publicKey = hexToBytes(publicKeyHex)
    const sig = hexToBytes(signature)
    const key = await crypto.subtle.importKey(
      'raw',
      publicKey.buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const message = new TextEncoder().encode(timestamp + rawBody)
    return await crypto.subtle.verify('Ed25519', key, sig.buffer as ArrayBuffer, message.buffer as ArrayBuffer)
  } catch {
    return false
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
