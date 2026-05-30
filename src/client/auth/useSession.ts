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
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session'] }),
  })
}

export function loginUrl(returnTo: string): string {
  return `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`
}
