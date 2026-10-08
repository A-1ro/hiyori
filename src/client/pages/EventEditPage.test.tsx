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
const NEW_ID = '234567890123456789'
const invite = {
  id: 'invite1',
  eventId: 'event1',
  discordUserId: INVITED_ID,
  createdAt: '2026-10-08T00:00:00.000Z',
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
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
  vi.mocked(addEventInvite).mockResolvedValue({ invite: { ...invite, id: 'invite2', discordUserId: NEW_ID } })
  vi.mocked(removeEventInvite).mockResolvedValue(undefined)
})

describe('EventEditPage の招待管理', () => {
  it('公開範囲のすぐ下に表示し、追加・取消は保存ボタンとは独立して反映する', async () => {
    renderPage()
    const input = await screen.findByRole('textbox', { name: '招待する Discord ユーザー ID' }) as HTMLInputElement
    await screen.findByText(INVITED_ID)
    const manager = input.closest('section')!
    expect(screen.getByText('公開範囲').parentElement!.nextElementSibling).toBe(manager)
    expect(screen.getByText(/招待の追加・取消はすぐに反映されます/)).toBeTruthy()

    fireEvent.change(input, { target: { value: ` ${NEW_ID} ` } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(addEventInvite).toHaveBeenCalledWith('event1', NEW_ID))
    await waitFor(() => expect(input.value).toBe(''))
    expect(updateEvent).not.toHaveBeenCalled()

    fireEvent.click(within(manager).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(removeEventInvite).toHaveBeenCalledWith('event1', INVITED_ID))
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('追加エラーと入力内容は公開範囲の切り替え後も維持する', async () => {
    vi.mocked(addEventInvite).mockRejectedValueOnce(new Error('追加に失敗'))
    renderPage()
    const input = await screen.findByRole('textbox', { name: '招待する Discord ユーザー ID' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: NEW_ID } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await screen.findByText('招待の追加に失敗しました。')
    fireEvent.click(screen.getByRole('radio', { name: /^公開 / }))
    fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))

    expect(screen.getByRole('textbox', { name: '招待する Discord ユーザー ID' })).toBe(input)
    expect(input.value).toBe(NEW_ID)
    expect(screen.getByText('招待の追加に失敗しました。')).toBeTruthy()
    expect(addEventInvite).toHaveBeenCalledOnce()
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('取消に失敗した場合はエラーを示し、既存の招待を残す', async () => {
    vi.mocked(removeEventInvite).mockRejectedValueOnce(new Error('取消に失敗'))
    renderPage()
    await screen.findByText(INVITED_ID)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await screen.findByText('招待の取消に失敗しました。')
    expect(screen.getByText(INVITED_ID)).toBeTruthy()
  })

  it('一覧の読み込みに失敗した場合はエラーを表示する', async () => {
    vi.mocked(fetchEventInvites).mockRejectedValueOnce(new Error('一覧の読み込みに失敗'))
    renderPage()
    await screen.findByText('招待一覧を読み込めません。')
    expect(screen.getByRole('textbox', { name: '招待する Discord ユーザー ID' })).toBeTruthy()
  })

  it('狭い画面では入力行を折り返し、20 桁の ID が取消ボタンを押し出さない', async () => {
    renderPage()
    const input = await screen.findByRole('textbox', { name: '招待する Discord ユーザー ID' })
    const id = await screen.findByText(INVITED_ID)
    expect(input.parentElement!.style.flexWrap).toBe('wrap')
    expect(input.style.minWidth).toBe('0px')
    expect(id.style.minWidth).toBe('0px')
    expect(id.style.overflowWrap).toBe('anywhere')
    expect(screen.getByRole('button', { name: '取消' }).style.flexShrink).toBe('0')
  })
})
