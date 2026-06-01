import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEvent,
  updateEvent,
  addCandidate,
  deleteCandidate,
  ApiError,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/primitives'
import {
  EventComposer,
  buildComposerInitial,
  type ComposerPayload,
} from '../components/events/EventComposer'

export function EventEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', id],
    queryFn: () => fetchEvent(id!),
    enabled: !!id,
  })

  const mutation = useMutation({
    mutationFn: async (payload: ComposerPayload) => {
      if (!data) throw new Error('No event loaded')
      await updateEvent(id!, {
        title: payload.title,
        description: payload.description,
        defaultDurationMinutes: payload.defaultDurationMinutes,
        deadline: payload.deadline ?? null,
        timezone: payload.timezone,
        // Discord 連携の付け替え/解除は編集 UI から行わない（/hiyori new 経由で再作成）
      })

      // 候補の差分: ISO 文字列ペアで一致判定
      const keyOf = (c: { startAt: string; endAt: string }) => `${c.startAt}|${c.endAt}`
      const existingByKey = new Map(data.candidates.map((c) => [keyOf(c), c]))
      const newKeys = new Set(payload.candidates.map(keyOf))
      const toAdd = payload.candidates.filter((c) => !existingByKey.has(keyOf(c)))
      const toRemove = data.candidates.filter((c) => !newKeys.has(keyOf(c)))

      // 追加・削除は並列実行（順序非依存）
      await Promise.all([
        ...toAdd.map((c) => addCandidate(id!, c)),
        ...toRemove.map((c) => deleteCandidate(id!, c.id)),
      ])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', id] })
      queryClient.invalidateQueries({ queryKey: ['tally', id] })
      navigate('/events/' + id)
    },
  })

  if (isLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px' }}>
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

  const initial = buildComposerInitial(data.event, data.candidates)

  return (
    <div>
      <AppHeader back={{ onClick: () => navigate(`/events/${id}`) }} />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px 96px' }}>
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          日程調整を編集
        </h2>
        <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--color-fg2)' }}>
          候補日や時間帯を見直して、保存できます。
        </p>
        <EventComposer
          mode="edit"
          initial={initial}
          linkedDiscordChannelId={data.event.discordChannelId}
          submitLabel="保存する"
          submittingLabel="保存中..."
          isSubmitting={mutation.isPending}
          errorMessage={mutation.error?.message}
          onSubmit={(payload) => mutation.mutate(payload)}
        />
      </main>
    </div>
  )
}
