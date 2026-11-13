import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AssistantPanel } from './AssistantPanel'
import { ApiError, clearAssistantHistory, fetchAssistantHistory, resolveAssistantAction, sendAssistantMessage } from '../api/client'
import type { AssistantState } from '../../shared/assistant'

vi.mock('../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../api/client')>(),
  fetchAssistantHistory: vi.fn(), sendAssistantMessage: vi.fn(), resolveAssistantAction: vi.fn(), clearAssistantHistory: vi.fn(),
}))

const USER = '9a219ddc-e9e3-4aae-9c5f-4cda9bba928a'
const EVENT = '194288ae-ddac-4e4b-917a-a410c57dc487'
const empty: AssistantState = { messages: [], pending: null, busy: false }
const action: NonNullable<AssistantState['pending']> = { id: '6c4ce329-4d3b-4ec8-b011-36788f1c45c8', tool: 'hiyori_create_event', label: 'イベントを作成', arguments: { title: 'ボドゲ会', defaultDurationMinutes: 180, candidates: [{ startAt: '2030-11-01T05:00:00Z' }] }, expiresAt: Date.now() + 600_000 }
let qc: QueryClient
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter><QueryClientProvider client={qc}><AssistantPanel userId={USER} events={[{ id: EVENT, title: 'ボドゲ会', status: 'open', timezone: 'Asia/Tokyo', defaultDurationMinutes: 180, createdAt: '2030-01-01T00:00:00Z' }]} /></QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchAssistantHistory).mockResolvedValue(empty)
  vi.mocked(sendAssistantMessage).mockResolvedValue({ ...empty, messages: [{ id: 'reply', role: 'assistant', content: '確認しました。' }] })
  vi.mocked(resolveAssistantAction).mockResolvedValue(empty)
  vi.mocked(clearAssistantHistory).mockResolvedValue(empty)
})
afterEach(() => { cleanup(); qc?.clear() })

describe('ﾋﾖﾘﾁｬﾝ side panel', () => {
  it('has a minimal empty state and sends with account, selected event, and a stable retry ID', async () => {
    mount()
    await screen.findByRole('button', { name: '予定を確認' })
    fireEvent.click(screen.getByRole('button', { name: '予定を確認' }))
    const textarea = screen.getByRole('textbox', { name: 'メッセージ' })
    expect((textarea as HTMLTextAreaElement).value).toBe('自分の予定を教えて')
    fireEvent.change(screen.getByLabelText('相談するイベント'), { target: { value: EVENT } })
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true, keyCode: 229 })
    expect(sendAssistantMessage).not.toHaveBeenCalled()
    vi.mocked(sendAssistantMessage).mockRejectedValueOnce(new ApiError('通信失敗', 503))
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await screen.findByRole('alert')
    expect((textarea as HTMLTextAreaElement).value).toBe('自分の予定を教えて')
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await screen.findByText('確認しました。')
    expect(sendAssistantMessage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendAssistantMessage).mock.calls[0]).toEqual(vi.mocked(sendAssistantMessage).mock.calls[1])
    expect(vi.mocked(sendAssistantMessage).mock.calls[0]).toEqual([USER, expect.objectContaining({ eventId: EVENT, message: '自分の予定を教えて', requestId: expect.any(String) })])
  })

  it('requires an explicit confirmation click and displays dates in Japanese time', async () => {
    vi.mocked(fetchAssistantHistory).mockResolvedValue({ ...empty, pending: action })
    mount()
    await screen.findByRole('heading', { name: 'イベントを作成' })
    expect(screen.getByText('公開', { exact: true })).toBeTruthy()
    expect(screen.getByText(/14:00/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'メッセージ' }) as HTMLTextAreaElement).disabled).toBe(true)
    expect(resolveAssistantAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この内容で実行' }))
    await waitFor(() => expect(resolveAssistantAction).toHaveBeenCalledWith(USER, action.id, 'approve'))
  })

  it('can cancel without execution and never saves one-time action results in the query cache', async () => {
    vi.mocked(fetchAssistantHistory).mockResolvedValue({ ...empty, pending: action })
    vi.mocked(resolveAssistantAction).mockResolvedValue({ ...empty, result: { webcalUrl: 'webcal://test.example/secret' } })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(resolveAssistantAction).toHaveBeenCalledWith(USER, action.id, 'cancel'))
    await screen.findByText('実行結果')
    expect(JSON.stringify(qc.getQueryData(['assistant', USER]))).not.toContain('secret')
  })

  it('shows quota failures without automatically retrying or losing the draft', async () => {
    vi.mocked(sendAssistantMessage).mockRejectedValue(new ApiError('AIの利用上限に達しました', 429))
    mount()
    const textarea = await screen.findByRole('textbox', { name: 'メッセージ' })
    await waitFor(() => expect((textarea as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(textarea, { target: { value: '予定を確認して' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect((await screen.findByRole('alert')).textContent).toContain('利用上限')
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1)
    expect((textarea as HTMLTextAreaElement).value).toBe('予定を確認して')
  })

  it('keeps a multi-day creation request intact when inference is truncated', async () => {
    const message = 'テストというイベントを作成したい。期間は今日から一週間で、12:00から3時間と19:00から4時間'
    vi.mocked(sendAssistantMessage).mockRejectedValue(new ApiError('AIの応答が途中で終了しました。入力内容はそのままで再試行してください', 503))
    mount()
    const textarea = await screen.findByRole('textbox', { name: 'メッセージ' })
    await waitFor(() => expect((textarea as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(textarea, { target: { value: message } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect((await screen.findByRole('alert')).textContent).toContain('途中で終了')
    expect((textarea as HTMLTextAreaElement).value).toBe(message)
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/質問を短く/)).toBeNull()
  })
})
