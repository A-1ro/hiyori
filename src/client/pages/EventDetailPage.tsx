import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { $ZodIssue } from 'zod/v4/core'
import {
  fetchEvent,
  updateEvent,
  deleteEvent,
  deleteCandidate,
  fetchTally,
  createSubscription,
  ApiError,
  type CandidateResponse,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button, Badge, Icon } from '../components/primitives'
import { EventForm, eventResponseToFormValues, type EventFormState } from '../components/events/EventForm'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [editIssues, setEditIssues] = useState<$ZodIssue[] | undefined>()

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', id],
    queryFn: () => fetchEvent(id!),
    enabled: !!id,
  })

  const { data: tallyData } = useQuery({
    queryKey: ['tally', id],
    queryFn: () => fetchTally(id!),
    enabled: !!id,
  })

  const updateMutation = useMutation({
    mutationFn: (state: EventFormState) =>
      updateEvent(id!, {
        title: state.title,
        description: state.description || undefined,
        defaultDurationMinutes: state.defaultDurationMinutes,
        deadline: state.deadline ? new Date(state.deadline).toISOString() : null,
        timezone: state.timezone || 'UTC',
        discordChannelId: state.discordChannelId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', id] })
      setEditOpen(false)
      setEditIssues(undefined)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setEditIssues(err.issues)
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(id!),
    onSuccess: () => {
      navigate('/')
    },
  })

  const deleteCandidateMutation = useMutation({
    mutationFn: (candidateId: string) => deleteCandidate(id!, candidateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', id] })
      queryClient.invalidateQueries({ queryKey: ['tally', id] })
    },
  })

  if (isLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-no-ink)' }}>
            {error instanceof ApiError && error.status === 404
              ? 'イベントが見つかりません。'
              : 'エラーが発生しました。'}
          </p>
          <Button variant="ghost" onClick={() => navigate('/')} style={{ marginTop: 16 }}>
            ホームへ
          </Button>
        </main>
      </div>
    )
  }

  const { event, candidates } = data
  const decidedCandidateId = tallyData?.decision?.candidateId ?? null

  return (
    <div>
      <AppHeader
        right={
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevron-left" size={16} />}
            onClick={() => navigate('/')}
          >
            戻る
          </Button>
        }
      />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 8,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--color-fg1)' }}>
            {event.title}
          </h1>
          <Badge tone="open" dot>
            {event.status}
          </Badge>
        </div>

        {event.description && (
          <p style={{ margin: '8px 0 0', fontSize: 15, color: 'var(--color-fg2)', lineHeight: 1.6 }}>
            {event.description}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          {event.deadline && (
            <span style={{ fontSize: 13, color: 'var(--color-fg3)' }}>
              <Icon name="clock" size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              締切: {formatDateTime(event.deadline)}
            </span>
          )}
          <span style={{ fontSize: 13, color: 'var(--color-fg3)' }}>
            <Icon name="clock" size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            所要時間: {event.defaultDurationMinutes} 分
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <Link to={`/events/${id}/vote`}>
            <Button variant="primary" size="sm" icon={<Icon name="check-circle" size={14} />}>
              投票ページへ
            </Button>
          </Link>
          <Link to={`/events/${id}/tally`}>
            <Button variant="secondary" size="sm" icon={<Icon name="users" size={14} />}>集計を見る</Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="calendar" size={14} />}
            onClick={() => {
              setEditOpen(true)
              setEditIssues(undefined)
            }}
          >
            編集
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Icon name="trash" size={14} />}
            onClick={() => {
              if (confirm('このイベントを削除しますか？')) {
                deleteMutation.mutate()
              }
            }}
            disabled={deleteMutation.isPending}
          >
            削除
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="calendar" size={14} />}
            onClick={async () => {
              let actor = localStorage.getItem('hiyori_actor_discord_id')
              if (!actor) {
                actor = window.prompt('Discord ユーザー ID を入力してください (17-20 桁)') || ''
                if (!/^\d{17,20}$/.test(actor)) return
                localStorage.setItem('hiyori_actor_discord_id', actor)
              }
              try {
                const { webcalUrl } = await createSubscription({ actorDiscordId: actor })
                window.location.href = webcalUrl
              } catch {
                alert('購読の作成に失敗しました')
              }
            }}
          >
            Apple Calendar に購読
          </Button>
        </div>

        <section style={{ marginTop: 36 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--color-fg1)' }}>
            候補枠 ({candidates.length})
          </h2>
          {candidates.length === 0 ? (
            <p style={{ color: 'var(--color-fg3)', fontSize: 14 }}>候補枠がありません。</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {candidates.map((cand: CandidateResponse) => {
                const isDecided = cand.id === decidedCandidateId
                return (
                  <div
                    key={cand.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isDecided ? 'var(--color-yes-ink)' : 'var(--color-border)'}`,
                      background: isDecided ? 'var(--color-yes-soft)' : 'var(--color-surface)',
                    }}
                  >
                    <span style={{ fontSize: 14, color: 'var(--color-fg1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isDecided && <Badge tone="confirmed">★ 確定</Badge>}
                      {formatDateTime(cand.startAt)} 〜 {formatDateTime(cand.endAt)}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Icon name="trash" size={13} />}
                      onClick={() => deleteCandidateMutation.mutate(cand.id)}
                      disabled={deleteCandidateMutation.isPending}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {editOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 24,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditOpen(false)
          }}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-xl)',
              padding: 24,
              width: '100%',
              maxWidth: 520,
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>イベントを編集</h2>
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
                ✕
              </Button>
            </div>
            <EventForm
              initialValues={eventResponseToFormValues(event)}
              onSubmit={(state) => {
                setEditIssues(undefined)
                updateMutation.mutate(state)
              }}
              submitLabel="保存"
              isSubmitting={updateMutation.isPending}
              issues={editIssues}
              showCandidates={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
