import { Link, useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { Icon } from '../components/primitives'
import { FeedbackButton } from '../components/FeedbackButton'
import { useMcpStatus } from '../auth/useMcpStatus'
import { GuideStyles } from './guideStyles'

// 本番の独自ドメイン（例示の正）。セルフホスト向けは「あなたの Hiyori の URL」と一般化して併記する。
const PROD_HOST = 'https://hiyori-schedule.com'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 40 }}>
      <h2
        style={{
          margin: '0 0 12px',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--color-fg1)',
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>{children}</div>
    </section>
  )
}

function Steps({ items }: { items: { label: string; desc: ReactNode }[] }) {
  return (
    <ol style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 16 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--color-blurple)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}
          >
            {i + 1}
          </span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 2 }}>
              {item.label}
            </div>
            <div style={{ color: 'var(--color-fg2)', fontSize: 14, lineHeight: 1.7 }}>
              {item.desc}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Code({ children }: { children: string }) {
  return (
    <code
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface-raised, #f0f0f0)',
        fontFamily: 'monospace',
        fontSize: 14,
        color: 'var(--color-fg1)',
        wordBreak: 'break-all',
      }}
    >
      {children}
    </code>
  )
}

// 端末に打ち込むコマンドのブロック表示（複数行可）。狭い幅では折り返して全文を表示する。
function CommandBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="hy-codeblock">
      {lines.map((l, i) => (
        <div key={i}>
          <span className="hy-prompt">$ </span>
          {l}
        </div>
      ))}
    </pre>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface-raised, #f5f5f5)',
        fontSize: 14,
        lineHeight: 1.7,
        color: 'var(--color-fg2)',
      }}
    >
      {children}
    </div>
  )
}

// cli/src/commands/ に忠実なコマンド。destructive は取り消せない削除・解除操作。
type Cmd = { cmd: string; destructive?: boolean; use: string }
type CmdGroup = { title: string; rows: Cmd[] }

const GROUPS: CmdGroup[] = [
  {
    title: '認証・設定',
    rows: [
      { cmd: 'hiyori login', use: 'デバイスコード（RFC 8628）で Discord にログインする。ブラウザで承認' },
      { cmd: 'hiyori logout', use: 'ログアウトして保存済みの認証情報を削除する' },
      { cmd: 'hiyori whoami', use: '現在ログイン中のユーザーを表示する' },
      { cmd: 'hiyori config get <key>', use: '設定値を取得する（key は api-url）' },
      { cmd: 'hiyori config set <key> <value>', use: '設定値を保存する（例: api-url に接続先を設定）' },
    ],
  },
  {
    title: 'イベント',
    rows: [
      { cmd: 'hiyori event list', use: '自分が主催・参加しているイベントの一覧を表示する' },
      { cmd: 'hiyori event show <id>', use: 'イベント 1 件の詳細（候補日時など）を表示する' },
      { cmd: 'hiyori event create', use: 'イベントを新規作成する（--title / --candidate / --deadline… 対話入力にも対応）' },
      { cmd: 'hiyori event edit <id>', use: 'イベントの基本情報を編集する（--title / --deadline / --clear-deadline…）。主催者のみ' },
      { cmd: 'hiyori event rm <id>', destructive: true, use: 'イベントを完全に削除する（--yes で確認省略）。主催者のみ・取り消せない' },
      { cmd: 'hiyori candidate add <id>', use: '候補日時を 1 件追加する（--start / --end）。主催者のみ' },
      { cmd: 'hiyori candidate rm <id> <candidateId>', destructive: true, use: '候補日時を 1 件削除する（--yes）。主催者のみ・取り消せない' },
    ],
  },
  {
    title: '投票・集計・確定',
    rows: [
      { cmd: 'hiyori vote <id>', use: 'イベントに投票する（--vote 候補ID=yes/maybe/no / --name 表示名）' },
      { cmd: 'hiyori tally <id>', use: '集計（候補ごとの ○△× マトリクス・確定状況）を表示する' },
      { cmd: 'hiyori confirm <id> <candidateId...>', use: '主催者として開催日を確定する（候補 ID を 1 件以上）。.ics 配布が有効に' },
      { cmd: 'hiyori unconfirm <id>', destructive: true, use: '確定を取り消して未確定に戻す（--yes）。主催者のみ・.ics 配布は無効に' },
      { cmd: 'hiyori busy', use: '自分の確定済み予定（埋まっている日）を表示する' },
    ],
  },
  {
    title: 'カレンダー',
    rows: [
      { cmd: 'hiyori ics <id>', use: '確定済みイベントの .ics を出力する（-o <file> でファイル保存）' },
      { cmd: 'hiyori sub list', use: 'カレンダー購読（webcal）の一覧を表示する' },
      { cmd: 'hiyori sub add', use: '確定予定をまとめて配信する webcal 購読 URL を発行する' },
      { cmd: 'hiyori sub rm <id>', destructive: true, use: 'カレンダー購読を削除する（--yes）。既存の webcal URL は無効に' },
      { cmd: 'hiyori sub regen <id>', destructive: true, use: '購読トークンを再生成する。旧 URL は無効になり新 URL を発行' },
    ],
  },
]

