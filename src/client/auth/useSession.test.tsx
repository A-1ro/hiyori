import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { EventDetailPage } from '../pages/EventDetailPage'
import { EventEditPage } from '../pages/EventEditPage'
import {
  ApiError,
  fetchEvent,
  fetchEventInvites,
  fetchTally,
} from '../api/client'
import type { SessionUser } from './useSession'

vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>()
  return {
    ...actual,
    fetchEvent: vi.fn(),
    fetchEventInvites: vi.fn(),
    fetchTally: vi.fn(),
    fetchAnnouncements: vi.fn(async () => ({ announcements: [] })),
  }
})

const user: SessionUser = {
  userId: 'user1',
  discordUserId: '12345678901234567',
  username: 'organizer',
  displayName: '主催者',
  globalName: null,
  avatar: null,
}
const eventData: Awaited<ReturnType<typeof fetchEvent>> = {
  event: {
    id: 'private-event',
    title: '招待限定の秘密のイベント',
    description: '招待者だけに見える説明',
    visibility: 'invite_only',
    status: 'open',
    timezone: 'Asia/Tokyo',
    defaultDurationMinutes: 60,
    createdAt: '2026-10-10T00:00:00.000Z',
  },
  candidates: [],
}
const invitesData: Awaited<ReturnType<typeof fetchEventInvites>> = {
  invites: [{
    id: 'invite1',
    eventId: 'private-event',
    discordUserId: null,
    discordUsername: 'private_friend',
    claimedAt: null,
    createdAt: '2026-10-10T00:00:00.000Z',
  }],
}
const tallyData: Awaited<ReturnType<typeof fetchTally>> = {
  event: eventData.event,
  participants: [],
  candidates: [],
  decisions: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function renderPage(edit: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  queryClient.setQueryData(['session'], { user })
  const router = createMemoryRouter([
    { path: '/events/:id', element: <EventDetailPage /> },
    { path: '/events/:id/edit', element: <EventEditPage /> },
  ], { initialEntries: [`/events/private-event${edit ? '/edit' : ''}`] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return queryClient
}

function expectPrivateContentHidden() {
  expect(screen.queryByText(eventData.event.title)).toBeNull()
  expect(screen.queryByDisplayValue(eventData.event.title)).toBeNull()
  expect(screen.queryByText(eventData.event.description!)).toBeNull()
  expect(screen.queryByDisplayValue(eventData.event.description!)).toBeNull()
  expect(screen.queryByText('@private_friend')).toBeNull()
  expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchEvent).mockResolvedValue(eventData)
  vi.mocked(fetchEventInvites).mockResolvedValue(invitesData)
  vi.mocked(fetchTally).mockResolvedValue(tallyData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each([
  { page: 'イベント詳細', edit: false },
  { page: '招待管理付き編集画面', edit: true },
])('$page のログアウト', ({ edit }) => {
  it('成功時に表示中の私的データを消し、古い読み込みが後から完了しても戻さない', async () => {
    const logout = deferred<Response>()
    const oldSession = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/auth/logout') return logout.promise
      if (url === '/api/auth/me') return oldSession.promise
      throw new Error(`Unexpected fetch: ${url}`)
    }))
    const queryClient = renderPage(edit)
    if (edit) await screen.findByText('@private_friend')
    else await screen.findByText(eventData.event.title)

    const oldEvent = deferred<Awaited<ReturnType<typeof fetchEvent>>>()
    const oldInvites = deferred<Awaited<ReturnType<typeof fetchEventInvites>>>()
    const oldTally = deferred<Awaited<ReturnType<typeof fetchTally>>>()
    const anonymousEvent = deferred<Awaited<ReturnType<typeof fetchEvent>>>()
    const anonymousInvites = deferred<Awaited<ReturnType<typeof fetchEventInvites>>>()
    const anonymousTally = deferred<Awaited<ReturnType<typeof fetchTally>>>()
    vi.mocked(fetchEvent).mockReturnValueOnce(oldEvent.promise).mockReturnValue(anonymousEvent.promise)
    vi.mocked(fetchEventInvites).mockReturnValueOnce(oldInvites.promise).mockReturnValue(anonymousInvites.promise)
    vi.mocked(fetchTally).mockReturnValueOnce(oldTally.promise).mockReturnValue(anonymousTally.promise)
    // ログアウトより前の認証付き読み込みを残し、応答を意図的に遅らせる。
    act(() => { void queryClient.refetchQueries({ type: 'active' }) })
    await waitFor(() => expect(fetchEvent).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    await act(async () => { logout.resolve(new Response(null, { status: 204 })) })

    // 匿名の再取得が完了する前に、ページとキャッシュからデータが消える。
    await screen.findByRole('link', { name: 'Discord でログイン' })
    expectPrivateContentHidden()
    expect(queryClient.getQueryData(['event', 'private-event'])).toBeUndefined()
    expect(queryClient.getQueryData(['eventInvites', 'private-event'])).toBeUndefined()

    await act(async () => {
      oldSession.resolve(Response.json({ user }))
      oldEvent.resolve(eventData)
      oldInvites.resolve(invitesData)
      oldTally.resolve(tallyData)
    })
    expectPrivateContentHidden()
    expect(queryClient.getQueryData(['session'])).toEqual({ user: null })
    expect(queryClient.getQueryData(['event', 'private-event'])).toBeUndefined()
    expect(queryClient.getQueryData(['eventInvites', 'private-event'])).toBeUndefined()

    await act(async () => {
      anonymousEvent.reject(new ApiError('Not Found', 404))
      // 招待管理が先にアンマウントされても、開始済み Promise は安全に完了する。
      if (edit) anonymousInvites.reject(new ApiError('Forbidden', 403))
      else anonymousTally.reject(new ApiError('Not Found', 404))
    })
    await screen.findByText('イベントが見つかりません。')
    expectPrivateContentHidden()
  })

  it('ログアウト失敗を成功扱いせず、現在のセッションを維持する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    const queryClient = renderPage(edit)
    if (edit) await screen.findByText('@private_friend')
    else await screen.findByText(eventData.event.title)
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'ログアウト' }) as HTMLButtonElement).disabled).toBe(false)
      expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', credentials: 'include' })
    })
    expect(queryClient.getQueryData(['session'])).toEqual({ user })
    expect(queryClient.getQueryData(['event', 'private-event'])).toEqual(eventData)
    if (edit) expect(screen.getByText('@private_friend')).toBeTruthy()
    else expect(screen.getByText(eventData.event.title)).toBeTruthy()
  })
})
