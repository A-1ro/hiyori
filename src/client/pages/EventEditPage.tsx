import { useId } from 'react'
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
import { DiscordInviteFields, useDiscordInviteDraft, validateDiscordInviteDraft } from '../components/events/DiscordInviteFields'
import { normalizeDiscordUsername } from '../../shared/discord-invites'
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
  const inviteDraft = useDiscordInviteDraft()
  const inviteInputId = useId()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['eventInvites', eventId],
    queryFn: () => fetchEventInvites(eventId),
  })
  const { usernames: discordUsernames, error: inviteError } = validateDiscordInviteDraft(inviteDraft, data?.invites)
  const addMutation = useMutation({
    mutationFn: async (usernames: string[]) => {
      // Existing edit behavior applies invitations immediately. Keep unsubmitted rows on failure.
      for (const discordUsername of usernames) {
        await addEventInvite(eventId, { discordUsername })
        inviteDraft.usernameRows.removeSubmitted(discordUsername, normalizeDiscordUsername)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['eventInvites', eventId] }),
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
        Discord アカウントを招待
      </h3>
      <p id={`${inviteInputId}-hint`} style={{ margin: '6px 0 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--color-fg3)' }}>
        1 欄に 1 人のユーザー名を入力すると、次の欄が表示されます（最大 500 人）。重複するユーザー名はまとめます。公開イベントでも先に登録しておけます。招待の追加・取消はすぐに反映されます。公開範囲の変更には「保存する」が必要です。ユーザー名で招待した相手には、イベントの URL を共有して Discord でログインしてもらってください。DM は自動送信されません。
      </p>
      <p style={{ margin: '6px 0 14px', fontSize: 12, lineHeight: 1.6, color: 'var(--color-fg3)' }}>
        ユーザー名の招待は、最初の受取り時にその名前を持つアカウントへ結び付きます。受取り前の名前変更や入力間違いに注意してください。受取り後は名前が変わっても同じアカウントの招待として扱い、取消時は同じアカウントへの招待をまとめて取り消します。
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        <DiscordInviteFields
          id={inviteInputId}
          draft={inviteDraft}
          describedBy={`${inviteInputId}-hint${inviteError ? ` ${inviteInputId}-error` : ''}`}
          disabled={addMutation.isPending}
        />
        <Button
          variant="secondary"
          onClick={() => {
            if (discordUsernames.length && !inviteError && !addMutation.isPending) addMutation.mutate(discordUsernames)
          }}
          disabled={!discordUsernames.length || Boolean(inviteError) || addMutation.isPending}
          style={{ justifySelf: 'start' }}
        >
          追加
        </Button>
      </div>
      {inviteError && <p id={`${inviteInputId}-error`} role="alert" style={{ margin: '8px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>{inviteError}</p>}
      {addMutation.error && <p role="alert" style={{ margin: '8px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>招待の追加に失敗しました。未登録の入力は残っています。</p>}
      {removeMutation.error && <p style={{ margin: '8px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>招待の取消に失敗しました。</p>}
      {error && <p style={{ margin: '12px 0 0', color: 'var(--color-no-ink)', fontSize: 13 }}>招待一覧を読み込めません。</p>}
      {!isLoading && data?.invites.length === 0 && <p style={{ margin: '14px 0 0', color: 'var(--color-fg3)', fontSize: 13 }}>招待はまだありません。</p>}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {data?.invites.map((invite) => (
          <div key={invite.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <code style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 13, color: 'var(--color-fg1)' }}>{invite.discordUsername ? `@${invite.discordUsername}` : '以前の招待'}</code>
              {invite.discordUsername && <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: 'var(--color-fg3)' }}>{invite.discordUserId ? '受取り済み' : '受取り待ち · Discord ログイン時に確認'}</span>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(invite.id)} disabled={removeMutation.isPending} style={{ flexShrink: 0 }}>
              取消
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
