import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, createEvent } from '../api/client'
import { loginUrl, useSession } from '../auth/useSession'
import { Button } from '../components/primitives'
import { AppHeader } from '../components/AppHeader'
import { EventComposer, type ComposerPayload } from '../components/events/EventComposer'

// 認証確認の失敗は現在のセッション表示で案内し、復旧後のフォームに古いエラーを残さない。
class SessionCheckError extends Error {}

export function EventCreatePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  // Infinity のセッションキャッシュだけで入場を許可しない。
  const session = useSession({ refetchOnMount: 'always' })
  const [composerOwner, setComposerOwner] = useState<string | null>(null)
  const userId = session.data?.user?.discordUserId
  const sessionReady = session.isSuccess && !session.isFetching
  useEffect(() => {
    if (sessionReady && userId && !composerOwner) setComposerOwner(userId)
  }, [sessionReady, userId, composerOwner])
  const accountChanged = !!userId && !!composerOwner && userId !== composerOwner
  const canCreate = sessionReady && !!userId && !accountChanged
  const needsLogin = sessionReady && !userId

  const [searchParams] = useSearchParams()
  // /hiyori new スラッシュコマンドが発行した HMAC 署名トークン。サーバーで検証されるので、
  // クライアント側ではフォーマット検証はしない（不正値はサーバーが 400 で弾く）。
  const channelToken = searchParams.get('channelToken')?.trim() || undefined

  const mutation = useMutation({
    mutationFn: async (payload: ComposerPayload) => {
      // クリック直前の失効・他タブの切替も再確認する。保存時の最終認可は API に任せる。
      const current = await session.refetch()
      if (!current.isSuccess) throw new SessionCheckError('ログイン状態を確認できません。再確認してください。')
      if (!current.data.user) throw new ApiError('ログインが必要です', 401)
      if (current.data.user.discordUserId !== composerOwner) {
        throw new SessionCheckError('入力を始めた Discord アカウントでログインしてください。')
      }
      return createEvent({
        title: payload.title,
        description: payload.description,
        defaultDurationMinutes: payload.defaultDurationMinutes,
        visibility: payload.visibility,
        ...(payload.visibility === 'invite_only'
          ? { invitedDiscordUsernames: payload.invitedDiscordUsernames }
          : {}),
        deadline: payload.deadline,
        timezone: payload.timezone,
        discordChannelToken: payload.discordChannelToken,
        candidates: payload.candidates,
      })
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 401) {
        // 確認後に失効して POST が 401 になった場合も、古い /me 応答を戻さない。
        await queryClient.cancelQueries({ queryKey: ['session'], exact: true })
        queryClient.setQueryData(['session'], { user: null })
      }
    },
    onSuccess: (result) => {
      navigate('/events/' + result.event.id)
    },
  })

  const formError = mutation.error instanceof SessionCheckError ||
    (mutation.error instanceof ApiError && mutation.error.status === 401)
    ? undefined : mutation.error?.message

  return (
    <div>
      <AppHeader back={{ onClick: () => navigate('/'), label: 'キャンセル' }} loginInNewTab={!!composerOwner} />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px 96px' }}>
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          日程調整をつくる
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--color-fg2)' }}>
          候補日を出すと、回答用のリンクができます。
        </p>
        {!canCreate && (
          <section aria-label="作成に必要なログインの確認" style={{ marginBottom: 24, padding: 20, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-blurple-border)', background: 'var(--color-blurple-soft)', color: 'var(--color-fg1)' }}>
            <p role="status" style={{ margin: '0 0 12px', fontWeight: 700, lineHeight: 1.7 }}>
              {session.isFetching || (!session.data && !session.isError)
                ? 'ログイン状態を確認中です…'
                : session.isError
                  ? 'ログイン状態を確認できません。通信状況を確認して再試行してください。'
                  : accountChanged
                    ? '入力を始めた Discord アカウントと異なります。元のアカウントでログインし直してください。'
                    : composerOwner
                      ? 'ログインの有効期限が切れたか、ログアウトされました。作成するには再ログインが必要です。'
                      : '日程調整の作成には Discord ログインが必要です。'}
            </p>
            {composerOwner && (
              <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                入力内容はこのタブに残っています。このタブを閉じたり再読み込みしたりすると入力は失われます。
              </p>
            )}
            {composerOwner && (needsLogin || (sessionReady && accountChanged)) && (
              <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                別タブでログインしたら、このタブに戻って「ログイン状態を再確認」を押してください。
              </p>
            )}
            {(needsLogin || (sessionReady && accountChanged)) && (
              <a
                href={loginUrl(composerOwner ? '/me' : location.pathname + location.search)}
                target={composerOwner ? '_blank' : undefined}
                rel={composerOwner ? 'noopener noreferrer' : undefined}
                style={{ display: 'inline-block', padding: '12px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--color-blurple)', color: '#fff', fontWeight: 700, textDecoration: 'none' }}
              >
                {composerOwner ? 'Discord で再ログイン（別タブで開きます）' : 'Discord でログインして作成する'}
              </a>
            )}
            <div style={{ marginTop: 12 }}>
              <Button variant="ghost" disabled={session.isFetching} onClick={() => { mutation.reset(); void session.refetch() }}>
                ログイン状態を再確認
              </Button>
            </div>
          </section>
        )}
        {composerOwner && (
          // アンマウントせず、個人情報・招待情報をメモリ内だけに保持する。
          <fieldset disabled={!canCreate || mutation.isPending} aria-label="日程調整の入力" style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
            <EventComposer
              mode="create"
              discordChannelToken={channelToken}
              submitLabel="この内容でつくる"
              submittingLabel="作成中..."
              isSubmitting={mutation.isPending}
              errorMessage={canCreate ? formError : undefined}
              onSubmit={(payload) => { if (canCreate && !mutation.isPending) mutation.mutate(payload) }}
            />
          </fieldset>
        )}
      </main>
    </div>
  )
}
