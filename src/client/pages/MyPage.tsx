import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppHeader } from '../components/AppHeader'
import { Avatar, Badge, Button, DiscordMark, Icon } from '../components/primitives'
import { loginUrl, useLogout, useSession, type SessionUser } from '../auth/useSession'
import {
  ApiError,
  createSubscription,
  deleteSubscription,
  fetchMyEvents,
  fetchMySubscriptions,
  regenerateSubscription,
  type EventResponse,
  type MySubscription,
} from '../api/client'

const WD = ['日', '月', '火', '水', '木', '金', '土']

function discordAvatarUrl(user: SessionUser, size = 80): string | null {
  if (!user.avatar) return null
  return `https://cdn.discordapp.com/avatars/${user.discordUserId}/${user.avatar}.png?size=${size}`
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${md}（${WD[d.getDay()]}）${hm}`
}

function EventRow({ event }: { event: EventResponse }) {
  const isClosed = event.status === 'closed'
  const isCancelled = event.status === 'cancelled'
  return (
    <Link
      to={`/events/${event.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-xs)',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-sm)',
          background: isClosed
            ? 'var(--color-yes-soft)'
            : isCancelled
              ? 'var(--color-gray-100)'
              : 'var(--color-blue-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <Icon
          name={isClosed ? 'check' : 'calendar'}
          size={18}
          color={
            isClosed
              ? 'var(--color-yes-ink)'
              : isCancelled
                ? 'var(--color-fg3)'
                : 'var(--color-blue)'
          }
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-fg1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {event.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-fg3)', marginTop: 2 }}>
          作成 {formatCreatedAt(event.createdAt)}
          {event.deadline && <> ・ 締切 {formatDeadline(event.deadline)}</>}
        </div>
      </div>
      {isClosed ? (
        <Badge tone="confirmed" dot>
          確定済み
        </Badge>
      ) : isCancelled ? (
        <Badge tone="neutral">中止</Badge>
      ) : (
        <Badge tone="open" dot>
          受付中
        </Badge>
      )}
    </Link>
  )
}

function EventSection({
  title,
  events,
  emptyText,
}: {
  title: string
  events: EventResponse[]
  emptyText: string
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-fg1)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        <span style={{ fontSize: 12, color: 'var(--color-fg3)' }}>{events.length}件</span>
      </div>
      {events.length === 0 ? (
        <div
          style={{
            padding: '20px 16px',
            fontSize: 13,
            color: 'var(--color-fg3)',
            textAlign: 'center',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </section>
  )
}

function SubscriptionCard({
  subscription,
  onDeleted,
  onRegenerated,
}: {
  subscription: MySubscription
  onDeleted: () => void
  onRegenerated: () => void
}) {
  const [copied, setCopied] = useState(false)
  const deleteMut = useMutation({
    mutationFn: () => deleteSubscription(subscription.id),
    onSuccess: onDeleted,
  })
  const regenerateMut = useMutation({
    mutationFn: () => regenerateSubscription(subscription.id),
    onSuccess: onRegenerated,
  })

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(subscription.webcalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-xs)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-blue-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <Icon name="calendar" size={18} color="var(--color-blue)" />
        </div>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--color-fg3)' }}>
          作成 {formatCreatedAt(subscription.createdAt)}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--color-gray-100)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 12.5,
            color: 'var(--color-fg2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
          title={subscription.webcalUrl}
        >
          {subscription.webcalUrl}
        </span>
        <Button
          variant={copied ? 'secondary' : 'primary'}
          size="sm"
          onClick={handleCopy}
          icon={
            <Icon
              name={copied ? 'check' : 'copy'}
              size={14}
              color={copied ? 'var(--color-yes-ink)' : '#fff'}
            />
          }
        >
          {copied ? 'コピー済み' : 'コピー'}
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (window.location.href = subscription.webcalUrl)}
          icon={<Icon name="calendar" size={14} />}
        >
          Calendar を開く
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!confirm('購読 URL を再生成しますか？既存のリンクは無効になります。')) return
            regenerateMut.mutate()
          }}
          disabled={regenerateMut.isPending}
        >
          再生成
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (!confirm('この購読を削除しますか？')) return
            deleteMut.mutate()
          }}
          disabled={deleteMut.isPending}
          icon={<Icon name="trash" size={14} />}
        >
          削除
        </Button>
      </div>
    </div>
  )
}

