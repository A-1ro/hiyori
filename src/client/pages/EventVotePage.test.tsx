import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryRouter,
  RouterProvider,
  Link,
  Outlet,
} from 'react-router'
import { EventVotePage } from './EventVotePage'
import {
  fetchEvent,
  fetchMyVotes,
  fetchMyBusy,
  putVotes,
  type ParticipantResponse,
  type VoteResponse,
} from '../api/client'
import { serializeVoteDraft } from '../lib/vote-diff'

// --- モック --------------------------------------------------------------
// api/client: ネットワーク関数だけ vi.fn に差し替え、ApiError などの実体は温存。
vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>()
  return {
    ...actual,
    fetchEvent: vi.fn(),
    fetchMyVotes: vi.fn(),
    fetchMyBusy: vi.fn(),
    registerParticipant: vi.fn(),
    putVotes: vi.fn(),
  }
})

// useSession: マウント時の /api/auth/me fetch を避けるため useSession だけ差し替え。
vi.mock('../auth/useSession', async (importActual) => {
  const actual = await importActual<typeof import('../auth/useSession')>()
  return { ...actual, useSession: () => ({ data: { user: null } }) }
})

const EVENT_ID = 'ev1'
const CAND_ID = 'cand1'

const participant: ParticipantResponse = {
  id: 'p1',
  eventId: EVENT_ID,
  kind: 'guest',
  displayName: 'みか',
  createdAt: '2026-07-21T00:00:00.000Z',
}

const serverVote: VoteResponse = {
  id: 'v1',
  candidateId: CAND_ID,
  participantId: 'p1',
  choice: 'yes',
  updatedAt: '2026-07-21T00:00:00.000Z',
}

function primeMocks() {
  vi.mocked(fetchEvent).mockResolvedValue({
    event: {
      id: EVENT_ID,
      title: 'テストイベント',
      defaultDurationMinutes: 60,
      status: 'collecting',
      timezone: 'Asia/Tokyo',
      createdAt: '2026-07-21T00:00:00.000Z',
    },
    candidates: [
      {
        id: CAND_ID,
        eventId: EVENT_ID,
        startAt: '2026-08-01T10:00:00.000Z',
        endAt: '2026-08-01T11:00:00.000Z',
      },
    ],
  })
  // サーバー票は yes。参加登録済み（dirty 判定が有効になる条件）。
  vi.mocked(fetchMyVotes).mockResolvedValue({
    participant,
    votes: [serverVote],
  })
  vi.mocked(fetchMyBusy).mockResolvedValue({ startAts: [] })
  // 少し遅延させる（本物のネットワーク相当）。即時 resolve だと onMutate と同一
  // マイクロタスクで onSuccess が走り、React が再レンダーを commit する前の古い
  // クロージャ（votes 未ハイドレート）で navigate してしまい、送信時の dirty=true
  // 状態を正しく再現できない。実運用の送信フローに合わせて 1 tick 待たせる。
  vi.mocked(putVotes).mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20))
    return { votes: [{ ...serverVote, choice: 'no' }] }
  })
}

// ローカル下書きを仕込み、ハイドレート直後から dirty=true（votes=no vs baseline=yes）にする。
// baseline == 現在サーバー(yes) なので reconcile は下書き(no)を採用する。
function seedDirtyDraft() {
  localStorage.setItem(
    `hiyori:vote-draft:${EVENT_ID}`,
    serializeVoteDraft({ [CAND_ID]: 'no' }, { [CAND_ID]: 'yes' }),
  )
}

// 本番の pathless layout route（共通フッター）と同じ構造を再現するため、
// vote / tally / home をすべて Outlet 配下の子ルートに置く。
function LayoutWithLeave() {
  return (
    <>
      <Link to="/home">ホームへ戻る</Link>
      <Outlet />
    </>
  )
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const router = createMemoryRouter(
    [
      {
        element: <LayoutWithLeave />,
        children: [
          { path: '/events/:id/vote', element: <EventVotePage /> },
          { path: '/events/:id/tally', element: <div>TALLY PAGE</div> },
          { path: '/home', element: <div>HOME PAGE</div> },
        ],
      },
    ],
    { initialEntries: [`/events/${EVENT_ID}/vote`] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('EventVotePage の離脱ガード', () => {
  beforeEach(() => {
    localStorage.clear()
    primeMocks()
  })

  // (a) 回帰の本丸: 送信の自己遷移で離脱確認ダイアログを出さない。
  it('回答を送信すると、確認ダイアログを出さずに集計ページへ遷移する', async () => {
    seedDirtyDraft()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderApp()

    // dirty=true のとき送信ボタンは「未送信の変更を送信」になる。
    const submit = await screen.findByRole('button', {
      name: '未送信の変更を送信',
    })
    fireEvent.click(submit)

    // 送信後は集計ページへ遷移する。
    await screen.findByText('TALLY PAGE')

    expect(vi.mocked(putVotes)).toHaveBeenCalledTimes(1)
    // 自分の送信遷移は blocker を素通りするので confirm は一切呼ばれない。
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  // (b) ガード自体は生きている: 送信せず離脱しようとしたら確認が出る。
  it('送信せずにページを離れようとすると確認ダイアログが出る', async () => {
    seedDirtyDraft()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderApp()

    await screen.findByRole('button', { name: '未送信の変更を送信' })

    const leave = screen.getByRole('link', { name: 'ホームへ戻る' })
    fireEvent.click(leave)

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('未送信の変更があります'),
    )
    // confirm=true にしたので実際に離脱できる。
    await screen.findByText('HOME PAGE')
  })
})
