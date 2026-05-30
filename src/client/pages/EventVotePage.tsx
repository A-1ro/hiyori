import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEvent,
  fetchMyVotes,
  registerParticipant,
  putVotes,
  ApiError,
  type CandidateResponse,
  type VoteResponse,
  type PutVoteInput,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button, Icon } from '../components/primitives'

type Choice = 'yes' | 'maybe' | 'no'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const CHOICE_LABELS: Record<Choice, string> = { yes: '○', maybe: '△', no: '×' }
const CHOICE_COLORS: Record<Choice, string> = {
  yes: 'var(--color-yes-ink)',
  maybe: 'var(--color-maybe-ink)',
  no: 'var(--color-no-ink)',
}

export function EventVotePage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [guestNameInput, setGuestNameInput] = useState('')
  const [registerError, setRegisterError] = useState<string | undefined>()
  const [localVotes, setLocalVotes] = useState<Record<string, { choice: Choice; comment: string }>>({})

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

  useEffect(() => {
    if (myData && myData.votes.length > 0) {
      const initial: Record<string, { choice: Choice; comment: string }> = {}
      for (const v of myData.votes) {
        initial[v.candidateId] = { choice: v.choice as Choice, comment: v.comment ?? '' }
      }
      setLocalVotes(initial)
    }
  }, [myData])

  const registerMutation = useMutation({
    mutationFn: () =>
      registerParticipant(id!, { kind: 'guest', displayName: guestNameInput }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myVotes', id] })
      setRegisterError(undefined)
    },
    onError: (err) => {
      setRegisterError(err instanceof ApiError ? err.message : '登録に失敗しました')
    },
  })

  const voteMutation = useMutation({
    mutationFn: (votes: PutVoteInput[]) => putVotes(id!, votes),
    onMutate: async (votes) => {
      await queryClient.cancelQueries({ queryKey: ['myVotes', id] })
      const previous = queryClient.getQueryData(['myVotes', id])
      queryClient.setQueryData(['myVotes', id], (old: { participant: unknown; votes: VoteResponse[] } | undefined) => {
        if (!old) return old
        const now = new Date().toISOString()
        const updated = votes.map((v) => ({
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
      })
      return { previous }
    },
    onError: (_err, _votes, context?: { previous: unknown }) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['myVotes', id], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['myVotes', id] })
    },
  })

  if (eventLoading || myLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (!eventData) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-no-ink)' }}>イベントが見つかりません。</p>
          <Link to="/" style={{ display: 'inline-block', marginTop: 16 }}>ホームへ</Link>
        </main>
      </div>
    )
  }

  const { event, candidates } = eventData
  const participant = myData?.participant ?? null

  const handleChoiceChange = (candidateId: string, choice: Choice) => {
    setLocalVotes((prev) => ({
      ...prev,
      [candidateId]: { choice, comment: prev[candidateId]?.comment ?? '' },
    }))
  }

  const handleCommentChange = (candidateId: string, comment: string) => {
    setLocalVotes((prev) => {
      if (!prev[candidateId]) return prev
      return {
        ...prev,
        [candidateId]: { choice: prev[candidateId].choice, comment },
      }
    })
  }

  const handleSubmit = () => {
    const votes: PutVoteInput[] = Object.entries(localVotes).map(([candidateId, { choice, comment }]) => ({
      candidateId,
      choice,
      comment: comment || undefined,
    }))
    if (votes.length === 0) return
    voteMutation.mutate(votes)
  }

  return (
    <div>
      <AppHeader
        right={
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevron-left" size={16} />}
            onClick={() => history.back()}
          >
            戻る
          </Button>
        }
      />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-fg1)' }}>
          {event.title} — 投票
        </h1>
        {participant ? (
          <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--color-fg3)' }}>
            {participant.displayName} として投票中
          </p>
        ) : null}

        {!participant && (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              marginBottom: 24,
            }}
          >
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>参加者名を入力</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={guestNameInput}
                onChange={(e) => setGuestNameInput(e.target.value)}
                placeholder="表示名（1〜80文字）"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-canvas)',
                  color: 'var(--color-fg1)',
                  fontSize: 14,
                }}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => registerMutation.mutate()}
                disabled={registerMutation.isPending || guestNameInput.trim().length === 0}
              >
                登録
              </Button>
            </div>
            {registerError && (
              <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-no-ink)' }}>{registerError}</p>
            )}
          </div>
        )}

        <section>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--color-fg1)' }}>
            候補枠 ({candidates.length})
          </h2>
          {candidates.length === 0 ? (
            <p style={{ color: 'var(--color-fg3)', fontSize: 14 }}>候補枠がありません。</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {candidates.map((cand: CandidateResponse) => {
                const current = localVotes[cand.id]
                return (
                  <div
                    key={cand.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <div style={{ fontSize: 14, color: 'var(--color-fg1)', marginBottom: 8 }}>
                      {formatDateTime(cand.startAt)} 〜 {formatDateTime(cand.endAt)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      {(['yes', 'maybe', 'no'] as Choice[]).map((choice) => (
                        <button
                          key={choice}
                          onClick={() => handleChoiceChange(cand.id, choice)}
                          disabled={!participant}
                          style={{
                            padding: '4px 16px',
                            borderRadius: 'var(--radius-sm)',
                            border: `2px solid ${current?.choice === choice ? CHOICE_COLORS[choice] : 'var(--color-border)'}`,
                            background: current?.choice === choice ? 'var(--color-surface-raised)' : 'transparent',
                            color: current?.choice === choice ? CHOICE_COLORS[choice] : 'var(--color-fg2)',
                            fontWeight: current?.choice === choice ? 700 : 400,
                            cursor: participant ? 'pointer' : 'not-allowed',
                            fontSize: 16,
                          }}
                        >
                          {CHOICE_LABELS[choice]}
                        </button>
                      ))}
                    </div>
                    {current && (
                      <input
                        type="text"
                        value={current.comment}
                        onChange={(e) => handleCommentChange(cand.id, e.target.value)}
                        placeholder="コメント（任意、500文字以内）"
                        maxLength={500}
                        disabled={!participant}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-canvas)',
                          color: 'var(--color-fg1)',
                          fontSize: 13,
                          boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {participant && (
          <div style={{ marginTop: 24 }}>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={voteMutation.isPending || Object.keys(localVotes).length === 0}
            >
              {voteMutation.isPending ? '送信中...' : '投票を送信'}
            </Button>
            {voteMutation.isSuccess && (
              <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--color-yes-ink)' }}>
                投票を保存しました
              </span>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
