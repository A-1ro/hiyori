import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DiscordInviteInputs, useDiscordInviteRows } from './DiscordInviteInputs'

const FIRST_NAME = 'first_friend'
const SECOND_NAME = 'another_friend'

function Harness() {
  const state = useDiscordInviteRows()
  return <DiscordInviteInputs id="invites" label="招待ユーザー名" state={state} describedBy="hint" />
}

function inputs() {
  return screen.getAllByRole('textbox') as HTMLInputElement[]
}

describe('DiscordInviteInputs', () => {
  it('入力中のフォーカスと同じ DOM を保ち、次の空欄を一つずつ増やす', () => {
    render(<Harness />)
    const first = inputs()[0]!
    first.focus()
    fireEvent.change(first, { target: { value: '1' } })
    expect(inputs()).toHaveLength(2)
    expect(document.activeElement).toBe(first)
    fireEvent.change(first, { target: { value: FIRST_NAME } })
    expect(inputs()).toHaveLength(2)
    expect(inputs()[0]).toBe(first)
    expect(document.activeElement).toBe(first)

    const second = inputs()[1]!
    second.focus()
    fireEvent.change(second, { target: { value: SECOND_NAME } })
    expect(inputs().map((input) => input.value)).toEqual([FIRST_NAME, SECOND_NAME, ''])
    expect(document.activeElement).toBe(second)
    expect(first.type).toBe('text')
    expect(first.inputMode).toBe('text')
  })

  it('途中の欄を削除しても残りのユーザー名 と DOM を保ち、次の欄にフォーカスする', () => {
    render(<Harness />)
    fireEvent.change(inputs()[0]!, { target: { value: FIRST_NAME } })
    fireEvent.change(inputs()[1]!, { target: { value: SECOND_NAME } })
    const second = inputs()[1]!
    fireEvent.click(screen.getByRole('button', { name: '1 人目の入力欄を削除' }))
    expect(inputs().map((input) => input.value)).toEqual([SECOND_NAME, ''])
    expect(inputs()[0]).toBe(second)
    expect(document.activeElement).toBe(second)
    fireEvent.click(screen.getByRole('button', { name: '1 人目の入力欄を削除' }))
    expect(inputs().map((input) => input.value)).toEqual([''])
    expect(document.activeElement).toBe(inputs()[0])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('末尾のユーザー名 を消すと、フォーカスを保ったままその欄だけを空欄として残す', () => {
    render(<Harness />)
    const first = inputs()[0]!
    first.focus()
    fireEvent.change(first, { target: { value: FIRST_NAME } })
    fireEvent.change(first, { target: { value: '' } })
    expect(inputs()).toEqual([first])
    expect(document.activeElement).toBe(first)
    fireEvent.change(first, { target: { value: '   ' } })
    expect(inputs()).toHaveLength(1)
  })

  it('途中の欄を空にしても後続のユーザー名 を保ち、blur でレイアウトを動かさない', () => {
    render(<Harness />)
    const first = inputs()[0]!
    fireEvent.change(first, { target: { value: FIRST_NAME } })
    fireEvent.change(inputs()[1]!, { target: { value: SECOND_NAME } })
    fireEvent.change(first, { target: { value: '' } })
    fireEvent.blur(first)
    expect(inputs().map((input) => input.value)).toEqual(['', SECOND_NAME, ''])
    fireEvent.click(screen.getByRole('button', { name: '2 人目の入力欄を削除' }))
    expect(inputs().map((input) => input.value)).toEqual([''])
    expect(document.activeElement).toBe(inputs()[0])
  })

  it('前の欄が空でも最後のユーザー名 を消した欄だけを残し、フォーカスを保つ', () => {
    render(<Harness />)
    fireEvent.change(inputs()[0]!, { target: { value: FIRST_NAME } })
    const second = inputs()[1]!
    fireEvent.change(second, { target: { value: SECOND_NAME } })
    fireEvent.change(inputs()[0]!, { target: { value: '' } })
    second.focus()
    fireEvent.change(second, { target: { value: '' } })
    expect(inputs()).toEqual([second])
    expect(document.activeElement).toBe(second)
  })

  it('改行・カンマ区切りの貼り付けも 1 人ずつの欄に分ける', () => {
    render(<Harness />)
    fireEvent.paste(inputs()[0]!, { clipboardData: { getData: () => ` ${FIRST_NAME},\r\n ${SECOND_NAME}\n,` } })
    expect(inputs().map((input) => input.value)).toEqual([FIRST_NAME, SECOND_NAME, ''])
    expect(inputs().every((input) => input.tagName === 'INPUT')).toBe(true)
  })

  it('途中への貼り付けは選択部分を置き換え、他の行を消さない', () => {
    render(<Harness />)
    const first = inputs()[0]!
    fireEvent.change(first, { target: { value: 'replace' } })
    fireEvent.change(inputs()[1]!, { target: { value: FIRST_NAME } })
    first.setSelectionRange(0, first.value.length)
    fireEvent.paste(first, { clipboardData: { getData: () => `${SECOND_NAME},${FIRST_NAME}` } })
    expect(inputs().map((input) => input.value)).toEqual([SECOND_NAME, FIRST_NAME, FIRST_NAME, ''])
  })
})
