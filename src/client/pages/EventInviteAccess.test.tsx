import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  ApiError,
  fetchEvent,
  fetchTally,
  fetchMyVotes,
  fetchMyBusy,
  fetchPermissions,
  type EventResponse,
} from '../api/client'
import { useSession, type SessionUser } from '../auth/useSession'
import { EventDetailPage } from './EventDetailPage'
import { EventVotePage } from './EventVotePage'
import { EventTallyPage } from './EventTallyPage'

vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>()
  return {
    ...actual,
    fetchEvent: vi.fn(),
    fetchTally: vi.fn(),
    fetchMyVotes: vi.fn(),
    fetchMyBusy: vi.fn(),
    fetchPermissions: vi.fn(),
    fetchAnnouncements: vi.fn(async () => ({ announcements: [] })),
  }
})

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }))
vi.mock('../auth/useSession', async (importActual) => {
  const actual = await importActual<typeof import('../auth/useSession')>()
  return {
    ...actual,
    useSession: vi.fn(),
    useLogout: () => ({ mutate: logout, isPending: false }),
  }
})

const currentUser: SessionUser = {
  userId: 'u1',
  discordUserId: '12345678901234567',
  username: 'invited.person',
  globalName: null,
  avatar: null,
  displayName: '現在のユーザー',
}
const privateEvent: EventResponse = {
  id: 'private-event',
  title: '非公開イベントのタイトル',
  description: '非公開イベントの説明',
  visibility: 'invite_only',
  defaultDurationMinutes: 60,
  status: 'collecting',
  timezone: 'Asia/Tokyo',
  createdAt: '2026-10-01T00:00:00.000Z',
}
const hint =
  '招待を受け取っている場合は、招待された Discord アカウントでログインし直してください。'

function setSession(user: SessionUser | null) {
  vi.mocked(useSession).mockReturnValue({ data: { user } } as ReturnType<typeof useSession>)
}

function renderPage(path: string, cached = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  if (cached) {
    queryClient.setQueryData(['event', privateEvent.id], {
      event: privateEvent,
      candidates: [],
    })
    queryClient.setQueryData(['tally', privateEvent.id], {
      event: privateEvent,
      candidates: [],
      participants: [],
      decisions: [],
    })
  }
  const router = createMemoryRouter(
    [
      { path: '/events/:id', element: <EventDetailPage /> },
      { path: '/events/:id/vote', element: <EventVotePage /> },
      { path: '/events/:id/tally', element: <EventTallyPage /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

function rejectEvent(error: Error) {
  vi.mocked(fetchEvent).mockRejectedValue(error)
  vi.mocked(fetchTally).mockRejectedValue(error)
}

describe.each([
  { page: '詳細', suffix: '' },
  { page: '回答', suffix: '/vote' },
  { page: '集計', suffix: '/tally' },
])('$page ページのアクセス不可時の招待案内', ({ suffix }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setSession(null)
    rejectEvent(new ApiError('Not Found', 404))
    vi.mocked(fetchMyVotes).mockResolvedValue({ participant: null, votes: [] })
    vi.mocked(fetchMyBusy).mockResolvedValue({ startAts: [] })
    vi.mocked(fetchPermissions).mockResolvedValue({ isOrganizer: false })
  })

  it.each([
    { state: '未ログイン', user: null },
    { state: 'ログイン済み', user: currentUser },
  ])('$state でも 404 から新たな OAuth ログインへ進める', async ({ user }) => {
    setSession(user)
    const path = `/events/private-event${suffix}`
    const { router } = renderPage(path)

    const login = await screen.findByRole('link', { name: 'Discord で招待を確認' })
    expect(login.getAttribute('href')).toBe(
      `/api/auth/discord?returnTo=${encodeURIComponent(path)}`,
    )
    expect(screen.getByText(hint)).toBeTruthy()
    expect(screen.getByText('イベントが見つかりません。')).toBeTruthy()
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(screen.queryByText(privateEvent.description!)).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe(path)
    if (user) {
      expect(screen.getByRole('link', { name: user.displayName })).toBeTruthy()
    }
  })

  it('権限不足と不存在は同じ案内になり、API の詳細を表示しない', async () => {
    const { router } = renderPage(`/events/missing-event${suffix}`)
    await screen.findByRole('link', { name: 'Discord で招待を確認' })
    const missingText = screen.getByRole('main').textContent

    rejectEvent(new ApiError('Access denied: 非公開イベントのタイトル', 404))
    await act(async () => {
      await router.navigate(`/events/private-event${suffix}`)
    })
    await screen.findByRole('link', { name: 'Discord で招待を確認' })

    expect(screen.getByRole('main').textContent).toBe(missingText)
    expect(screen.queryByText(/Access denied/)).toBeNull()
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(screen.getByRole('link', { name: 'Discord で招待を確認' }).getAttribute('href')).toBe(
      `/api/auth/discord?returnTo=${encodeURIComponent(`/events/private-event${suffix}`)}`,
    )
  })

  it.each([
    { kind: '500', error: new ApiError('Internal Server Error', 500) },
    { kind: '通信障害', error: new Error('Failed to fetch') },
  ])('$kind では招待の有無を示唆しない', async ({ error }) => {
    rejectEvent(error)
    renderPage(`/events/private-event${suffix}`)

    await screen.findByText('エラーが発生しました。')
    const main = within(screen.getByRole('main'))
    expect(main.queryByText(hint)).toBeNull()
    expect(main.queryByRole('link', { name: 'Discord で招待を確認' })).toBeNull()
    expect(main.queryByText('イベントが見つかりません。')).toBeNull()
  })

  it('再取得が 404 になったらキャッシュ済みの非公開内容も表示しない', async () => {
    setSession(currentUser)
    renderPage(`/events/private-event${suffix}`, true)

    await screen.findByRole('link', { name: 'Discord で招待を確認' })
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(screen.queryByText(privateEvent.description!)).toBeNull()
  })
})
