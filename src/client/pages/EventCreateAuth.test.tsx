import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { ApiError, createEvent } from '../api/client'
import type { SessionUser } from '../auth/useSession'
import { EventCreatePage } from './EventCreatePage'
import { LandingScreen } from './LandingScreen'

vi.mock('../api/client', async (importActual) => ({
  ...await importActual<typeof import('../api/client')>(),
  createEvent: vi.fn(),
  fetchAnnouncements: vi.fn(async () => ({ announcements: [] })),
}))

const user: SessionUser = {
  userId: 'fixture-user', discordUserId: '12345678901234567', username: 'fixture',
  globalName: null, avatar: null, displayName: '架空の主催者',
}
const path = '/events/new?channelToken=fictional-channel-token'
const fetchMock = vi.fn<typeof fetch>()
const clients: QueryClient[] = []

function renderPage(options: { cachedUser?: SessionUser | null; landing?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(queryClient)
  if ('cachedUser' in options) queryClient.setQueryData(['session'], { user: options.cachedUser })
  const router = createMemoryRouter([
    { path: '/', element: <LandingScreen /> },
    { path: '/events/new', element: <EventCreatePage /> },
    { path: '/events/:id', element: <div>作成完了</div> },
  ], { initialEntries: [options.landing ? '/' : path] })
  const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, ...view }
}

async function fillDraft(container: HTMLElement) {
  fireEvent.change(await screen.findByPlaceholderText('例）年末の打ち上げ'), { target: { value: '架空の作成下書き' } })
  fireEvent.change(screen.getByPlaceholderText('場所や持ち物など'), { target: { value: '架空の持ち物' } })
  fireEvent.mouseDown(container.querySelector('button[data-ds]:not([disabled])')!)
  fireEvent.mouseUp(window)
  fireEvent.click(screen.getByRole('radio', { name: /^招待限定/ }))
  fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名（任意）' }), { target: { value: 'fictional_friend' } })
}

function expectDraft(disabled: boolean) {
  for (const value of ['架空の作成下書き', '架空の持ち物', 'fictional_friend']) {
    expect(screen.getByDisplayValue(value).matches(':disabled')).toBe(disabled)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ user }))
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(createEvent).mockResolvedValue({
    event: { id: 'created', title: '架空の作成下書き', defaultDurationMinutes: 60, status: 'open', timezone: 'Asia/Tokyo', createdAt: '2026-10-20T00:00:00Z' }, candidates: [],
  })
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})

