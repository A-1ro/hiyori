import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Avatar, Button, DiscordMark, Icon, Logo } from './primitives'
import { useSession, useLogout, loginUrl } from '../auth/useSession'

export interface AppHeaderBack {
  onClick: () => void
  label?: string
}

export function AppHeader({ back, right }: { back?: AppHeaderBack; right?: ReactNode }) {
  const { data: sessionData } = useSession()
  const logout = useLogout()
  const location = useLocation()
  const user = sessionData?.user ?? null
  const onMyPage = location.pathname === '/me'

  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const update = () => setIsNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const logoSize = isNarrow ? 26 : 32
  const hPad = isNarrow ? 14 : 24
  const gap = isNarrow ? 8 : 12

  const backLabel = back?.label ?? '戻る'

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
        padding: `0 ${hPad}px`,
        background: 'var(--surface-frost)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--separator)',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: isNarrow ? 4 : 8, minWidth: 0 }}>
        {back && (
          <button
            type="button"
            onClick={back.onClick}
            aria-label={backLabel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: isNarrow ? 6 : '6px 10px 6px 6px',
              borderRadius: 8,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-fg2)',
            }}
          >
            <Icon name="chevron-left" size={isNarrow ? 20 : 18} />
            {!isNarrow && backLabel}
          </button>
        )}
        <Link
          to="/"
          aria-label="ホーム"
          style={{ display: 'inline-flex', textDecoration: 'none' }}
        >
          <Logo size={logoSize} withWord={!isNarrow} />
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap, minWidth: 0 }}>
        {right}
        {user ? (
          <>
            {isNarrow ? (
              onMyPage ? (
                <Avatar name={user.displayName} kind="discord" size={26} />
              ) : (
                <Link
                  to="/me"
                  aria-label={user.displayName}
                  style={{ display: 'inline-flex' }}
                >
                  <Avatar name={user.displayName} kind="discord" size={26} />
                </Link>
              )
            ) : onMyPage ? (
              <span style={{ fontSize: 13, color: 'var(--color-fg2)' }}>{user.displayName}</span>
            ) : (
              <Link
                to="/me"
                style={{
                  fontSize: 13,
                  color: 'var(--color-fg2)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                {user.displayName}
              </Link>
            )}
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--color-blurple-ink)',
              textDecoration: 'none',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <DiscordMark size={16} color="var(--color-blurple)" />
            {isNarrow ? 'ログイン' : 'Discord でログイン'}
          </a>
        )}
      </div>
    </header>
  )
}
