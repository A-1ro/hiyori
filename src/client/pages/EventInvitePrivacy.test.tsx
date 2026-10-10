import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { EventEditPage } from './EventEditPage'
import type { SessionUser } from '../auth/useSession'

// HTTP だけを置換する。ページ・認証フック・API クライアントは本物を使う。
const organizer: SessionUser = {
  userId: 'owner', discordUserId: '12345678901234567', username: 'organizer',
  displayName: 'Original organizer', globalName: null, avatar: null,
}
const other: SessionUser = {
  ...organizer, userId: 'other', discordUserId: '22345678901234567',
  username: 'other', displayName: 'Other account',
}
const event = {
  id: 'ev', title: 'Public event', defaultDurationMinutes: 60, visibility: 'public',
  status: 'open', timezone: 'Asia/Tokyo', createdAt: '2026-10-10T00:00:00.000Z',
}
const invitation = {
  id: 'i1', eventId: 'ev', discordUserId: null, discordUsername: 'private_friend',
  claimedAt: null, createdAt: event.createdAt,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function setup() {
  const state: {
    user: SessionUser | null
    inviteStatus: number
    sessionCalls: number
    inviteCalls: number
    mutationCalls: number
    inviteResponse?: () => Promise<Response>
    mutationResponse?: () => Promise<Response>
  } = { user: organizer, inviteStatus: 200, sessionCalls: 0, inviteCalls: 0, mutationCalls: 0 }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://hiyori.test').pathname
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (path === '/api/auth/me') {
      state.sessionCalls++
      return Response.json({ user: state.user })
    }
    if (path === '/api/announcements') return Response.json({ announcements: [] })
    if (path === '/api/events/ev') return Response.json({ event, candidates: [] })
    if (path.startsWith('/api/events/ev/invites')) {
      if (method !== 'GET') {
        state.mutationCalls++
        return state.mutationResponse?.() ?? Response.json({ invite: invitation })
      }
      state.inviteCalls++
      if (state.inviteResponse) return state.inviteResponse()
      if (state.inviteStatus === 200) return Response.json({ invites: [invitation] })
      return Response.json({ error: 'Unavailable' }, { status: state.inviteStatus })
    }
    throw new Error(`Unexpected request ${method} ${path}`)
  }))
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const router = createMemoryRouter([
    { path: '/events/:id/edit', element: <EventEditPage /> },
  ], { initialEntries: ['/events/ev/edit'] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { state, queryClient }
}

function expectPrivateInvitesHidden(queryClient: QueryClient) {
  expect(screen.getByDisplayValue('Public event')).toBeTruthy()
  expect(screen.queryByText('@private_friend')).toBeNull()
  expect(screen.queryByRole('button', { name: /の招待を取消$/ })).toBeNull()
  expect((screen.getByRole('button', { name: '追加' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }) as HTMLInputElement).disabled).toBe(true)
  expect(JSON.stringify(queryClient.getQueriesData({ queryKey: ['eventInvites'] }))).not.toContain('private_friend')
}

beforeEach(() => { focusManager.setFocused(true) })
afterEach(() => {
  vi.unstubAllGlobals()
  focusManager.setFocused(undefined)
})

describe('公開イベントの非公開招待キャッシュ', () => {
  it.each([401, 403, 404])('招待一覧の再取得が %s なら、イベント本体が 200 でも一覧を消して編集を止める', async (status) => {
    const { state, queryClient } = setup()
    await screen.findByText('@private_friend')
    state.inviteStatus = status
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['eventInvites'] }) })
    await screen.findByText('招待一覧を読み込めません。')
    expectPrivateInvitesHidden(queryClient)
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(state.mutationCalls).toBe(0)
    // 権限拒否を繰り返し取得したり、セッション再確認が無限に続いたりしない。
    expect(state.inviteCalls).toBe(2)
    expect(state.sessionCalls).toBe(2)
  })

  it.each([
    { label: '別タブでログアウト', user: null, status: 401 },
    { label: '別アカウントへ切替', user: other, status: 404 },
  ])('$label 後のウィンドウ復帰で、ヘッダと招待一覧を現在の本人に合わせる', async ({ user, status }) => {
    const { state, queryClient } = setup()
    await screen.findByText('@private_friend')
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }), { target: { value: 'owners_draft' } })
    act(() => { focusManager.setFocused(false) })
    state.user = user
    state.inviteStatus = status
    act(() => { focusManager.setFocused(true) })

    await screen.findByRole('link', { name: user ? user.displayName : 'Discord でログイン' })
    await screen.findByText('招待一覧を読み込めません。')
    expectPrivateInvitesHidden(queryClient)
    expect(screen.queryByDisplayValue('owners_draft')).toBeNull()
    expect(queryClient.getQueryData(['eventInvites', 'ev', organizer.discordUserId])).toBeUndefined()
  })

  it('期限切れのセッションは招待 API の 401 から確認し直す', async () => {
    const { state, queryClient } = setup()
    await screen.findByText('@private_friend')
    state.user = null
    state.inviteStatus = 401
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['eventInvites'] }) })
    await screen.findByRole('link', { name: 'Discord でログイン' })
    expectPrivateInvitesHidden(queryClient)
    expect(queryClient.getQueryData(['session'])).toEqual({ user: null })
  })

  it.each([null, other])('更新されたセッションの後で旧アカウントの応答が届いても表示・キャッシュを復活させない', async (user) => {
    const { state, queryClient } = setup()
    await screen.findByText('@private_friend')
    const oldResponse = deferred<Response>()
    state.inviteResponse = () => oldResponse.promise
    act(() => { void queryClient.refetchQueries({ queryKey: ['eventInvites'] }) })
    await waitFor(() => { expect(state.inviteCalls).toBe(2) })

    state.user = user
    state.inviteResponse = undefined
    state.inviteStatus = user ? 404 : 401
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['session'], exact: true }) })
    await screen.findByRole('link', { name: user ? user.displayName : 'Discord でログイン' })
    await screen.findByText('招待一覧を読み込めません。')
    expectPrivateInvitesHidden(queryClient)

    await act(async () => { oldResponse.resolve(Response.json({ invites: [invitation] })) })
    expectPrivateInvitesHidden(queryClient)
    expect(queryClient.getQueryData(['eventInvites', 'ev', organizer.discordUserId])).toBeUndefined()
  })

  it('本人が変わらなければ復帰時の確認後に招待一覧と編集を維持する', async () => {
    const { state, queryClient } = setup()
    await screen.findByText('@private_friend')
    act(() => { focusManager.setFocused(false) })
    act(() => { focusManager.setFocused(true) })
    await waitFor(() => { expect(state.sessionCalls).toBe(2) })
    await waitFor(() => { expect(queryClient.isFetching()).toBe(0) })
    expect(screen.getByText('@private_friend')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }) as HTMLInputElement).disabled).toBe(false)
    expect(state.inviteCalls).toBe(2)
  })

  it('追加処理中に本人が変わったら、旧アカウントの残りの招待を送信しない', async () => {
    const { state, queryClient } = setup()
    await screen.findByText('@private_friend')
    const firstAdd = deferred<Response>()
    state.mutationResponse = () => firstAdd.promise
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名' }), { target: { value: 'first_friend' } })
    fireEvent.change(screen.getByRole('textbox', { name: '招待する Discord ユーザー名 2 人目' }), { target: { value: 'second_friend' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => { expect(state.mutationCalls).toBe(1) })

    state.user = null
    state.inviteStatus = 401
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['session'], exact: true }) })
    await screen.findByRole('link', { name: 'Discord でログイン' })
    await act(async () => { firstAdd.resolve(Response.json({ invite: invitation })) })
    await waitFor(() => { expect(queryClient.isMutating()).toBe(0) })
    expect(state.mutationCalls).toBe(1)
    expectPrivateInvitesHidden(queryClient)
    expect(screen.queryByDisplayValue('second_friend')).toBeNull()
  })
})