describe('作成画面のログインガード', () => {
  it.each([false, true])('PC・モバイル（幅600px以下: %s）の直 URL で入力前にログインを示し、連携クエリも戻り先に保つ', async (narrow) => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: narrow, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })))
    fetchMock.mockImplementation(async () => Response.json({ user: null }))
    renderPage()
    await screen.findByText('日程調整の作成には Discord ログインが必要です。')
    expect(screen.queryByPlaceholderText('例）年末の打ち上げ')).toBeNull()
    expect(screen.queryByRole('button', { name: 'この内容でつくる' })).toBeNull()
    for (const link of screen.getAllByRole('link', { name: /Discord でログイン/ })) {
      expect(link.getAttribute('href')).toBe(`/api/auth/discord?returnTo=${encodeURIComponent(path)}`)
      expect(link.getAttribute('target')).toBeNull()
    }
    if (narrow) expect(screen.getByRole('link', { name: 'ログイン' })).toBeTruthy()
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('ランディングの作成導線からも未ログインではフォームに入れない', async () => {
    fetchMock.mockImplementation(async () => Response.json({ user: null }))
    renderPage({ landing: true })
    expect(screen.getByText(/作成には Discord ログインが必要です。公開イベントへの回答は/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '日程調整をつくる' }))
    await screen.findByText('日程調整の作成には Discord ログインが必要です。')
    expect(screen.queryByRole('button', { name: 'この内容でつくる' })).toBeNull()
  })

  it.each([false, true])('初回・古い認証キャッシュの確認中はログアウトと断定せず、入力を開かない（キャッシュ: %s）', async (cached) => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((r) => { resolve = r }))
    renderPage(cached ? { cachedUser: user } : {})
    expect(screen.getByRole('status').textContent).toBe('ログイン状態を確認中です…')
    expect(screen.queryByRole('link', { name: /ログインして作成する/ })).toBeNull()
    expect(screen.queryByPlaceholderText('例）年末の打ち上げ')).toBeNull()
    await act(async () => { resolve(Response.json({ user: null })) })
    await screen.findByRole('link', { name: 'Discord でログインして作成する' })
  })

  it.each(['500', '429', 'network'])('通信失敗 %s は未ログインと区別し、再確認成功後に入力できる', async (failure) => {
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    else fetchMock.mockResolvedValue(new Response(null, { status: Number(failure) }))
    renderPage()
    await screen.findByText('ログイン状態を確認できません。通信状況を確認して再試行してください。')
    expect(screen.queryByRole('link', { name: /Discord でログイン/ })).toBeNull()
    expect(screen.queryByPlaceholderText('例）年末の打ち上げ')).toBeNull()
    fetchMock.mockImplementation(async () => Response.json({ user }))
    fireEvent.click(screen.getByRole('button', { name: 'ログイン状態を再確認' }))
    await screen.findByPlaceholderText('例）年末の打ち上げ')
  })

  it('入力中の失効は全入力を無効化して残し、同じアカウントの再確認後に同じ内容で作成できる', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const { queryClient, container } = renderPage()
    await fillDraft(container)
    fetchMock.mockImplementation(async () => Response.json({ user: null }))
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['session'], exact: true }) })
    await screen.findByText(/ログインの有効期限が切れたか/)
    expectDraft(true)
    for (const link of screen.getAllByRole('link', { name: /Discord で.*ログイン/ })) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('href')).toBe('/api/auth/discord?returnTo=%2Fme')
    }
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    expect(createEvent).not.toHaveBeenCalled()
    fetchMock.mockImplementation(async () => Response.json({ user }))
    fireEvent.click(screen.getByRole('button', { name: 'ログイン状態を再確認' }))
    await waitFor(() => expectDraft(false))
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('作成完了')
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: '架空の作成下書き', description: '架空の持ち物', visibility: 'invite_only',
      invitedDiscordUsernames: ['fictional_friend'], discordChannelToken: 'fictional-channel-token',
      candidates: expect.arrayContaining([expect.objectContaining({ startAt: expect.any(String) })]),
    }))
    expect(storage).not.toHaveBeenCalled()
  })

  it('入力中の通信失敗で下書きを残して止め、ログインを要求しない', async () => {
    const { queryClient, container } = renderPage()
    await fillDraft(container)
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['session'], exact: true }) })
    await screen.findByText('ログイン状態を確認できません。通信状況を確認して再試行してください。')
    expectDraft(true)
    expect(queryClient.getQueryData(['session'])).toEqual({ user })
    expect(screen.queryByRole('link', { name: /Discord で.*ログイン/ })).toBeNull()
  })

  it.each(['expired', 'network', 'other-account'])('送信直前に %s を検知したら POST せず入力を残す', async (state) => {
    const { container } = renderPage()
    await fillDraft(container)
    if (state === 'network') fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    else fetchMock.mockImplementation(async () => Response.json({ user: state === 'expired' ? null : { ...user, discordUserId: '98765432109876543' } }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await waitFor(() => expect(screen.getByRole('group', { name: '日程調整の入力' }).getAttribute('disabled')).not.toBeNull())
    await screen.findByText(state === 'expired'
      ? /ログインの有効期限が切れたか/
      : state === 'network'
        ? 'ログイン状態を確認できません。通信状況を確認して再試行してください。'
        : '入力を始めた Discord アカウントと異なります。元のアカウントでログインし直してください。')
    expect(createEvent).not.toHaveBeenCalled()
    expectDraft(true)
  })

  it('認証確認の後の POST が 401 でも再送せず、入力を残して再ログインを案内する', async () => {
    vi.mocked(createEvent).mockRejectedValue(new ApiError('Authentication required', 401))
    const { container, queryClient } = renderPage()
    await fillDraft(container)
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText(/ログインの有効期限が切れたか/)
    expectDraft(true)
    expect(queryClient.getQueryData(['session'])).toEqual({ user: null })
    expect(createEvent).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    expect(createEvent).toHaveBeenCalledOnce()
  })

  it('作成 API の 403 は未ログイン扱いにしない', async () => {
    vi.mocked(createEvent).mockRejectedValue(new ApiError('Forbidden', 403))
    const { container, queryClient } = renderPage()
    await fillDraft(container)
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('Forbidden')
    expectDraft(false)
    expect(queryClient.getQueryData(['session'])).toEqual({ user })
    expect(screen.queryByRole('link', { name: /Discord で.*ログイン/ })).toBeNull()
  })
})
