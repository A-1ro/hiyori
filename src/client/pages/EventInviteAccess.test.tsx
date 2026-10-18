import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const loginHint =
  '招待を受け取っている場合は、招待された Discord アカウントでログインしてください。'
const retryHint = 'ログインしたまま再試行できます。時間をおいてもう一度お試しください。'

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

  it('未ログインなら通常の Discord ログインへ進める', async () => {
    const path = `/events/private-event${suffix}`
    const { router } = renderPage(path)

    await screen.findByText(loginHint)
    const login = within(screen.getByRole('main')).getByRole('link', { name: 'Discord でログイン' })
    expect(login.getAttribute('href')).toBe(
      `/api/auth/discord?returnTo=${encodeURIComponent(path)}`,
    )
    expect(screen.getByText('イベントが見つかりません。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '再試行する' })).toBeNull()
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(screen.queryByText(privateEvent.description!)).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe(path)
  })

  it('ログイン済みならログアウトや OAuth なしで同じページを再試行できる', async () => {
    setSession(currentUser)
    const path = `/events/private-event${suffix}`
    const { router } = renderPage(path)
    const retry = await screen.findByRole('button', { name: '再試行する' })
    expect(screen.getByText(retryHint)).toBeTruthy()
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Discord/ })).toBeNull()
    expect(screen.getByRole('link', { name: currentUser.displayName })).toBeTruthy()

    vi.mocked(fetchEvent).mockResolvedValue({ event: privateEvent, candidates: [] })
    vi.mocked(fetchTally).mockResolvedValue({
      event: privateEvent, candidates: [], participants: [], decisions: [],
    })
    fireEvent.click(retry)

    await screen.findByText(privateEvent.title)
    expect(screen.queryByText(retryHint)).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe(path)
    expect(router.state.historyAction).toBe('POP')
    const primaryFetch = suffix === '/tally' ? fetchTally : fetchEvent
    expect(primaryFetch).toHaveBeenCalledTimes(2)
    if (suffix === '') expect(fetchTally).toHaveBeenCalledTimes(2)
    else expect(fetchMyVotes).toHaveBeenCalledTimes(2)
    if (suffix === '/vote') expect(fetchMyBusy).toHaveBeenCalledTimes(2)
    if (suffix === '/tally') expect(fetchPermissions).toHaveBeenCalledTimes(2)
  })

  it('再試行が失敗しても同じ案内を保ち、改めて試せる', async () => {
    setSession(currentUser)
    const { router } = renderPage(`/events/private-event${suffix}`)
    const primaryFetch = suffix === '/tally' ? fetchTally : fetchEvent
    fireEvent.click(await screen.findByRole('button', { name: '再試行する' }))
    await waitFor(() => expect(primaryFetch).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: '再試行する' }))
    await waitFor(() => expect(primaryFetch).toHaveBeenCalledTimes(3))
    await screen.findByRole('button', { name: '再試行する' })
    expect(screen.getByText(retryHint)).toBeTruthy()
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe(`/events/private-event${suffix}`)
  })

  it('再試行中の連打でリクエストを増やさず、以前の非公開内容も戻さない', async () => {
    setSession(currentUser)
    renderPage(`/events/private-event${suffix}`, true)
    await screen.findByRole('button', { name: '再試行する' })
    const primaryFetch = suffix === '/tally' ? fetchTally : fetchEvent
    let rejectRetry!: (error: Error) => void
    const pending = new Promise<never>((_resolve, reject) => { rejectRetry = reject })
    vi.mocked(primaryFetch).mockReturnValueOnce(pending)
    const retry = screen.getByRole('button', { name: '再試行する' })
    fireEvent.click(retry)
    fireEvent.click(retry)

    await waitFor(() => expect(primaryFetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(screen.queryByText(privateEvent.description!)).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    await act(async () => { rejectRetry(new ApiError('Not Found', 404)) })
    await screen.findByRole('button', { name: '再試行する' })
    expect(primaryFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    { state: '未ログイン', user: null },
    { state: 'ログイン済み', user: currentUser },
  ])('$state の権限不足・不存在・一時的な照合失敗は同じ案内で API の詳細を表示しない', async ({ user }) => {
    setSession(user)
    const { router } = renderPage(`/events/missing-event${suffix}`)
    await screen.findByText(user ? retryHint : loginHint)
    const missingText = screen.getByRole('main').textContent

    for (const [eventId, detail] of [
      ['private-event', 'Access denied: 非公開イベントのタイトル'],
      ['unavailable-event', 'Discord lookup temporarily unavailable'],
    ] as const) {
      rejectEvent(new ApiError(detail, 404))
      await act(async () => {
        await router.navigate(`/events/${eventId}${suffix}`)
      })
      await screen.findByText(user ? retryHint : loginHint)
      expect(screen.getByRole('main').textContent).toBe(missingText)
      expect(screen.queryByText(/Access denied|temporarily unavailable/)).toBeNull()
      expect(screen.queryByText(privateEvent.title)).toBeNull()
    }
    if (user) {
      expect(within(screen.getByRole('main')).queryByRole('link', { name: /Discord/ })).toBeNull()
    } else {
      expect(within(screen.getByRole('main')).getByRole('link', { name: 'Discord でログイン' }).getAttribute('href')).toBe(
        `/api/auth/discord?returnTo=${encodeURIComponent(`/events/unavailable-event${suffix}`)}`,
      )
    }
  })

  it('別のイベントへ移動した後は現在のイベントだけを再取得する', async () => {
    setSession(currentUser)
    const { router } = renderPage(`/events/old-event${suffix}`)
    await screen.findByRole('button', { name: '再試行する' })
    await act(async () => {
      await router.navigate(`/events/new-event${suffix}`)
    })
    await screen.findByRole('button', { name: '再試行する' })
    vi.mocked(fetchEvent).mockClear()
    vi.mocked(fetchTally).mockClear()
    fireEvent.click(screen.getByRole('button', { name: '再試行する' }))
    const primaryFetch = suffix === '/tally' ? fetchTally : fetchEvent
    await waitFor(() => expect(primaryFetch).toHaveBeenCalledOnce())
    expect(primaryFetch).toHaveBeenCalledWith('new-event')
  })

  it('セッションの確認中は新たなログインを要求しない', async () => {
    vi.mocked(useSession).mockReturnValue({ data: undefined, isPending: true } as ReturnType<typeof useSession>)
    renderPage(`/events/private-event${suffix}`)
    await screen.findByText('ログイン状態を確認しています。')
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Discord/ })).toBeNull()
  })

  it('セッション取得に失敗してもログアウトや OAuth を要求しない', async () => {
    vi.mocked(useSession).mockReturnValue({ data: undefined, isPending: false, error: new Error('Network error') } as ReturnType<typeof useSession>)
    renderPage(`/events/private-event${suffix}`)
    await screen.findByText('ログイン状態を確認できません。時間をおいてページを再読み込みしてください。')
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Discord/ })).toBeNull()
    expect(logout).not.toHaveBeenCalled()
  })

  it.each([
    { kind: '500', error: new ApiError('Internal Server Error', 500) },
    { kind: '通信障害', error: new Error('Failed to fetch') },
  ])('$kind では招待の有無を示唆しない', async ({ error }) => {
    rejectEvent(error)
    renderPage(`/events/private-event${suffix}`)

    await screen.findByText('エラーが発生しました。')
    const main = within(screen.getByRole('main'))
    expect(main.queryByText(loginHint)).toBeNull()
    expect(main.queryByRole('link', { name: 'Discord でログイン' })).toBeNull()
    expect(main.queryByText('イベントが見つかりません。')).toBeNull()
  })

  it('再取得が 404 になったらキャッシュ済みの非公開内容も表示しない', async () => {
    setSession(currentUser)
    renderPage(`/events/private-event${suffix}`, true)

    await screen.findByRole('button', { name: '再試行する' })
    expect(screen.queryByText(privateEvent.title)).toBeNull()
    expect(screen.queryByText(privateEvent.description!)).toBeNull()
  })
})
