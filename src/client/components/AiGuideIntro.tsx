import { Link } from 'react-router'
import { Icon } from './primitives'

export function AiGuideIntro() {
  return (
    <section
      aria-label="AI 連携"
      style={{
        marginTop: 24,
        padding: 24,
        border: '1px solid var(--color-blurple-border)',
        borderRadius: 20,
        background:
          'linear-gradient(135deg, var(--color-blurple-soft), var(--color-surface))',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-blurple-ink)',
        }}
      >
        <Icon name="sparkles" size={15} />
        AI 連携
      </div>
      <h2
        style={{
          margin: '10px 0',
          fontSize: 'clamp(22px, 4vw, 26px)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.45,
        }}
      >
        いつものAIからHiyoriを使う
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.8,
          color: 'var(--color-fg2)',
        }}
      >
        ChatGPT や Claude と会話しながら、
        <br />
        イベント作成・回答・集計・日程確定まで。
      </p>
      <figure
        aria-label="AI連携の使用例（会話のサンプル）"
        style={{
          margin: '18px 0 0',
          padding: 16,
          borderRadius: 14,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-blurple-border)',
        }}
      >
        <figcaption
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-fg2)',
            marginBottom: 16,
          }}
        >
          使用例
        </figcaption>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            fontSize: 13,
            lineHeight: 1.8,
            color: 'var(--color-fg1)',
          }}
        >
          <div style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-fg2)',
                textAlign: 'right',
                marginBottom: 5,
              }}
            >
              あなた
            </div>
            <div
              style={{
                padding: '11px 14px',
                borderRadius: '14px 14px 4px 14px',
                background: 'var(--color-blurple-soft)',
                color: 'var(--color-blurple-ink)',
              }}
            >
              来週の平日19時から、1時間の打ち合わせを作って。
            </div>
          </div>
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '94%',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                marginTop: 23,
                width: 24,
                height: 24,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                background: 'var(--color-blurple-soft)',
                color: 'var(--color-blurple-ink)',
              }}
            >
              <Icon name="sparkles" size={13} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-fg2)',
                  marginBottom: 5,
                }}
              >
                AI
              </div>
              <div
                style={{
                  padding: '11px 14px',
                  borderRadius: '14px 14px 14px 4px',
                  background: 'var(--color-gray-100)',
                }}
              >
                <p style={{ margin: 0 }}>
                  「打ち合わせ」の日程調整を作成しました。
                </p>
                <p style={{ margin: '6px 0 0' }}>
                  候補は来週の月〜金、各19:00〜20:00です。共有リンクから参加者に回答してもらえます。
                </p>
                <div
                  style={{
                    marginTop: 10,
                    padding: '9px 11px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 9,
                    background: 'var(--color-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                  }}
                >
                  <Icon
                    name="calendar"
                    size={17}
                    color="var(--color-blurple)"
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>打ち合わせ</div>
                    <div style={{ fontSize: 11, color: 'var(--color-fg2)' }}>
                      候補5件 · 各1時間
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </figure>
      <Link
        to="/help/mcp"
        style={{
          marginTop: 18,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 10,
          background: 'var(--color-blurple)',
          color: 'var(--color-gray-0)',
          textDecoration: 'none',
        }}
      >
        AI 連携をはじめる
        <Icon name="arrow-right" size={16} />
      </Link>
    </section>
  )
}
