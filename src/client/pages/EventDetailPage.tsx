import { useParams, useNavigate, Link } from 'react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  fetchEvent,
  deleteEvent,
  fetchTally,
  createSubscription,
  ApiError,
  type CandidateResponse,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button, Badge, Icon } from '../components/primitives'

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

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(id!),
    onSuccess: () => {
      navigate('/')
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
          <Link to={`/events/${id}/edit`}>
            <Button variant="secondary" size="sm" icon={<Icon name="calendar" size={14} />}>
              編集
            </Button>
          </Link>
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
              try {
                const { webcalUrl } = await createSubscription()
                window.location.href = webcalUrl
              } catch {
                alert('購読の作成に失敗しました（ログインが必要です）')
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
                      gap: 8,
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isDecided ? 'var(--color-yes-ink)' : 'var(--color-border)'}`,
                      background: isDecided ? 'var(--color-yes-soft)' : 'var(--color-surface)',
                    }}
                  >
                    {isDecided && <Badge tone="confirmed">★ 確定</Badge>}
                    <span style={{ fontSize: 14, color: 'var(--color-fg1)' }}>
                      {formatDateTime(cand.startAt)} 〜 {formatDateTime(cand.endAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
