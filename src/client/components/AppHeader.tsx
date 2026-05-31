import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Logo, Button } from './primitives'
import { useSession, useLogout, loginUrl } from '../auth/useSession'

export function AppHeader({ right, onHome }: { right?: ReactNode; onHome?: () => void }) {
  const { data: sessionData } = useSession()
  const logout = useLogout()
  const location = useLocation()
  const user = sessionData?.user ?? null

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: 'var(--surface-frost)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--separator)',
      }}
    >
      <div style={{ cursor: onHome ? 'pointer' : 'default' }} onClick={onHome}>
        <Logo size={32} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {right}
        {user ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--color-fg2)' }}>{user.displayName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              ログアウト
            </Button>
          </>
        ) : (
          <a
            href={loginUrl(location.pathname)}
            style={{
              fontSize: 13,
              color: 'var(--color-blurple-ink)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Discord でログイン
          </a>
        )}
      </div>
    </header>
  )
}
