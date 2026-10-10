import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EventComposer, type EventComposerProps } from './EventComposer'

const FIRST_NAME = 'first_friend'
const SECOND_NAME = 'another.friend'
const INVITE_LABEL = '招待する Discord ユーザー名（任意）'

function renderComposer(overrides: Partial<EventComposerProps> = {}) {
  const onSubmit = vi.fn()
  render(<EventComposer mode="create" initial={{ title: 'テストイベント', dates: new Set(['2027-01-01']) }} submitLabel="作成する" submittingLabel="作成中..." isSubmitting={false} onSubmit={onSubmit} {...overrides} />)
  return { onSubmit }
}
function selectInviteOnly() {
  fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))
  return screen.getByRole('textbox', { name: INVITE_LABEL }) as HTMLInputElement
}
function submitButton() {
  return screen.getByRole('button', { name: '作成する' }) as HTMLButtonElement
}

describe('EventComposer のユーザー名招待', () => {
  it('公開範囲の直下に 1 人ずつのユーザー名欄を表示し、ID 切替を置かない', () => {
    renderComposer()
    expect(screen.queryByRole('textbox', { name: INVITE_LABEL })).toBeNull()
    const input = selectInviteOnly()
    const field = input.parentElement!.parentElement!.parentElement!.parentElement!
    expect(screen.getByText('公開範囲').parentElement!.nextElementSibling).toBe(field)
    expect(field.nextElementSibling!.textContent).toContain('所要時間')
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /^ユーザー ID/ })).toBeNull()
    expect(screen.getByText(/表示名やサーバー内のニックネームではありません/)).toBeTruthy()
    expect(screen.getByText(/最初の受取り時にその名前を持つアカウント/)).toBeTruthy()
  })

  it('入力ごとに次の欄を表示し、空白・@・大文字と重複を整理して送る', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(selectInviteOnly(), { target: { value: ' @First_Friend ' } })
    fireEvent.change(screen.getByRole('textbox', { name: `${INVITE_LABEL} 2 人目` }), { target: { value: SECOND_NAME } })
    fireEvent.change(screen.getByRole('textbox', { name: `${INVITE_LABEL} 3 人目` }), { target: { value: FIRST_NAME } })
    expect((screen.getByRole('textbox', { name: `${INVITE_LABEL} 4 人目` }) as HTMLInputElement).value).toBe('')
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'invite_only', invitedDiscordUsernames: [FIRST_NAME, SECOND_NAME], candidates: expect.any(Array) }))
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUserIds')
  })

  it('数字だけの文字列もユーザー名として送る', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(selectInviteOnly(), { target: { value: '123456789012345678' } })
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0].invitedDiscordUsernames).toEqual(['123456789012345678'])
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUserIds')
  })

  it.each(['@', 'a', 'a..b', '表示名', 'name#1234', 'a'.repeat(33), 'first_friend,another.friend'])(
    '不正なユーザー名 %s では送信せず、誤りのある欄だけにエラーを付ける', (invalid) => {
      const { onSubmit } = renderComposer()
      const first = selectInviteOnly()
      fireEvent.change(first, { target: { value: FIRST_NAME } })
      const second = screen.getByRole('textbox', { name: `${INVITE_LABEL} 2 人目` })
      fireEvent.change(second, { target: { value: invalid } })
      const error = screen.getByRole('alert')
      expect(error.textContent).toContain('2〜32 文字')
      expect(first.getAttribute('aria-invalid')).toBe('false')
      expect(second.getAttribute('aria-invalid')).toBe('true')
      expect(second.getAttribute('aria-describedby')).toContain(error.id)
      expect(submitButton().disabled).toBe(true)
      fireEvent.click(submitButton())
      expect(onSubmit).not.toHaveBeenCalled()
      fireEvent.change(second, { target: { value: SECOND_NAME } })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(submitButton().disabled).toBe(false)
    },
  )

  it('重複を除いた上限は 500 人で、貼り付けも個別の欄に分ける', () => {
    const { onSubmit } = renderComposer()
    const names = Array.from({ length: 501 }, (_, i) => `friend_${i}`)
    fireEvent.paste(selectInviteOnly(), { clipboardData: { getData: () => names.join('\n') } })
    expect(screen.getByRole('alert').textContent).toContain('500 人まで')
    expect(submitButton().disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: `${INVITE_LABEL} 501 人目` }), { target: { value: names[0] } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0].invitedDiscordUsernames).toEqual(names.slice(0, 500))
  })

  it('未入力でも招待限定を作成できる', () => {
    const { onSubmit } = renderComposer()
    selectInviteOnly()
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0].invitedDiscordUsernames).toEqual([])
  })

  it('公開では非表示の招待を送らず、招待限定に戻すと下書きを保つ', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(selectInviteOnly(), { target: { value: 'invalid name' } })
    fireEvent.click(screen.getByRole('radio', { name: /^公開 / }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUsernames')
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUserIds')
    expect(selectInviteOnly().value).toBe('invalid name')
    expect(submitButton().disabled).toBe(true)
  })

  it('編集時の招待管理も公開範囲の直下に置き、作成用招待を送らない', () => {
    const { onSubmit } = renderComposer({ mode: 'edit', inviteManager: <section aria-label="招待管理">既存の招待管理</section> })
    const manager = screen.getByRole('region', { name: '招待管理' })
    expect(screen.getByText('公開範囲').parentElement!.nextElementSibling).toBe(manager)
    fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))
    expect(screen.getByRole('region', { name: '招待管理' })).toBe(manager)
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUsernames')
  })
})
