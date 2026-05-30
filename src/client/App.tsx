import { AppHeader } from './components/AppHeader'
import { MiniMatrix } from './components/MiniMatrix'
import { Badge, Button, DiscordMark, Icon } from './components/primitives'

export function App() {
  return (
    <div>
      <AppHeader
        right={
          <Button
            variant="ghost"
            size="sm"
            icon={<DiscordMark size={17} color="var(--color-blurple)" />}
          >
            ログイン
          </Button>
        }
      />
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
            Discord と Apple Calendar をつなぐ
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
          みんなの「行ける日」が、すぐ見つかる。
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
          候補日を出して、<b style={{ color: 'var(--color-fg1)' }}>○ △ ×</b>{' '}
          で答えるだけ。決まった日は Discord に通知され、Apple Calendar にも自動で追加されます。
        </p>
        <div className="dm-hero-ctas">
          <Button
            variant="primary"
            size="lg"
            iconRight={<Icon name="arrow-right" size={18} color="#fff" />}
          >
            日程調整をつくる
          </Button>
          <Button variant="discord" size="lg" icon={<DiscordMark size={19} />}>
            Discord でログイン
          </Button>
        </div>
        <p style={{ marginTop: 16, fontSize: 13, color: 'var(--color-fg3)' }}>
          ログインなしでも、名前を入れればすぐ回答できます。
        </p>

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
        </div>
      </main>
    </div>
  )
}
