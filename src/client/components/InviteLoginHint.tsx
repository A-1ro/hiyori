import { useLocation } from 'react-router'
import { loginUrl } from '../auth/useSession'
import { DiscordMark } from './primitives'

// 404 は存在しないイベントと閲覧権限のないイベントで共通。
// 招待の有無や現在のセッションから推測せず、利用者の操作で OAuth をやり直す。
export function InviteLoginHint() {
  const location = useLocation()

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ color: 'var(--color-fg2)', fontSize: 14, lineHeight: 1.7 }}>
        招待を受け取っている場合は、招待された Discord アカウントでログインし直してください。
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
        Discord で招待を確認
      </a>
    </div>
  )
}
