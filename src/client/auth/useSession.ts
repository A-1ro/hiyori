import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export type SessionUser = {
  userId: string
  discordUserId: string
  username: string
  globalName: string | null
  avatar: string | null
  displayName: string
}

export function useSession() {
  return useQuery<{ user: SessionUser | null }>({
    queryKey: ['session'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (!res.ok) return { user: null }
      return res.json()
    },
    staleTime: Infinity,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error('ログアウトに失敗しました')
    },
    onSuccess: async () => {
      // 旧セッションで開始した読み込みは、後から完了してもキャッシュに戻さない。
      // session も対象にして、遅れて返る /auth/me がログイン状態を復活させない。
      await qc.cancelQueries()
      qc.setQueryData(['session'], { user: null })
      // invalidate だけでは再取得中も私的なデータが残る。reset で直ちに消し、
      // マウント中の画面にも通知してから、匿名として表示可能なデータを再取得する。
      await qc.resetQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
    },
  })
}

export function loginUrl(returnTo: string): string {
  return `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`
}
