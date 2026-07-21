import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link, useBlocker } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEvent,
  fetchMyVotes,
  fetchMyBusy,
  registerParticipant,
  putVotes,
  ApiError,
  type CandidateResponse,
  type VoteResponse,
  type PutVoteInput,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import {
  Avatar,
  Badge,
  Button,
  DiscordMark,
  Field,
  Icon,
  Input,
  VoteControl,
  VOTE_OPTS,
  type VoteChoice,
} from '../components/primitives'
import { BulkVoteBar } from '../components/events/BulkVoteBar'
import { useSession, loginUrl } from '../auth/useSession'
import {
  dirtyCandidateIds,
  parseVoteDraft,
  serializeVoteDraft,
  reconcileVoteDraft,
  type VoteMap,
} from '../lib/vote-diff'

const WD = ['日', '月', '火', '水', '木', '金', '土']

function partsOf(iso: string) {
  const dt = new Date(iso)
  return {
    ymd: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    md: `${dt.getMonth() + 1}/${dt.getDate()}`,
    hm: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
    wd: dt.getDay(),
    ts: dt.getTime(),
  }
}

function formatDeadline(iso: string) {
  const dt = new Date(iso)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

interface Slot {
  id: string
  start: string
  end: string
  ts: number
}
interface DayGroup {
  ymd: string
  md: string
  wd: number
  slots: Slot[]
}

function groupByDay(candidates: CandidateResponse[]): DayGroup[] {
  const map = new Map<string, DayGroup>()
  for (const c of candidates) {
    const s = partsOf(c.startAt)
    const e = partsOf(c.endAt)
    if (!map.has(s.ymd)) {
      map.set(s.ymd, { ymd: s.ymd, md: s.md, wd: s.wd, slots: [] })
    }
    map.get(s.ymd)!.slots.push({ id: c.id, start: s.hm, end: e.hm, ts: s.ts })
  }
  const days = [...map.values()]
  days.sort((a, b) => a.ymd.localeCompare(b.ymd))
  for (const d of days) d.slots.sort((a, b) => a.ts - b.ts)
  return days
}

export function EventVotePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // 入力中の回答はこの端末の localStorage に下書き保存する（サーバー＝集計には送らない）。
  const draftKey = id ? `hiyori:vote-draft:${id}` : null
  // どのイベント id まで votes を初期化済みか。SPA 内で別イベントの vote ページに
  // 切り替わったとき（コンポーネントは再利用され id だけ変わる）に再初期化するため、
  // boolean ではなく id を保持する。
  const hydratedForId = useRef<string | null>(null)
  const [asGuest, setAsGuest] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [registerError, setRegisterError] = useState<string | undefined>()
  const [votes, setVotes] = useState<Record<string, VoteChoice>>({})
  // 下書きの baseline（＝この下書きが基準とするサーバー票のスナップショット）。
  // dirty 判定は votes とこの baseline の差分で行う（別経路で増えたサーバー票を
  // 「未送信のローカル変更」と誤認しないため）。ハイドレート時に確定する。
  const [baseline, setBaseline] = useState<VoteMap>({})
  // 別経路（CLI/MCP/他端末）でサーバー票が変わっていたため、古い下書きを破棄して
  // 最新サーバー票を表示したときに一度だけ出す控えめな通知。
  const [externalNotice, setExternalNotice] = useState(false)
  const { data: sessionData } = useSession()
  const sessionUser = sessionData?.user ?? null

  const { data: eventData, isLoading: eventLoading } = useQuery({
    queryKey: ['event', id],
    queryFn: () => fetchEvent(id!),
    enabled: !!id,
  })

  const { data: myData, isLoading: myLoading } = useQuery({
    queryKey: ['myVotes', id],
    queryFn: () => fetchMyVotes(id!),
    enabled: !!id,
  })

  const { data: busyData } = useQuery({
    queryKey: ['myBusy', id],
    queryFn: () => fetchMyBusy(id!),
    enabled: !!id && !!sessionUser,
  })

  // 初期化（id ごとに1回）。下書きの baseline と現在のサーバー票を突き合わせて分岐する:
  //   - baseline == 現在サーバー（外部変更なし）→ ローカル下書き（未送信編集）を採用
  //   - baseline != 現在サーバー（CLI/MCP/他端末で更新）→ 古い下書きを破棄し最新サーバー採用
  // これで「別経路でサーバーが変わった」ケースを未送信と誤判定しない。
  // id が変わった場合は前イベントの votes を持ち越さないよう必ず再初期化する。
  useEffect(() => {
    if (!id || myLoading) return
    if (hydratedForId.current === id) return

    const currentServer: VoteMap = {}
    for (const v of myData?.votes ?? []) {
      currentServer[v.candidateId] = v.choice as VoteChoice
    }

    let raw: string | null = null
    if (draftKey) {
      try {
        raw = localStorage.getItem(draftKey)
      } catch {
        raw = null
      }
    }
    const draft = parseVoteDraft(raw)
    const result = reconcileVoteDraft(draft, currentServer)

    setVotes(result.votes)
    // baseline は常に「今のサーバー票」を採用。以降のローカル編集はこれを基準に未送信判定する。
    setBaseline(currentServer)
    if (result.externalChanged) {
      setExternalNotice(true)
      // 破棄した古い下書きは掃除しておく（次回開いたときに再判定させない）。
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey)
        } catch {
          // no-op
        }
      }
    }
    hydratedForId.current = id
  }, [id, myData, myLoading, draftKey])

  // 下書きの自動保存（端末ローカルのみ。サーバーには送らない）。
  // baseline との差分（＝純粋なローカル未送信編集）があるときだけ、votes と baseline を
  // 同梱して保存する。差分が無い（サーバーと一致）ときは下書きを消す。
  // 現在の id の初期化が完了するまでは書かない（別イベントの候補 ID を取り違えないため）。
  useEffect(() => {
    if (!draftKey || hydratedForId.current !== id) return
    try {
      const hasLocalEdits = dirtyCandidateIds(votes, baseline).length > 0
      if (hasLocalEdits) {
        localStorage.setItem(draftKey, serializeVoteDraft(votes, baseline))
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch {
      // localStorage 不可（プライベートブラウズ等）の場合は黙って諦める
    }
  }, [votes, baseline, draftKey, id])

  const registerMutation = useMutation({
    mutationFn: (kind: 'guest' | 'discord') => {
      const displayName =
        kind === 'discord' ? (sessionUser?.displayName ?? guestName) : guestName
      return registerParticipant(id!, { kind, displayName })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myVotes', id] })
      setRegisterError(undefined)
    },
    onError: (err) => {
      setRegisterError(err instanceof ApiError ? err.message : '登録に失敗しました')
    },
  })

  const voteMutation = useMutation({
    mutationFn: (payload: PutVoteInput[]) => putVotes(id!, payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['myVotes', id] })
      const previous = queryClient.getQueryData(['myVotes', id])
      queryClient.setQueryData(
        ['myVotes', id],
        (old: { participant: unknown; votes: VoteResponse[] } | undefined) => {
          if (!old) return old
          const now = new Date().toISOString()
          const updated = payload.map((v) => ({
            id: crypto.randomUUID(),
            candidateId: v.candidateId,
            participantId: myData?.participant?.id ?? '',
            choice: v.choice,
            comment: v.comment,
            updatedAt: now,
          }))
          const merged = [...old.votes]
          for (const u of updated) {
            const idx = merged.findIndex((r) => r.candidateId === u.candidateId)
            if (idx >= 0) merged[idx] = u
            else merged.push(u)
          }
          return { ...old, votes: merged }
        },
      )
      return { previous }
    },
    onError: (_err, _payload, context?: { previous: unknown }) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['myVotes', id], context.previous)
      }
    },
    onSuccess: () => {
      // サーバーへ送信できたのでローカル下書きは破棄する
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey)
        } catch {
          // no-op
        }
      }
      // 回答完了後はみんなの回答（集計）ページへ遷移する。
      // dirty は true のまま残るので、この自己遷移だけ blocker を素通りさせる。
      queryClient.invalidateQueries({ queryKey: ['tally', id] })
      bypassBlocker.current = true
      navigate(`/events/${id}/tally`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['myVotes', id] })
    },
  })

  const days = useMemo(
    () => (eventData ? groupByDay(eventData.candidates) : []),
    [eventData],
  )
  const totalSlots = eventData?.candidates.length ?? 0
  const answered = Object.keys(votes).length
  const participant = myData?.participant ?? null

  // 画面の入力値 votes と baseline（下書きの基準サーバー票）を枠単位で diff。
  // baseline と比較することで、別経路（CLI/MCP/他端末）で増減したサーバー票を
  // 「未送信のローカル変更」と誤認しない。差分のある枠 id 集合。
  const dirtyIds = useMemo(
    () => new Set(dirtyCandidateIds(votes, baseline)),
    [votes, baseline],
  )
  // 未送信の変更が「どこかに」あるか（参加登録済みのときだけ意味を持つ）。
  const dirty = !!participant && dirtyIds.size > 0

  // 離脱ガード（E）: 未送信のとき、ブラウザ離脱（reload/close）を beforeunload で警告。
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 一部ブラウザは returnValue のセットで確認ダイアログを出す（文言はブラウザ既定）。
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // 離脱ガード（E）: SPA 内遷移（ヘッダのリンク等）は useBlocker で止めて確認する。
  // 注意: dirty は votes と baseline（ローカル state）の差分で判定する（別経路のサーバー票
  // 変更を未送信と誤認しないための baseline 方式）。送信成功時も baseline は更新されないため
  // dirty は true のまま残る。したがって送信直後の自分の navigate も blocker に捕まってしまう。
  // それを避けるため、送信起点の自己遷移だけ bypassBlocker で素通りさせる（onSuccess で立てる）。
  const bypassBlocker = useRef(false)
  const blocker = useBlocker(
    useCallback(() => dirty && !bypassBlocker.current, [dirty]),
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const ok = window.confirm(
      '未送信の変更があります。送信せずにこのページを離れますか？',
    )
    if (ok) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  if (eventLoading || myLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (!eventData) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-no-ink)' }}>イベントが見つかりません。</p>
          <Link to="/" style={{ display: 'inline-block', marginTop: 16 }}>
            ホームへ
          </Link>
        </main>
      </div>
    )
  }

  const { event } = eventData

  const setVote = (candidateId: string, choice: VoteChoice) => {
    setVotes((prev) => ({ ...prev, [candidateId]: choice }))
  }
  const setDay = (day: DayGroup, choice: VoteChoice) => {
    setVotes((prev) => {
      const next = { ...prev }
      for (const s of day.slots) next[s.id] = choice
      return next
    })
  }
  const setBulk = (candidateIds: string[], choice: VoteChoice) => {
    setVotes((prev) => {
      const next = { ...prev }
      for (const id of candidateIds) next[id] = choice
      return next
    })
  }

  // 手動リセット（安全弁）: ローカル下書きを破棄して最新のサーバー票で画面を作り直す。
  // baseline も現在サーバーに更新するので dirty=false に戻る。どんな不整合状態でも
  // 1タップで「破棄→最新」に抜けられる。※「自分の未送信を送る」は送信ボタン側。
  const resetToServer = () => {
    const currentServer: VoteMap = {}
    for (const v of myData?.votes ?? []) {
      currentServer[v.candidateId] = v.choice as VoteChoice
    }
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey)
      } catch {
        // no-op
      }
    }
    setVotes(currentServer)
    setBaseline(currentServer)
    setExternalNotice(false)
  }

  const handleSubmit = () => {
    const payload: PutVoteInput[] = Object.entries(votes).map(([candidateId, choice]) => ({
      candidateId,
      choice,
    }))
    if (payload.length === 0) return
    voteMutation.mutate(payload)
  }

  // 送信できる＝未送信の変更があり、送信中でない。
  const canSubmit = dirty && !voteMutation.isPending
  // 全部入力済みでサーバーと一致（＝送信済み・変更なし）。
  const allSynced = !dirty && answered > 0

  return (
    <div>
      <AppHeader
        right={
          event.deadline ? (
            <Badge tone="neutral" dot>
              締切 {formatDeadline(event.deadline)}
            </Badge>
          ) : undefined
        }
      />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '32px 24px 110px' }}>
        <h2
          style={{
            margin: '0 0 4px',
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          {event.title}
        </h2>
        <p style={{ margin: '0 0 10px', fontSize: 14.5, color: 'var(--color-fg2)' }}>
          参加できる<b style={{ color: 'var(--color-fg1)' }}>時間帯</b>に{' '}
          <b style={{ color: 'var(--color-fg1)' }}>○ △ ×</b> で答えてください。
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 12.5, color: 'var(--color-fg3)', lineHeight: 1.6 }}>
          入力内容はこの端末に自動保存されます。
          <b style={{ color: 'var(--color-fg2)' }}>「回答を送信」</b>
          するまで、みんなの回答には反映されません。
        </p>

        {/* identity */}
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 14,
            marginBottom: 22,
            boxShadow: 'var(--shadow-xs)',
          }}
        >
          {participant ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <Avatar
                name={participant.displayName}
                kind={participant.kind === 'discord' ? 'discord' : 'guest'}
                size={36}
                idx={0}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg1)' }}>
                  {participant.displayName} として回答
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-fg3)' }}>
                  {participant.kind === 'discord' ? 'Discord でログイン中' : 'ゲストとして参加'}
                </div>
              </div>
            </div>
          ) : asGuest ? (
            <div>
              <Field label="お名前（ゲスト）" hint="匿名では回答できません">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    value={guestName}
                    onChange={setGuestName}
                    placeholder="例）みか"
                  />
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => registerMutation.mutate('guest')}
                    disabled={registerMutation.isPending || guestName.trim().length === 0}
                  >
                    登録
                  </Button>
                </div>
              </Field>
              <button
                type="button"
                onClick={() => setAsGuest(false)}
                style={{
                  marginTop: 10,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  color: 'var(--color-blue)',
                  padding: 0,
                }}
              >
                Discord でログインする
              </button>
            </div>
          ) : sessionUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <Avatar
                name={sessionUser.displayName}
                kind="discord"
                size={36}
                idx={0}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg1)' }}>
                  {sessionUser.displayName} として参加
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-fg3)' }}>
                  Discord でログイン中
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => registerMutation.mutate('discord')}
                disabled={registerMutation.isPending}
              >
                参加する
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAsGuest(true)}>
                名前を変える
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <a
                href={loginUrl(window.location.pathname)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 9,
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-blurple)',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: 'none',
                  boxShadow: '0 1px 2px rgba(88,101,242,.4)',
                }}
              >
                <DiscordMark size={19} />
                Discord でログイン
              </a>
              <button
                type="button"
                onClick={() => setAsGuest(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  color: 'var(--color-fg3)',
                  padding: 0,
                  textAlign: 'center',
                }}
              >
                ログインなしで名前を入れて回答する
              </button>
            </div>
          )}
          {registerError && (
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-no-ink)' }}>
              {registerError}
            </p>
          )}
        </div>

        {/* 別経路（CLI/MCP/他端末）でサーバー票が更新されていたときの一度きりの通知 */}
        {externalNotice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-blue-soft, var(--color-surface-sunken))',
              border: '1px solid var(--color-border)',
              fontSize: 13,
              color: 'var(--color-fg2)',
            }}
          >
            <Icon name="info" size={16} color="var(--color-blue)" />
            <span style={{ flex: 1 }}>
              別の経路で回答が更新されていたため、最新の内容を表示しています。
            </span>
            <button
              type="button"
              onClick={() => setExternalNotice(false)}
              aria-label="閉じる"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--color-fg4)',
                display: 'flex',
              }}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        )}

        {/* bulk bar */}
        {participant && eventData.candidates.length > 0 && (
          <BulkVoteBar
            candidates={eventData.candidates}
            onApply={setBulk}
            busyStartAts={busyData?.startAts}
          />
        )}

        {/* day cards */}
        {days.length === 0 ? (
          <p style={{ color: 'var(--color-fg3)', fontSize: 14 }}>候補枠がありません。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {days.map((day) => {
              const dayDone = day.slots.every((s) => votes[s.id])
              const wdLabel = WD[day.wd]
              const wdColor =
                day.wd === 0
                  ? 'var(--color-no-ink)'
                  : day.wd === 6
                    ? 'var(--color-blue)'
                    : 'var(--color-fg3)'
              return (
                <div
                  key={day.ymd}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: dayDone ? 'var(--shadow-sm)' : 'none',
                    overflow: 'hidden',
                    transition: 'box-shadow 200ms var(--ease-out)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '11px 16px',
                      borderBottom: '1px solid var(--separator)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: 'var(--color-fg1)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {day.md}{' '}
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: wdColor,
                          marginLeft: 1,
                        }}
                      >
                        {wdLabel}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--color-fg4)',
                          marginLeft: 8,
                        }}
                      >
                        {day.slots.length}枠
                      </span>
                    </div>
                    {day.slots.length > 1 && participant && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{ fontSize: 11, color: 'var(--color-fg4)', fontWeight: 600 }}
                        >
                          まとめて
                        </span>
                        {VOTE_OPTS.map((o) => (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => setDay(day, o.key)}
                            title={`全${day.slots.length}枠を${o.mark}`}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-surface)',
                              cursor: 'pointer',
                              fontSize: 14,
                              fontWeight: 700,
                              color: o.ink,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontFamily: 'inherit',
                            }}
                          >
                            {o.mark}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {day.slots.map((s, i) => (
                      <div
                        key={s.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          padding: '11px 16px',
                          borderTop: i ? '1px solid var(--separator)' : 'none',
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <Icon name="clock" size={16} color="var(--color-fg4)" />
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'var(--color-fg1)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {s.start}
                            <span style={{ color: 'var(--color-fg4)', fontWeight: 500 }}>
                              –{s.end}
                            </span>
                          </span>
                          {/* D: この枠の入力がサーバー送信済みと違う（未送信）ときだけ小さなピルを出す */}
                          {participant && dirtyIds.has(s.id) && (
                            <span
                              title="この枠はまだ送信されていません"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-pill)',
                                background: 'var(--color-warn-soft, var(--color-blurple-soft))',
                                color: 'var(--color-warn-ink, var(--color-blurple-ink))',
                                fontSize: 11,
                                fontWeight: 700,
                                lineHeight: 1.4,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: 'currentColor',
                                  flex: 'none',
                                }}
                              />
                              未送信
                            </span>
                          )}
                        </div>
                        <VoteControl
                          size="sm"
                          value={votes[s.id]}
                          onChange={(v) => participant && setVote(s.id, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* sticky submit */}
      {participant && totalSlots > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--surface-frost)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            borderTop: '1px solid var(--separator)',
            padding: '14px 24px',
          }}
        >
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            {/* B: 送信失敗の可視化。送信バー内にインラインの赤字メッセージ。 */}
            {voteMutation.isError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-no-ink)',
                }}
              >
                <Icon name="alert-circle" size={15} color="currentColor" />
                送信できませんでした。通信状況を確認して、もう一度お試しください。
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: 'var(--color-fg2)',
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span style={{ color: 'var(--color-fg1)', fontWeight: 600 }}>{answered}</span>
                <span style={{ color: 'var(--color-fg3)' }}>/{totalSlots} 枠</span>
                {/* A: 未送信の変更があることを示す全体バッジ */}
                {dirty ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      marginLeft: 10,
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--color-warn-ink, var(--color-blurple-ink))',
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'currentColor',
                        flex: 'none',
                      }}
                    />
                    未送信 {dirtyIds.size} 件（下に ● で表示）
                  </span>
                ) : allSynced ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      marginLeft: 10,
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-yes-ink)',
                    }}
                  >
                    <Icon name="check" size={14} color="currentColor" />
                    送信済み
                  </span>
                ) : (
                  answered < totalSlots &&
                  answered > 0 && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        color: 'var(--color-fg4)',
                        fontWeight: 500,
                      }}
                    >
                      （途中送信OK・あとから追記できます）
                    </span>
                  )
                )}
              </div>
              {/* 手動リセット（安全弁）: 未送信があるときだけ。下書きを破棄して最新サーバー票に更新。
                  下の枠ごと「● 未送信」ピル＋各枠の ○△× で「何を破棄するか」を確認してから押せる。 */}
              {dirty && !voteMutation.isPending && (
                <button
                  type="button"
                  onClick={resetToServer}
                  title="ローカルの未送信を破棄して、最新のサーバー状態に更新します"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    flex: 'none',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'var(--color-fg3)',
                    padding: '6px 4px',
                  }}
                >
                  <Icon name="rotate-ccw" size={14} color="currentColor" />
                  最新に更新
                </button>
              )}
              <Button
                variant="primary"
                size="md"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {voteMutation.isPending
                  ? '送信中...'
                  : allSynced
                    ? '送信済み'
                    : dirty
                      ? '未送信の変更を送信'
                      : '回答を送信'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
