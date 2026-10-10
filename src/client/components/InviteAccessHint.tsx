import { useIsFetching, useQueryClient, type Query } from '@tanstack/react-query'
import { useLocation, useParams } from 'react-router'
import { loginUrl, useSession } from '../auth/useSession'
import { Button, DiscordMark } from './primitives'

const EVENT_READ_QUERIES = new Set(['event', 'tally', 'myVotes', 'myBusy', 'permissions'])

// 不存在・権限なし・招待照合の一時失敗は、同じ 404 と同じ案内にする。
// ログイン済みなら API の再取得で本人の現在の Discord ユーザー名を確認する。
export function InviteAccessHint() {
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data: sessionData, isPending, error } = useSession()
  const isCurrentEventRead = (query: Query) =>
    !!id && query.queryKey[1] === id && EVENT_READ_QUERIES.has(String(query.queryKey[0]))
  const isRetrying = useIsFetching({ predicate: isCurrentEventRead }) > 0

  if (!sessionData?.user && (isPending || error)) {
    return (
      <p style={{ color: 'var(--color-fg2)', fontSize: 14 }}>
        {error
          ? 'ログイン状態を確認できません。時間をおいてページを再読み込みしてください。'
          : 'ログイン状態を確認しています。'}
      </p>
    )
  }

  if (sessionData?.user) {
    return (
      <div style={{ marginTop: 20 }}>
        <p style={{ color: 'var(--color-fg2)', fontSize: 14, lineHeight: 1.7 }}>
          ログインしたまま再試行できます。時間をおいてもう一度お試しください。
        </p>
        <Button
          variant="secondary"
          disabled={isRetrying || !id}
          onClick={() => {
            void queryClient.refetchQueries(
              { type: 'active', predicate: isCurrentEventRead },
              { cancelRefetch: false },
            )
          }}
        >
          {isRetrying ? '確認中...' : '再試行する'}
        </Button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ color: 'var(--color-fg2)', fontSize: 14, lineHeight: 1.7 }}>
        招待を受け取っている場合は、招待された Discord アカウントでログインしてください。
      </p>
      <a
        href={loginUrl(location.pathname)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--color-blurple-ink)',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        <DiscordMark size={18} color="var(--color-blurple)" />
        Discord でログイン
      </a>
    </div>
  )
}
