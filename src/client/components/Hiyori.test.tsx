import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { HiyoriLayout, useHiyori } from './Hiyori'
import { Footer } from './Footer'
import { EventCreatePage } from '../pages/EventCreatePage'
import { createEvent } from '../api/client'

vi.mock('../api/client', async (importActual) => ({ ...await importActual<typeof import('../api/client')>(), createEvent: vi.fn() }))
vi.mock('./AppHeader', () => ({ AppHeader: () => null }))
const OWNER = '12345678901234567'
const draft = { title: 'AI ゲーム会', description: 'みんなで遊ぶ', dates: ['2099-11-08', '2099-11-09'], times: ['19:00'], defaultDurationMinutes: 60, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, visibility: 'invite_only' }
let currentOwner: string | null
let available: boolean
let reply: () => Promise<Response>
let chatRequests: unknown[]
function Home() { const hiyori = useHiyori(); return <><p>ホーム</p><button type="button" onClick={hiyori?.openSettings}>ﾋﾖﾘﾁｬﾝの設定</button></> }
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ element: <HiyoriLayout />, children: [
    { path: '/', element: <Home /> }, { path: '/events/new', element: <EventCreatePage /> },
    { path: '/events/:id', element: <div>作成しました</div> },
  ] }], { initialEntries: ['/'] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return { qc, router }
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'ﾋﾖﾘﾁｬﾝと話す' }))
  await screen.findByRole('dialog')
  if (currentOwner) await waitFor(() => expect(screen.queryByRole('link', { name: 'Discord でログイン' })).toBeNull())
}
async function fill(text = '11月8日と9日の19時、1時間の招待限定ゲーム会の下書き') {
  fireEvent.change(screen.getByLabelText('ﾋﾖﾘﾁｬﾝへのメッセージ'), { target: { value: text } })
}
async function sendForDraft() {
  await open()
  await screen.findByText('AI 会話を利用できます。内容を確認して送信してください。')
  fireEvent.click(screen.getByRole('checkbox'))
  await fill()
  fireEvent.click(screen.getByRole('button', { name: '送信' }))
}
beforeEach(() => {
  currentOwner = OWNER; available = true; chatRequests = []
  reply = async () => Response.json({ reply: '下書きだよ。確認してね。', draft })
  localStorage.clear()
  vi.mocked(createEvent).mockReset()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json({ user: currentOwner ? { discordUserId: currentOwner } : null })
    if (url === '/api/hiyori/status') return Response.json({ available })
    if (url === '/api/mcp/status') return Response.json({ enabled: false })
    if (url === '/api/hiyori/chat') { chatRequests.push(JSON.parse(String(options?.body))); return reply() }
    throw new Error(`Unexpected request ${url}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('ﾋﾖﾘﾁｬﾝの UI と本人の確認', () => {
  it('勝手に開かず、未ログインでも案内とミームと閉じるを利用できる', async () => {
    currentOwner = null
    setup()
    expect(screen.queryByRole('dialog')).toBeNull()
    await open()
    fireEvent.click(screen.getByRole('button', { name: '回答のしかた' }))
    expect(within(screen.getByRole('log')).getByText(/公開イベントは表示名/)).toBeTruthy()
    await fill('お前を消す方法')
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(screen.getByText(/消される前に/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '自動表示しない' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '自動表示しない' }))
    fireEvent.click(screen.getByRole('button', { name: 'チャットを閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(chatRequests).toHaveLength(0)
  })
  it('非表示を永続化し、フッターから再表示できる（会話は保存しない）', async () => {
    setup(); await open()
    fireEvent.click(screen.getByText('表示・会話の設定'))
    fireEvent.click(screen.getByRole('button', { name: 'マスコットを非表示' }))
    expect(screen.queryByRole('button', { name: 'ﾋﾖﾘﾁｬﾝと話す' })).toBeNull()
    expect(JSON.parse(localStorage.getItem('hiyori:mascot:settings')!)).toEqual({ hidden: true, autoDisplay: false })
    fireEvent.click(screen.getByRole('button', { name: 'ﾋﾖﾘﾁｬﾝの設定' }))
    fireEvent.click(screen.getByRole('button', { name: 'マスコットを再表示' }))
    expect(screen.getByRole('button', { name: 'ﾋﾖﾘﾁｬﾝと話す' })).toBeTruthy()
    expect(localStorage.length).toBe(1)
  })
  it('設定保存不可でも案内が使え、未接続や同意なしでは送信しない', async () => {
    available = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled') })
    setup(); await open(); await fill()
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await screen.findByText(/AI はまだ準備中だよ/)
    expect(chatRequests).toHaveLength(0)
    fireEvent.click(screen.getByText('表示・会話の設定'))
    fireEvent.click(screen.getByRole('button', { name: '自動表示しない' }))
    expect(screen.getByText(/呼ばれたときだけ開くね/)).toBeTruthy()
  })
  it('同意後の送信から下書きを確認し、最後の保存ボタンまで作成しない', async () => {
    setup(); await sendForDraft()
    await screen.findByRole('region', { name: 'イベントの下書き' })
    expect(createEvent).not.toHaveBeenCalled()
    expect(chatRequests).toHaveLength(1)
    expect(chatRequests[0]).not.toHaveProperty('eventId')
    fireEvent.click(screen.getByRole('button', { name: 'フォームで確認する' }))
    const title = await screen.findByPlaceholderText('例）年末の打ち上げ') as HTMLInputElement
    expect(title.value).toBe(draft.title)
    expect(createEvent).not.toHaveBeenCalled()
    vi.mocked(createEvent).mockResolvedValue({ event: { id: 'created', title: draft.title, defaultDurationMinutes: 60, status: 'open', timezone: draft.timezone, createdAt: '2026-10-25T00:00:00Z' }, candidates: [] })
    fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }))
    await screen.findByText('作成しました')
    expect(createEvent).toHaveBeenCalledOnce()
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: draft.title, visibility: 'invite_only', expectedOrganizerDiscordId: OWNER, defaultDurationMinutes: 60,
      candidates: expect.arrayContaining([expect.objectContaining({ startAt: expect.any(String) })]),
    }))
    expect(vi.mocked(createEvent).mock.calls[0]![0].candidates).toHaveLength(2)
  })
  it.each([null, '99999999999999999'])('ログアウト/アカウント切替 (%s) で入力・会話・下書きを破棄する', async (nextOwner) => {
    const { qc } = setup(); await sendForDraft()
    await screen.findByRole('region', { name: 'イベントの下書き' })
    await fill('まだ送っていない個人情報')
    await act(async () => { currentOwner = nextOwner; qc.setQueryData(['session'], { user: currentOwner ? { discordUserId: currentOwner } : null }) })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'イベントの下書き' })).toBeNull())
    expect((screen.getByLabelText('ﾋﾖﾘﾁｬﾝへのメッセージ') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText('下書きだよ。確認してね。')).toBeNull()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })
  it('AI フォームへ渡した後のログアウトでも元の下書きを残さない', async () => {
    const { qc } = setup(); await sendForDraft()
    fireEvent.click(await screen.findByRole('button', { name: 'フォームで確認する' }))
    await screen.findByDisplayValue(draft.title)
    await act(async () => { currentOwner = null; qc.setQueryData(['session'], { user: null }) })
    await waitFor(() => expect(screen.queryByDisplayValue(draft.title)).toBeNull())
    expect(createEvent).not.toHaveBeenCalled()
  })
  it('会話消去後に遅れて届く応答を破棄する', async () => {
    let resolve!: (response: Response) => void
    reply = () => new Promise((done) => { resolve = done })
    setup(); await sendForDraft()
    await waitFor(() => expect(chatRequests).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '停止して会話を消去' }))
    await act(async () => { resolve(Response.json({ reply: '遅れて来た秘密', draft })) })
    expect(screen.queryByText('遅れて来た秘密')).toBeNull()
    expect(screen.queryByRole('region', { name: 'イベントの下書き' })).toBeNull()
  })
  it('不正なモデル出力と 429 は手動フォームへ戻し、直接作成しない', async () => {
    reply = async () => Response.json({ reply: '<img src=x onerror=alert(1)>', draft: { ...draft, execute: 'create' } })
    setup(); await sendForDraft()
    await screen.findByRole('alert')
    expect(screen.queryByRole('region', { name: 'イベントの下書き' })).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(createEvent).not.toHaveBeenCalled()
    reply = async () => Response.json({ error: '利用上限です。手動フォームをご利用ください。' }, { status: 429 })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await screen.findByText('利用上限です。手動フォームをご利用ください。')
    expect(screen.getByRole('link', { name: '手動フォームを開く' }).getAttribute('href')).toBe('/events/new')
  })
  it('フッターに非表示からの復帰導線を表示する', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ element: <HiyoriLayout />, children: [{ path: '/', element: <Footer /> }] }])
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'ﾋﾖﾘﾁｬﾝの設定' })).toBeTruthy()
  })
})
