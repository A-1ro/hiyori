import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createEvent, addEventInvite } from '../api/client'
import { EventCreatePage } from './EventCreatePage'

vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>()
  return { ...actual, createEvent: vi.fn(), addEventInvite: vi.fn() }
})
vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }))

const FIRST_NAME = 'first_friend'
const SECOND_NAME = 'another_friend'
const result: Awaited<ReturnType<typeof createEvent>> = {
  event: {
    id: 'created-event',
    title: '招待テスト',
    defaultDurationMinutes: 90,
    visibility: 'invite_only',
    status: 'open',
    timezone: 'Asia/Tokyo',
    createdAt: '2026-10-08T00:00:00.000Z',
  },
  candidates: [],
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const router = createMemoryRouter([
    { path: '/events/new', element: <EventCreatePage /> },
    { path: '/events/:id', element: <div>作成したイベント</div> },
  ], { initialEntries: ['/events/new?channelToken=test-channel-token'] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByPlaceholderText('例）年末の打ち上げ'), { target: { value: '招待テスト' } })
  fireEvent.mouseDown(view.container.querySelector('button[data-ds]:not([disabled])')!)
  fireEvent.mouseUp(window)
  fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))
  const input = screen.getByRole('textbox', { name: '招待する Discord ユーザー名（任意）' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: ` ${FIRST_NAME} ` } })
  fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名（任意） 2 人目' }), { target: { value: SECOND_NAME } })
  fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名（任意） 3 人目' }), { target: { value: FIRST_NAME } })
  return { input }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createEvent).mockResolvedValue(result)
})

describe('EventCreatePage の招待付き作成', () => {
  it('作成 API 一回に招待ユーザー名 と候補を含め、成功後にイベントへ移動する', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('作成したイベント')

    expect(createEvent).toHaveBeenCalledOnce()
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: '招待テスト',
      visibility: 'invite_only',
      invitedDiscordUsernames: [FIRST_NAME, SECOND_NAME],
      discordChannelToken: 'test-channel-token',
      candidates: expect.arrayContaining([expect.objectContaining({ startAt: expect.any(String) })]),
    }))
    expect(addEventInvite).not.toHaveBeenCalled()
  })

  it('公開へ戻した場合は作成 API に招待ユーザー名 を含めない', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: /^公開 / }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('作成したイベント')

    expect(vi.mocked(createEvent).mock.calls[0]![0].visibility).toBe('public')
    expect(vi.mocked(createEvent).mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUserIds')
    expect(vi.mocked(createEvent).mock.calls[0]![0]).not.toHaveProperty('invitedDiscordUsernames')
  })

  it('失敗時は招待の下書きを維持し、同じ内容で再試行できる', async () => {
    vi.mocked(createEvent).mockRejectedValueOnce(new Error('イベントを作成できませんでした'))
    const { input } = renderPage()
    const draft = input.value
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('イベントを作成できませんでした')
    expect(input.value).toBe(draft)
    expect((screen.getByRole('textbox', { name: '招待する Discord ユーザー名（任意） 2 人目' }) as HTMLInputElement).value).toBe(SECOND_NAME)
    expect(screen.queryByText('作成したイベント')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('作成したイベント')
    expect(createEvent).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createEvent).mock.calls[1]![0]).toEqual(vi.mocked(createEvent).mock.calls[0]![0])
    expect(addEventInvite).not.toHaveBeenCalled()
  })

  it('作成待ちの間は送信ボタンを無効にして二重送信を防ぐ', async () => {
    let resolveCreate!: (value: typeof result) => void
    vi.mocked(createEvent).mockReturnValue(new Promise((resolve) => { resolveCreate = resolve }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    const button = await screen.findByRole('button', { name: '作成中...' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce())
    resolveCreate(result)
    await screen.findByText('作成したイベント')
  })
})
