import { describe, it, expect } from 'vitest'
import { signChannelToken, verifyChannelToken } from '../channel-token'

const SECRET = 'unit-test-secret'
const CHANNEL_ID = '12345678901234567'

describe('signChannelToken / verifyChannelToken', () => {
  it('正しく署名されたトークンを検証して channel ID を返す', async () => {
    const token = await signChannelToken(SECRET, CHANNEL_ID)
    const result = await verifyChannelToken(SECRET, token)
    expect(result).toEqual({ channelId: CHANNEL_ID })
  })

  it('異なる秘密鍵で検証すると null', async () => {
    const token = await signChannelToken(SECRET, CHANNEL_ID)
    expect(await verifyChannelToken('different-secret', token)).toBeNull()
  })

  it('署名を改ざんすると null', async () => {
    const token = await signChannelToken(SECRET, CHANNEL_ID)
    const [payload] = token.split('.')
    const tampered = `${payload}.AAAAAAAAAAAA`
    expect(await verifyChannelToken(SECRET, tampered)).toBeNull()
  })

  it('payload を別 channel ID に差し替えると署名不一致で null', async () => {
    const tokenA = await signChannelToken(SECRET, CHANNEL_ID)
    const tokenB = await signChannelToken(SECRET, '99999999999999999')
    const [payloadA] = tokenA.split('.')
    const [, sigB] = tokenB.split('.')
    const swapped = `${payloadA}.${sigB}`
    expect(await verifyChannelToken(SECRET, swapped)).toBeNull()
  })

  it('期限切れトークンは null', async () => {
    const token = await signChannelToken(SECRET, CHANNEL_ID, { ttlSeconds: -1 })
    expect(await verifyChannelToken(SECRET, token)).toBeNull()
  })

  it('壊れたフォーマット（ドット無し）は null', async () => {
    expect(await verifyChannelToken(SECRET, 'no-dot')).toBeNull()
    expect(await verifyChannelToken(SECRET, '')).toBeNull()
  })

  it('payload の channelId が snowflake 形式でないものは null', async () => {
    const bogus = await signChannelToken(SECRET, '123' /* too short */).catch(() => null)
    // sign 自体は通る（フォーマット検証は verify 側）
    expect(bogus).not.toBeNull()
    if (bogus) {
      expect(await verifyChannelToken(SECRET, bogus)).toBeNull()
    }
  })
})
