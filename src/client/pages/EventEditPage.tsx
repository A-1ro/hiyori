import { useId, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEvent,
  updateEvent,
  addCandidate,
  deleteCandidate,
  ApiError,
  fetchEventInvites,
  addEventInvite,
  removeEventInvite,
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
        visibility: payload.visibility,
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
          inviteManager={<EventInviteManager eventId={id!} />}
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

function EventInviteManager({ eventId }: { eventId: string }) {
  const [discordUserId, setDiscordUserId] = useState('')
  const inviteInputId = useId()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['eventInvites', eventId],
    queryFn: () => fetchEventInvites(eventId),
  })
  const addMutation = useMutation({
    mutationFn: () => addEventInvite(eventId, discordUserId.trim()),
    onSuccess: () => {
      setDiscordUserId('')
      queryClient.invalidateQueries({ queryKey: ['eventInvites', eventId] })
    },
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => removeEventInvite(eventId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eventInvites', eventId] }),
  })

  return (
    <section
      style={{
        padding: 20,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 17, color: 'var(--color-fg1)' }}>
        <label htmlFor={inviteInputId}>招待する Discord ユーザー ID</label>
      </h3>
      <p id={`${inviteInputId}-hint`} style={{ margin: '6px 0 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--color-fg3)' }}>
        招待限定イベントでは、ここに登録した Discord user ID の本人だけが閲覧・回答できます。公開イベントでも先に登録しておけます。招待の追加・取消はすぐに反映されます。公開範囲の変更には「保存する」が必要です。DM は自動送信されないため、イベントの URL を共有してください。
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          id={inviteInputId}
          value={discordUserId}
          onChange={(e) => setDiscordUserId(e.target.value)}
          placeholder="Discord user ID（17〜20桁）"
          inputMode="numeric"
          aria-describedby={`${inviteInputId}-hint`}
          style={{ flex: '1 1 180px', minWidth: 0, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-fg1)' }}
        />
        <Button
          variant="secondary"
          onClick={() => addMutation.mutate()}
          disabled={!/^\d{17,20}$/.test(discordUserId.trim()) || addMutation.isPending}
        >
          追加
        </Button>
      </div>
      {addMutation.error && <p style={{ margin: '8px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>招待の追加に失敗しました。</p>}
      {removeMutation.error && <p style={{ margin: '8px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>招待の取消に失敗しました。</p>}
      {error && <p style={{ margin: '12px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>招待一覧を読み込めません。</p>}
      {!isLoading && data?.invites.length === 0 && <p style={{ margin: '14px 0 0', color: 'var(--color-fg3)', fontSize: 13 }}>招待はまだありません。</p>}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {data?.invites.map((invite) => (
          <div key={invite.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)' }}>
            <code style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 13, color: 'var(--color-fg1)' }}>{invite.discordUserId}</code>
            <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(invite.discordUserId)} disabled={removeMutation.isPending} style={{ flexShrink: 0 }}>
              取消
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
