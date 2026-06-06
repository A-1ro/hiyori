import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
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
  const [asGuest, setAsGuest] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [registerError, setRegisterError] = useState<string | undefined>()
  const [votes, setVotes] = useState<Record<string, VoteChoice>>({})
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

  useEffect(() => {
    if (myData && myData.votes.length > 0) {
      const initial: Record<string, VoteChoice> = {}
      for (const v of myData.votes) {
        initial[v.candidateId] = v.choice as VoteChoice
      }
      setVotes(initial)
    }
  }, [myData])

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
      // 回答完了後はみんなの回答（集計）ページへ遷移する
      queryClient.invalidateQueries({ queryKey: ['tally', id] })
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

  const handleSubmit = () => {
    const payload: PutVoteInput[] = Object.entries(votes).map(([candidateId, choice]) => ({
      candidateId,
      choice,
    }))
    if (payload.length === 0) return
    voteMutation.mutate(payload)
  }

  const ready = answered > 0 && !!participant

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
        <p style={{ margin: '0 0 24px', fontSize: 14.5, color: 'var(--color-fg2)' }}>
          参加できる<b style={{ color: 'var(--color-fg1)' }}>時間帯</b>に{' '}
          <b style={{ color: 'var(--color-fg1)' }}>○ △ ×</b> で答えてください。
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
          <div
            style={{
              maxWidth: 600,
              margin: '0 auto',
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
              {answered < totalSlots && answered > 0 && (
                <span
                  style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-fg4)', fontWeight: 500 }}
                >
                  （途中送信OK・あとから追記できます）
                </span>
              )}
            </div>
            {voteMutation.isSuccess && (
              <span style={{ fontSize: 12, color: 'var(--color-yes-ink)' }}>保存しました</span>
            )}
            <Button
              variant="primary"
              size="md"
              disabled={!ready || voteMutation.isPending}
              onClick={handleSubmit}
            >
              {voteMutation.isPending ? '送信中...' : '回答を送信'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
