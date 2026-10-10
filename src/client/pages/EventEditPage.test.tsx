import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  addEventInvite,
  fetchEvent,
  fetchEventInvites,
  removeEventInvite,
  updateEvent,
} from '../api/client'
import { EventEditPage } from './EventEditPage'

vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>()
  return {
    ...actual,
    fetchEvent: vi.fn(),
    fetchEventInvites: vi.fn(),
    addEventInvite: vi.fn(),
    removeEventInvite: vi.fn(),
    updateEvent: vi.fn(),
  }
})
vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }))

const INVITED_ID = '12345678901234567890'
const NEW_NAME = 'new_friend'
const OTHER_NAME = 'another_friend'
const invite = {
  id: 'invite1',
  eventId: 'event1',
  discordUserId: INVITED_ID,
  discordUsername: null,
  claimedAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
}

async function findInviteInput() {
  return await screen.findByRole('textbox', { name: '招待する Discord ユーザー名' })
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  queryClient.setQueryDefaults(['session'], { gcTime: Infinity })
  queryClient.setQueryData(['session'], { user: {
    userId: 'owner', discordUserId: '32345678901234567', username: 'organizer',
    displayName: '主催者', globalName: null, avatar: null,
  } })
  const router = createMemoryRouter([
    { path: '/events/:id/edit', element: <EventEditPage /> },
  ], { initialEntries: ['/events/event1/edit'] })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchEvent).mockResolvedValue({
    event: {
      id: 'event1',
      title: '編集テスト',
      defaultDurationMinutes: 90,
      visibility: 'invite_only',
      status: 'open',
      timezone: 'Asia/Tokyo',
      createdAt: '2026-10-08T00:00:00.000Z',
    },
    candidates: [],
  })
  vi.mocked(fetchEventInvites).mockResolvedValue({ invites: [invite] })
  vi.mocked(addEventInvite).mockResolvedValue({ invite: { ...invite, id: 'invite2', discordUserId: null, discordUsername: NEW_NAME } })
  vi.mocked(removeEventInvite).mockResolvedValue(undefined)
})

