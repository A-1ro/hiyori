import { useNavigate } from 'react-router'
import { AppHeader } from '../components/AppHeader'
import { MiniMatrix } from '../components/MiniMatrix'
import { Badge, Button, DiscordMark, Icon } from '../components/primitives'
import { DISCORD_BOT_INVITE_URL, DISCORD_BOT_INVITE_LABEL } from '../lib/discord'

function loginHref(returnTo: string): string {
  return `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`
}

export function LandingScreen() {
  const navigate = useNavigate()
  return (
    <div>
      <AppHeader />
      <main
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '48px 24px 120px',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'inline-flex', marginBottom: 22 }}>
          <Badge tone="discord" dot>
            Discord 日程調整
          </Badge>
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 'clamp(28px, 7vw, 46px)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.14,
            color: 'var(--color-fg1)',
            overflowWrap: 'anywhere',
          }}
        >
          「○△× だけじゃ、日程って決まらなくない？」
        </h1>
        <p
          style={{
            margin: '22px auto 0',
            maxWidth: 480,
            fontSize: 17,
            lineHeight: 1.65,
            color: 'var(--color-fg2)',
          }}
        >
          同じ「○」でも、昼のつもりの人と夜のつもりの人がいる。Hiyori は
          <b style={{ color: 'var(--color-fg1)' }}>時間帯ごと</b>
          に聞くから、いちいち確認し直さなくていい。決まった日はカレンダーにも自動で入ります。
        </p>
        <div className="dm-hero-ctas">
          <Button
            variant="primary"
            size="lg"
            iconRight={<Icon name="arrow-right" size={18} color="#fff" />}
            onClick={() => navigate('/events/new')}
          >
            日程調整をつくる
          </Button>
          <Button
            variant="discord"
            size="lg"
            icon={<DiscordMark size={19} />}
            onClick={() => {
              window.location.href = loginHref('/')
            }}
          >
            Discord でログイン
          </Button>
        </div>
        <p style={{ marginTop: 16, fontSize: 13, color: 'var(--color-fg3)' }}>
          ログインなしでも、名前を入れればすぐ回答できます。
        </p>
        <div style={{ marginTop: 10 }}>
          <a
            href={DISCORD_BOT_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--color-blurple)',
              textDecoration: 'none',
            }}
          >
            <DiscordMark size={13} color="var(--color-blurple)" />
            {DISCORD_BOT_INVITE_LABEL}
          </a>
        </div>

        <div
          style={{
            marginTop: 56,
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--color-border)',
            padding: 22,
            textAlign: 'left',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-fg1)' }}>
              年末の打ち上げ 🍻
            </div>
            <Badge tone="open" dot>
              受付中
            </Badge>
          </div>
          <MiniMatrix />
          <p
            style={{
              margin: '16px 0 0',
              paddingTop: 14,
              borderTop: '1px solid var(--color-border)',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--color-fg3)',
            }}
          >
            スコアが一番高い枠に{' '}
            <b style={{ color: 'var(--color-fg2)' }}>★ 最有力</b>{' '}
            が付く。全員の○△×を見比べる
            <b style={{ color: 'var(--color-fg2)' }}>「日程テトリス」</b>
            は、もうしなくていい。
          </p>
        </div>
      </main>
    </div>
  )
}
