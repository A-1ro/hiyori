import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './return-to'

const bases = ['https://hiyori-schedule.com/api/auth/discord', 'https://e2e.hiyori-schedule.com/api/auth/discord/callback', 'http://localhost:5173/api/auth/discord']
const invalidReturnPaths: unknown[] = [
  undefined, null, 42, {}, ['/me'], '', 'me', '?tab=events', '#events',
  'https://other.invalid/', 'https://hiyori-schedule.com/me', 'javascript:alert(1)',
  '//other.invalid', '///other.invalid', '/\\other.invalid', '\\other.invalid', '/path\\name',
  '/%5cother.invalid', '/%255cother.invalid', '/%2fother.invalid', '/%252fother.invalid',
  '/%2f%5cother.invalid', '/%252f%255cother.invalid',
  '/a/..//other.invalid', '/a/%2e%2e//other.invalid', '/a/%252e%252e/%252fother.invalid',
  '/\t/other.invalid', '/\r\n/other.invalid', '/%09/other.invalid', '/%250a/other.invalid',
  '/me?x=\u0000', '/me?x=%0d%0aLocation:other', '/me?x=%2500', '/me#%7f',
  `/${'%25'.repeat(1)}25252525252525252fother.invalid`,
]
const accepted = [
  ['/', '/'], ['/me', '/me'], ['/events/abc?tab=vote#answers', '/events/abc?tab=vote#answers'],
  ['/events/new?channelToken=abc.def_ghi-123', '/events/new?channelToken=abc.def_ghi-123'],
  ['/cli?code=ABCD-EFGH', '/cli?code=ABCD-EFGH'],
  ['/oauth/authorize?client_id=fixture&scope=hiyori%3Aread+hiyori%3Awrite', '/oauth/authorize?client_id=fixture&scope=hiyori%3Aread+hiyori%3Awrite'],
  ['/help?q=%E6%97%A5%E7%A8%8B&percent=100%25', '/help?q=%E6%97%A5%E7%A8%8B&percent=100%25'],
  ['/help?q=a%26b%3Dc&next=%2Fme', '/help?q=a%26b%3Dc&next=%2Fme'],
  ['/events/../me?tab=events', '/me?tab=events'], ['/a/./b?next=https%3A%2F%2Fother.invalid', '/a/b?next=https%3A%2F%2Fother.invalid'],
  ['/help?q=日程 調整', '/help?q=%E6%97%A5%E7%A8%8B%20%E8%AA%BF%E6%95%B4'],
] as const

describe.each(bases)('safeReturnTo against %s', (base) => {
  it.each(invalidReturnPaths.map((value, i) => ({ value, label: `unsafe case ${i}` })))('$label falls back to /', ({ value }) => {
    expect(safeReturnTo(value, base)).toBe('/')
  })
  it.each(accepted)('preserves or normalizes %s without changing the origin', (value, expected) => {
    const result = safeReturnTo(value, base)
    expect(result).toBe(expected)
    expect(new URL(result, base).origin).toBe(new URL(base).origin)
    expect(safeReturnTo(result, base)).toBe(result)
  })
})
