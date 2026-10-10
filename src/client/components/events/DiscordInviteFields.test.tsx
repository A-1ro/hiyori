import { describe, expect, it } from 'vitest'
import { validateDiscordInviteNames } from './DiscordInviteFields'

describe('招待ユーザー名の下書き検証', () => {
  it('ユーザー名を正規化し、空欄と重複だけを除く', () => {
    expect(validateDiscordInviteNames(['', ' @First_Friend ', 'first_friend', '12345678901234567'])).toEqual({ usernames: ['first_friend', '12345678901234567'], error: undefined })
    expect(validateDiscordInviteNames(['@']).error).toBeTruthy()
  })

  it('既存の数値 ID 招待も件数に含め、全体で 500 件に制限する', () => {
    const existing = Array.from({ length: 500 }, (_, i) => ({ discordUserId: String(10000000000000000n + BigInt(i)), discordUsername: null }))
    expect(validateDiscordInviteNames(['new_friend'], existing).error).toContain('500 人まで')
    expect(validateDiscordInviteNames(['new_friend'], existing.slice(0, 499)).error).toBeUndefined()
  })

  it('既存と同じ名前の再追加は上限件数を増やさない', () => {
    const existing = Array.from({ length: 500 }, (_, i) => ({ discordUserId: null, discordUsername: `friend_${i}` }))
    expect(validateDiscordInviteNames(['@Friend_0', 'friend_0'], existing).error).toBeUndefined()
  })
})