function SubscriptionsSection() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | undefined>()
  const { data, isLoading } = useQuery({
    queryKey: ['mySubscriptions'],
    queryFn: fetchMySubscriptions,
  })

  const createMut = useMutation({
    mutationFn: createSubscription,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mySubscriptions'] }),
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : '購読の作成に失敗しました')
    },
  })

  const subs = data?.subscriptions ?? []

  return (
    <section style={{ marginTop: 28 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-fg1)',
            letterSpacing: '-0.01em',
          }}
        >
          Apple Calendar 購読
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setError(undefined)
            createMut.mutate()
          }}
          disabled={createMut.isPending}
          icon={<Icon name="plus" size={14} />}
        >
          新規購読
        </Button>
      </div>
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 12.5,
          color: 'var(--color-fg3)',
          lineHeight: 1.55,
        }}
      >
        Webcal URL をカレンダーアプリに登録すると、参加イベントの確定日が自動で同期されます。
      </p>
      {isLoading ? (
        <div style={{ fontSize: 13, color: 'var(--color-fg3)' }}>読み込み中...</div>
      ) : subs.length === 0 ? (
        <div
          style={{
            padding: '20px 16px',
            fontSize: 13,
            color: 'var(--color-fg3)',
            textAlign: 'center',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          購読はまだありません。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {subs.map((s) => (
            <SubscriptionCard
              key={s.id}
              subscription={s}
              onDeleted={() => qc.invalidateQueries({ queryKey: ['mySubscriptions'] })}
              onRegenerated={() => qc.invalidateQueries({ queryKey: ['mySubscriptions'] })}
            />
          ))}
        </div>
      )}
      {error && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-no-ink)' }}>{error}</p>
      )}
    </section>
  )
}

function ProfileCard({ user }: { user: SessionUser }) {
  const logout = useLogout()
  const avatarUrl = discordAvatarUrl(user)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 18,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={user.displayName}
          width={56}
          height={56}
          style={{ borderRadius: '50%', display: 'block', flex: 'none' }}
        />
      ) : (
        <Avatar name={user.displayName} kind="discord" size={56} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--color-fg1)',
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {user.displayName}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--color-fg3)',
            marginTop: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <DiscordMark size={12} color="var(--color-blurple)" />
          {user.username}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        ログアウト
      </Button>
    </div>
  )
}

export function MyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: sessionData, isLoading: sessionLoading } = useSession()
  const user = sessionData?.user ?? null

  const { data: myEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ['myEvents'],
    queryFn: fetchMyEvents,
    enabled: !!user,
  })

  if (sessionLoading) {
    return (
      <div>
        <AppHeader onHome={() => navigate('/')} />
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (!user) {
    return (
      <div>
        <AppHeader onHome={() => navigate('/')} />
        <main
          style={{ maxWidth: 480, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}
        >
          <div style={{ display: 'inline-flex', marginBottom: 20 }}>
            <Badge tone="discord" dot>
              ログインが必要です
            </Badge>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--color-fg1)',
            }}
          >
            マイページ
          </h1>
          <p
            style={{
              margin: '14px auto 24px',
              fontSize: 14,
              color: 'var(--color-fg2)',
              lineHeight: 1.6,
            }}
          >
            主催・参加したイベントと、Apple Calendar 購読を管理できます。
          </p>
          <Button
            variant="discord"
            size="lg"
            icon={<DiscordMark size={18} />}
            onClick={() => {
              window.location.href = loginUrl(location.pathname)
            }}
          >
            Discord でログイン
          </Button>
        </main>
      </div>
    )
  }

  return (
    <div>
      <AppHeader onHome={() => navigate('/')} />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px 80px' }}>
        <ProfileCard user={user} />

        {eventsLoading ? (
          <p style={{ marginTop: 28, fontSize: 13, color: 'var(--color-fg3)' }}>
            イベントを読み込み中...
          </p>
        ) : (
          <>
            <EventSection
              title="主催したイベント"
              events={myEvents?.organized ?? []}
              emptyText="まだ主催しているイベントはありません。"
            />
            <EventSection
              title="参加したイベント"
              events={myEvents?.participating ?? []}
              emptyText="まだ参加したイベントはありません。"
            />
          </>
        )}

        <SubscriptionsSection />

        <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="primary"
            size="md"
            icon={<Icon name="plus" size={16} color="#fff" />}
            onClick={() => navigate('/events/new')}
          >
            新しい日程調整をつくる
          </Button>
        </div>
      </main>
    </div>
  )
}