describe('EventEditPage の招待管理', () => {
  it('複数の旧形式の招待を読み取り専用 ID で区別し、選んだレコードだけを取消する', async () => {
    const otherId = '22345678901234567890'
    vi.mocked(fetchEventInvites).mockResolvedValue({ invites: [invite, { ...invite, id: 'invite2', discordUserId: otherId }] })
    renderPage()
    await screen.findByText(`Discord ID: ${INVITED_ID}`)
    expect(screen.getByText(`Discord ID: ${otherId}`)).toBeTruthy()
    expect(screen.getAllByText('以前の招待')).toHaveLength(2)
    const first = screen.getByRole('button', { name: `Discord ID ${INVITED_ID} の招待を取消` })
    const second = screen.getByRole('button', { name: `Discord ID ${otherId} の招待を取消` })
    expect(first).not.toBe(second)
    expect(screen.queryByRole('textbox', { name: /ユーザー ID/ })).toBeNull()
    expect(screen.queryByDisplayValue(INVITED_ID)).toBeNull()
    expect(screen.queryByDisplayValue(otherId)).toBeNull()
    expect(screen.queryByRole('radio', { name: /ユーザー ID/ })).toBeNull()
    fireEvent.click(second)
    await waitFor(() => expect(removeEventInvite).toHaveBeenCalledWith('event1', 'invite2'))
    expect(removeEventInvite).toHaveBeenCalledOnce()
  })

  it('ユーザー名を独立して送信し、受取り待ちの招待をレコード ID で取り消せる', async () => {
    vi.mocked(fetchEventInvites).mockResolvedValue({ invites: [{ ...invite, id: 'pending1', discordUserId: null, discordUsername: 'new_friend' }] })
    renderPage()
    const first = await screen.findByRole('textbox', { name: '招待する Discord ユーザー名' })
    await screen.findByText('@new_friend')
    expect(screen.getByText('受取り待ち · アクセス時に現在のユーザー名を確認')).toBeTruthy()
    fireEvent.change(first, { target: { value: ' @Another_Friend ' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(addEventInvite).toHaveBeenCalledWith('event1', { discordUsername: 'another_friend' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }) as HTMLInputElement).value).toBe(''))
    fireEvent.click(screen.getByRole('button', { name: /の招待を取消$/ }))
    await waitFor(() => expect(removeEventInvite).toHaveBeenCalledWith('event1', 'pending1'))
  })

  it('受取り済みのユーザー名を表示し、内部の数値 ID は見せない', async () => {
    vi.mocked(fetchEventInvites).mockResolvedValue({ invites: [{ ...invite, discordUsername: 'friend', claimedAt: '2026-10-10T00:00:00.000Z' }] })
    renderPage()
    await screen.findByText('@friend')
    expect(screen.getByText('受取り済み')).toBeTruthy()
    expect(screen.queryByText(INVITED_ID)).toBeNull()
    expect(screen.queryByText('受取り待ち · アクセス時に現在のユーザー名を確認')).toBeNull()
  })

  it('数字だけのユーザー名も名前として追加し、ID 入力への切替を表示しない', async () => {
    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: '招待する Discord ユーザー名' }), { target: { value: '12345678901234567' } })
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名 2 人目' }), { target: { value: NEW_NAME } })
    expect(screen.queryByRole('radio', { name: /^ユーザー ID/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(addEventInvite).toHaveBeenCalledTimes(2))
    expect(addEventInvite).toHaveBeenNthCalledWith(1, 'event1', { discordUsername: '12345678901234567' })
    expect(addEventInvite).toHaveBeenNthCalledWith(2, 'event1', { discordUsername: NEW_NAME })
  })

  it('1 人ずつ増える入力欄から複数人を追加し、空欄と重複は送らない', async () => {
    renderPage()
    const first = await findInviteInput()
    fireEvent.change(first, { target: { value: ` ${NEW_NAME} ` } })
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名 2 人目' }), { target: { value: OTHER_NAME } })
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名 3 人目' }), { target: { value: NEW_NAME } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(addEventInvite).toHaveBeenCalledTimes(2))
    expect(addEventInvite).toHaveBeenNthCalledWith(1, 'event1', { discordUsername: NEW_NAME })
    expect(addEventInvite).toHaveBeenNthCalledWith(2, 'event1', { discordUsername: OTHER_NAME })
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: /招待する Discord/ })).toHaveLength(1))
    expect((screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }) as HTMLInputElement).value).toBe('')
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('不正なユーザー名 の行がある場合は一件も追加せず、修正後に追加できる', async () => {
    renderPage()
    const first = await findInviteInput()
    fireEvent.change(first, { target: { value: NEW_NAME } })
    const second = screen.getByRole('textbox', { name: '招待する Discord ユーザー名 2 人目' })
    fireEvent.change(second, { target: { value: 'invalid name' } })
    expect(screen.getByRole('alert').textContent).toContain('2〜32 文字')
    expect(second.getAttribute('aria-invalid')).toBe('true')
    expect(first.getAttribute('aria-invalid')).toBe('false')
    expect((screen.getByRole('button', { name: '追加' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(addEventInvite).not.toHaveBeenCalled()
    fireEvent.change(second, { target: { value: OTHER_NAME } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: '追加' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('一部の追加が失敗すると成功分だけ除き、失敗分と未送信分を保持して再試行する', async () => {
    vi.mocked(addEventInvite).mockResolvedValueOnce({ invite }).mockRejectedValueOnce(new Error('一時的なエラー'))
    renderPage()
    const first = await findInviteInput()
    fireEvent.change(first, { target: { value: NEW_NAME } })
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名 2 人目' }), { target: { value: OTHER_NAME } })
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名 3 人目' }), { target: { value: INVITED_ID } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await screen.findByText('招待の追加に失敗しました。未登録の入力は残っています。')
    expect(addEventInvite).toHaveBeenCalledTimes(2)
    expect((screen.getAllByRole('textbox', { name: /招待する Discord/ }) as HTMLInputElement[]).map((input) => input.value)).toEqual([OTHER_NAME, INVITED_ID, ''])

    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(addEventInvite).toHaveBeenCalledTimes(4))
    expect(addEventInvite).toHaveBeenNthCalledWith(3, 'event1', { discordUsername: OTHER_NAME })
    expect(addEventInvite).toHaveBeenNthCalledWith(4, 'event1', { discordUsername: INVITED_ID })
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: /招待する Discord/ })).toHaveLength(1))
  })

  it('追加待ちの入力・削除・再送信を無効にし、二重追加を防ぐ', async () => {
    let resolveAdd!: (value: Awaited<ReturnType<typeof addEventInvite>>) => void
    vi.mocked(addEventInvite).mockReturnValueOnce(new Promise((resolve) => { resolveAdd = resolve }))
    renderPage()
    const first = await findInviteInput()
    fireEvent.change(first, { target: { value: NEW_NAME } })
    const button = screen.getByRole('button', { name: '追加' }) as HTMLButtonElement
    fireEvent.click(button)
    await waitFor(() => expect(button.disabled).toBe(true))
    expect((screen.getAllByRole('textbox', { name: /招待する Discord/ }) as HTMLInputElement[]).every((input) => input.disabled)).toBe(true)
    expect((screen.getByRole('button', { name: '1 人目の入力欄を削除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(addEventInvite).toHaveBeenCalledOnce()
    resolveAdd({ invite })
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: /招待する Discord/ })).toHaveLength(1))
  })

  it('公開範囲のすぐ下に表示し、追加・取消は保存ボタンとは独立して反映する', async () => {
    renderPage()
    const input = await findInviteInput() as HTMLInputElement
    await screen.findByText('以前の招待')
    const manager = input.closest('section')!
    expect(screen.getByText('公開範囲').parentElement!.nextElementSibling).toBe(manager)
    expect(screen.getByText(/招待の追加・取消はすぐに反映されます/)).toBeTruthy()

    fireEvent.change(input, { target: { value: ` ${NEW_NAME} ` } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(addEventInvite).toHaveBeenCalledWith('event1', { discordUsername: NEW_NAME }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }) as HTMLInputElement).value).toBe(''))
    expect(updateEvent).not.toHaveBeenCalled()

    fireEvent.click(within(manager).getByRole('button', { name: /の招待を取消$/ }))
    await waitFor(() => expect(removeEventInvite).toHaveBeenCalledWith('event1', 'invite1'))
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('追加エラーと入力内容は公開範囲の切り替え後も維持する', async () => {
    vi.mocked(addEventInvite).mockRejectedValueOnce(new Error('追加に失敗'))
    renderPage()
    const input = await findInviteInput() as HTMLInputElement
    fireEvent.change(input, { target: { value: NEW_NAME } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await screen.findByText('招待の追加に失敗しました。未登録の入力は残っています。')
    fireEvent.click(screen.getByRole('radio', { name: /^公開 / }))
    fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))

    expect(screen.getByRole('textbox', { name: '招待する Discord ユーザー名' })).toBe(input)
    expect(input.value).toBe(NEW_NAME)
    expect(screen.getByText('招待の追加に失敗しました。未登録の入力は残っています。')).toBeTruthy()
    expect(addEventInvite).toHaveBeenCalledOnce()
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('取消に失敗した場合はエラーを示し、既存の招待を残す', async () => {
    vi.mocked(removeEventInvite).mockRejectedValueOnce(new Error('取消に失敗'))
    renderPage()
    await screen.findByText('以前の招待')
    fireEvent.click(screen.getByRole('button', { name: /の招待を取消$/ }))
    await screen.findByText('招待の取消に失敗しました。')
    expect(screen.getByText('以前の招待')).toBeTruthy()
  })

  it('一覧の読み込みに失敗した場合はエラーを表示する', async () => {
    vi.mocked(fetchEventInvites).mockRejectedValueOnce(new Error('一覧の読み込みに失敗'))
    renderPage()
    await screen.findByText('招待一覧を読み込めません。')
    expect(screen.getByRole('textbox', { name: '招待する Discord ユーザー名' })).toBeTruthy()
  })

  it('狭い画面でも入力欄を縮められ、長いユーザー名 が取消ボタンを押し出さない', async () => {
    renderPage()
    const input = await findInviteInput()
    const id = await screen.findByText('以前の招待')
    expect(input.parentElement!.parentElement!.style.display).toBe('grid')
    expect(input.style.minWidth).toBe('0px')
    expect(id.style.minWidth).toBe('0px')
    expect(id.style.overflowWrap).toBe('anywhere')
    expect(screen.getByRole('button', { name: /の招待を取消$/ }).style.flexShrink).toBe('0')
  })
})