function CommandTable() {
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 24 }}>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-fg1)', marginBottom: 6 }}>
            {g.title}
          </div>
          <div className="hy-table-wrap">
            <table className="hy-table">
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.cmd}>
                    <td className="hy-cmd">
                      <code>{r.cmd}</code>
                    </td>
                    <td className="hy-use">
                      {r.destructive && (
                        <span
                          title="取り消せない破壊的操作"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            marginRight: 6,
                            color: 'var(--color-danger, #d64545)',
                            fontSize: 11.5,
                            fontWeight: 700,
                            verticalAlign: 'middle',
                          }}
                        >
                          <Icon name="alert-circle" size={13} color="var(--color-danger, #d64545)" />
                          破壊的
                        </span>
                      )}
                      {r.use}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

export function CliGuidePage() {
  const navigate = useNavigate()
  const { data: mcpStatus } = useMcpStatus()

  return (
    <div>
      <GuideStyles />
      <AppHeader back={{ onClick: () => navigate(-1) }} />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="chevron-right" size={26} color="var(--color-blurple)" />
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(24px, 5vw, 32px)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--color-fg1)',
            }}
          >
            CLI（コマンドライン）ガイド
          </h1>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
          <Code>hiyori</Code> コマンドを使うと、ターミナルから直接 Hiyori を操作できます。
          スクリプトへの組み込みや自動化、キーボードで完結させたいパワーユーザー向けです。
        </p>

        <Section title="これは何？ — MCP との棲み分け">
          <p style={{ margin: 0 }}>
            Hiyori には 2 つの外部連携の入口があります。用途で選んでください。
          </p>
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                CLI（このページ）— 端末から操作する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                エンジニア向け。<Code>hiyori</Code> コマンドを明示的に叩き、スクリプトや CI に組み込めます。
                すべてのコマンドは <Code>--json</Code> で機械可読な出力にできます。
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                MCP — AI アシスタントから操作する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                Claude などの AI に自然文で頼むだけ。技術知識は不要です。
                {mcpStatus?.enabled ? (
                  <>
                    {' '}
                    詳しくは{' '}
                    <Link to="/help/mcp" style={{ color: 'var(--color-blurple-ink)', fontWeight: 600 }}>
                      AI との連携（MCP 接続ガイド）
                    </Link>
                    {' '}へ。
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </Section>

        <Section title="インストール">
          <p style={{ margin: 0 }}>
            Node.js 22.12 以上が必要です。npm でグローバルインストールします（公開済み・v0.1.0）。
          </p>
          <CommandBlock lines={['npm i -g hiyori-cli']} />
        </Section>

        <Section title="初期設定（最初に必ず）">
          <p style={{ margin: 0 }}>
            CLI の既定の接続先はプレースホルダーのため、<strong>最初に接続先の設定とログインが必要</strong>です。
            この 2 つを行わないと <Code>fetch failed</Code> などの接続エラーになります。
          </p>
          <Steps
            items={[
              {
                label: '接続先（api-url）を設定する',
                desc: (
                  <>
                    本番の Hiyori を使う場合:
                    <CommandBlock lines={[`hiyori config set api-url ${PROD_HOST}`]} />
                    <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--color-fg3)' }}>
                      セルフホストの場合は <Code>https://（あなたの Hiyori の URL）</Code> を指定します。
                    </div>
                  </>
                ),
              },
              {
                label: 'ログインする',
                desc: (
                  <>
                    デバイスコード（RFC 8628）フローでブラウザが開き、Discord で承認するとログイン完了です。
                    <CommandBlock lines={['hiyori login']} />
                  </>
                ),
              },
              {
                label: '動作確認',
                desc: (
                  <>
                    ログインできたか確認します。
                    <CommandBlock lines={['hiyori whoami']} />
                  </>
                ),
              },
            ]}
          />
        </Section>

        <Section title="主なコマンド">
          <p style={{ margin: '0 0 4px' }}>
            すべてのコマンドは <Code>--json</Code> を付けると機械可読な JSON を出力します。
            <span style={{ color: 'var(--color-danger, #d64545)', fontWeight: 600 }}> 破壊的</span>{' '}
            と書かれたものは取り消せない削除・解除操作です（<Code>--yes</Code> で確認を省略できます）。
          </p>
          <CommandTable />
        </Section>

        <Section title="接続先と認証情報">
          <p style={{ margin: '0 0 8px' }}>
            接続先（api-url）は、次の優先順位で解決されます。上にあるものが優先されます。
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
            <li>
              <Code>--api-url &lt;url&gt;</Code> フラグ
            </li>
            <li>
              環境変数 <Code>HIYORI_API_URL</Code>
            </li>
            <li>
              <Code>hiyori config set api-url &lt;url&gt;</Code> で保存した設定
            </li>
            <li>組み込みの既定値（プレースホルダー・そのままでは使えません）</li>
          </ol>
          <Note>
            設定・認証情報は <Code>~/.config/hiyori</Code>（<Code>XDG_CONFIG_HOME</Code> があればそちら）に保存されます。
            <Code>config.json</Code> は非機密の設定、<Code>credentials.json</Code> はセッショントークン
            （ファイルモード 600・接続先ごとに分離・期限切れは無視）です。
          </Note>
        </Section>

        <Section title="うまくいかないときは">
          <div style={{ display: 'grid', gap: 16 }}>
            {[
              {
                q: 'fetch failed / 接続できない と出ます',
                a: 'api-url が未設定（プレースホルダーのまま）の可能性が高いです。hiyori config set api-url https://hiyori-schedule.com（またはあなたの Hiyori の URL）を実行してから、もう一度お試しください。',
              },
              {
                q: '「hiyori login を実行してください」と出ます',
                a: '未ログイン、またはトークンの期限切れ・接続先の変更です。hiyori login で再度ログインしてください。認証情報は接続先（api-url）ごとに分かれています。',
              },
              {
                q: 'コマンドの詳しいオプションを知りたい',
                a: 'hiyori --help、または各コマンドに --help を付けると使い方が表示されます（例: hiyori event create --help）。',
              },
            ].map(({ q, a }, i) => (
              <div key={i}>
                <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                  Q. {q}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>A. {a}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="フィードバック・不具合報告">
          <p style={{ margin: '0 0 12px' }}>
            使ってみて気づいた点や不具合があれば、ぜひお知らせください。ログイン不要で送れます。
          </p>
          <FeedbackButton variant="link" />
        </Section>
      </main>
    </div>
  )
}
