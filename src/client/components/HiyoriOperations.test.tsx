import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HiyoriOperations, emptyAgent, type AgentState } from './HiyoriOperations'
const OWNER = '12345678901234567'
const event = { id: 'event-one', title: '合成ゲーム会', timezone: 'Asia/Tokyo' }
const candidates = [{ id: 'slot-real', startAt: '2099-11-08T10:00:00Z', endAt: '2099-11-08T11:00:00Z' }]
const detail = { name: 'hiyori_get_event', data: { event, candidates, isOrganizer: true } }
const own = { name: 'hiyori_get_my_votes', data: { votes: [{ candidateId: 'slot-real', choice: 'maybe', comment: '後で確認' }] } }
const guard = vi.fn(async () => OWNER as string | null)
let requests: Array<{ path: string; body: Record<string, unknown> }>
let confirmReply: () => Promise<Response>
function Wrapper({ initial = emptyAgent() }: { initial?: AgentState }) {
  const [state, setState] = useState(initial)
  return <HiyoriOperations owner={OWNER} state={state} onChange={setState} checkedOwner={guard} disabled={false} />
}
beforeEach(() => {
  requests = []; guard.mockReset().mockResolvedValue(OWNER)
  confirmReply = async () => Response.json({ name: 'hiyori_vote', data: { ok: true } })
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)); requests.push({ path: url, body })
    if (url.endsWith('/read')) {
      if (body.name === 'hiyori_list_events') return Response.json({ name: body.name, data: { organized: [event], participating: [] } })
      if (body.name === 'hiyori_get_event') return Response.json(detail)
      if (body.name === 'hiyori_get_my_votes') return Response.json(own)
      if (body.name === 'hiyori_tally') return Response.json({ name: body.name, data: { candidates: [{ ...candidates[0], counts: { yes: 2, maybe: 1, no: 0 } }] } })
    }
    if (url.endsWith('/prepare')) return Response.json({ name: body.name, label: '回答を送信', token: 'signed-local-fixture', arguments: body.arguments, eventTitle: event.title, expiresAt: Date.now() + 300000 })
    if (url.endsWith('/confirm')) return confirmReply()
    throw new Error('Unexpected fixture request')
  }))
})
afterEach(() => vi.unstubAllGlobals())
describe('会話内の回答・変更と本人の確認', () => {
  it('イベント選択・既存回答・訂正・確認・送信を順に行い、自動送信しない', async () => {
    render(<Wrapper />)
    fireEvent.click(screen.getByRole('button', { name: 'イベントを選ぶ' }))
    fireEvent.click(await screen.findByRole('button', { name: event.title }))
    const selected = await screen.findByRole('region', { name: '選択中のイベント' })
    const group = within(selected).getByRole('group', { name: '2099/11/8(日) 19:00の回答' })
    await waitFor(() => expect(within(group).getByRole('button', { name: '△' }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(within(group).getByRole('button', { name: '○' }))
    fireEvent.change(within(selected).getByLabelText('コメント'), { target: { value: '参加します' } })
    fireEvent.click(screen.getByRole('button', { name: '回答内容を確認する' }))
    const review = await screen.findByRole('region', { name: '送信前の確認' })
    expect(within(review).getByText(/参加します/)).toBeTruthy()
    expect((within(review).getByRole('button', { name: '回答を送信' }) as HTMLButtonElement).disabled).toBe(true)
    expect(requests.some((r) => r.path.endsWith('/confirm'))).toBe(false)
    fireEvent.click(within(review).getByRole('checkbox', { name: 'この内容で実行することを確認しました' }))
    fireEvent.click(within(review).getByRole('button', { name: '回答を送信' }))
    await screen.findByText('送信が完了しました。')
    expect(requests.filter((r) => r.path.endsWith('/confirm'))).toHaveLength(1)
    expect(requests.find((r) => r.path.endsWith('/prepare'))?.body.arguments).toEqual({ eventId: event.id, votes: [{ candidateId: candidates[0]!.id, choice: 'yes', comment: '参加します' }] })
  })
  it('モデル送信を確認せずに回答UIを利用でき、集計は候補ごとの数だけ表示する', async () => {
    render(<Wrapper initial={{ ...emptyAgent(), selectedEventId: event.id, results: [detail, own] }} />)
    expect((screen.getByRole('checkbox', { name: /AI送信を確認/ }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '集計を表示' }))
    const tally = await screen.findByRole('region', { name: '集計' })
    expect(within(tally).getByText(/○ 2/)).toBeTruthy()
    expect(requests.every((r) => r.path.endsWith('/read'))).toBe(true)
  })
  it('アカウント不一致ではAPIを実行せず、送信結果不明を再試行しない', async () => {
    guard.mockResolvedValue(null)
    const view = render(<Wrapper />)
    fireEvent.click(screen.getByRole('button', { name: 'イベントを選ぶ' }))
    await screen.findByRole('alert'); expect(requests).toHaveLength(0)
    view.unmount(); guard.mockResolvedValue(OWNER)
    confirmReply = async () => { throw new Error('通信結果が不明です。現在の状態を確認してください。') }
    render(<Wrapper initial={{ ...emptyAgent(), action: { name: 'hiyori_vote', label: '回答を送信', token: 'fixture', arguments: { votes: [] }, expiresAt: Date.now() + 300000 } }} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容で実行することを確認しました' }))
    fireEvent.click(screen.getByRole('button', { name: '回答を送信' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: '回答を送信' })).toBeNull()
    expect(requests.filter((r) => r.path.endsWith('/confirm'))).toHaveLength(1)
  })
  it('アンマウント後の応答を破棄する', async () => {
    let resolve!: (r: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const view = render(<Wrapper />)
    fireEvent.click(screen.getByRole('button', { name: 'イベントを選ぶ' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => resolve(Response.json({ name: 'hiyori_list_events', data: { organized: [event], participating: [] } })))
    expect(screen.queryByText(event.title)).toBeNull()
  })
})
