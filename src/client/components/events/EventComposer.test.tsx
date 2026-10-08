import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EventComposer, type EventComposerProps } from './EventComposer'

const FIRST_ID = '12345678901234567'
const SECOND_ID = '23456789012345678901'
const INVITE_LABEL = '招待する Discord ユーザー ID（任意）'

function renderComposer(overrides: Partial<EventComposerProps> = {}) {
  const onSubmit = vi.fn()
  render(
    <EventComposer
      mode="create"
      initial={{ title: 'テストイベント', dates: new Set(['2027-01-01']) }}
      submitLabel="作成する"
      submittingLabel="作成中..."
      isSubmitting={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { onSubmit }
}

function selectInviteOnly() {
  fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))
  return screen.getByRole('textbox', { name: INVITE_LABEL }) as HTMLTextAreaElement
}

function submitButton() {
  return screen.getByRole('button', { name: '作成する' }) as HTMLButtonElement
}

describe('EventComposer の作成時招待', () => {
  it('招待限定を選ぶと、公開範囲のすぐ下にラベル付き入力欄を表示する', () => {
    renderComposer()
    expect(screen.queryByRole('textbox', { name: INVITE_LABEL })).toBeNull()

    const input = selectInviteOnly()
    const visibilityField = screen.getByText('公開範囲').parentElement!
    expect(visibilityField.nextElementSibling).toBe(input.parentElement)
    expect(input.parentElement!.nextElementSibling!.textContent).toContain('所要時間')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText(/DM は自動送信されない/)).toBeTruthy()
  })

  it('改行・カンマで入力した ID の空白と空行を除き、重複をまとめて送る', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(selectInviteOnly(), {
      target: { value: `  ${FIRST_ID}  ,\n${SECOND_ID}\r\n\n, ${FIRST_ID} , ` },
    })
    fireEvent.click(submitButton())

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      visibility: 'invite_only',
      invitedDiscordUserIds: [FIRST_ID, SECOND_ID],
      candidates: expect.any(Array),
    }))
  })

  it.each(['1234567890123456', '123456789012345678901', '1234567890123456a', '<@12345678901234567>'])(
    '不正な ID %s では作成せず、入力欄にエラーを関連付ける',
    (invalidId) => {
      const { onSubmit } = renderComposer()
      const input = selectInviteOnly()
      fireEvent.change(input, { target: { value: `${FIRST_ID}\n${invalidId}` } })

      const error = screen.getByRole('alert')
      expect(error.textContent).toContain('半角数字 17〜20 桁')
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(input.getAttribute('aria-describedby')).toContain(error.id)
      expect(submitButton().disabled).toBe(true)
      fireEvent.click(submitButton())
      expect(onSubmit).not.toHaveBeenCalled()

      fireEvent.change(input, { target: { value: FIRST_ID } })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(submitButton().disabled).toBe(false)
    },
  )

  it('重複を除いた上限は 500 人で、501 人は作成できない', () => {
    const { onSubmit } = renderComposer()
    const input = selectInviteOnly()
    const ids = Array.from({ length: 501 }, (_, i) => String(10000000000000000n + BigInt(i)))
    fireEvent.change(input, { target: { value: ids.join('\n') } })
    expect(screen.getByRole('alert').textContent).toContain('500 人まで')
    expect(submitButton().disabled).toBe(true)

    fireEvent.change(input, { target: { value: [...ids.slice(0, 500), ids[0]].join('\n') } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0].invitedDiscordUserIds).toEqual(ids.slice(0, 500))
  })

  it('未入力でも招待限定イベントを作成できる', () => {
    const { onSubmit } = renderComposer()
    selectInviteOnly()
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ invitedDiscordUserIds: [] }))
  })

  it('公開に切り替えると非表示の ID を送らず、戻すと下書きを維持する', () => {
    const { onSubmit } = renderComposer()
    const draft = `${FIRST_ID}\ninvalid-id`
    fireEvent.change(selectInviteOnly(), { target: { value: draft } })
    fireEvent.click(screen.getByRole('radio', { name: /^公開 / }))

    expect(screen.queryByRole('textbox', { name: INVITE_LABEL })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(submitButton().disabled).toBe(false)
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0].visibility).toBe('public')
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUserIds')

    expect(selectInviteOnly().value).toBe(draft)
    expect(submitButton().disabled).toBe(true)
  })

  it('編集中は招待管理を公開範囲のすぐ下に置き、作成用 ID を送らない', () => {
    const { onSubmit } = renderComposer({
      mode: 'edit',
      inviteManager: <section aria-label="招待管理">既存の招待管理</section>,
    })
    const manager = screen.getByRole('region', { name: '招待管理' })
    expect(screen.getByText('公開範囲').parentElement!.nextElementSibling).toBe(manager)
    fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))
    expect(screen.getByRole('region', { name: '招待管理' })).toBe(manager)
    expect(screen.queryByRole('textbox', { name: INVITE_LABEL })).toBeNull()
    fireEvent.click(submitButton())
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUserIds')
  })
})
