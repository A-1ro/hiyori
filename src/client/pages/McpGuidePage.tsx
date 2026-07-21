import { useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { Icon } from '../components/primitives'
import { FeedbackButton } from '../components/FeedbackButton'
import { useMcpStatus } from '../auth/useMcpStatus'

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

function ScopeCard({
  name,
  title,
  desc,
}: {
  name: string
  title: string
  desc: ReactNode
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--separator)',
        background: 'var(--color-surface-raised, #f7f7f8)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <code
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--color-blurple-ink)',
          }}
        >
          {name}
        </code>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg1)' }}>{title}</span>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-fg2)' }}>{desc}</div>
    </div>
  )
}

// agent.ts の登録順・区分・破壊性に忠実な全 19 ツール。
type Tool = {
  name: string
  scope: 'read' | 'write'
  destructive?: boolean
  use: string
}

const TOOLS: Tool[] = [
  { name: 'hiyori_whoami', scope: 'read', use: '接続中のあなた（Discord ユーザー）の情報を返す。認証確認に使う' },
  { name: 'hiyori_list_events', scope: 'read', use: '主催・参加しているイベントの一覧を返す' },
  { name: 'hiyori_get_event', scope: 'read', use: 'イベント 1 件の詳細（候補日時・あなたが主催者か）を返す' },
  { name: 'hiyori_tally', scope: 'read', use: '投票の集計（候補ごとの ○△× 表・確定状況）を返す' },
  { name: 'hiyori_get_my_votes', scope: 'read', use: '指定イベントでのあなた自身の投票を返す' },
  { name: 'hiyori_get_ics', scope: 'read', use: '確定済みイベントの .ics（iCalendar）本文を返す' },
  { name: 'hiyori_my_busy', scope: 'read', use: 'あなたの確定済み予定の一覧（埋まっている日）を返す' },
  { name: 'hiyori_list_subscriptions', scope: 'read', use: 'あなたのカレンダー購読（webcal）の一覧を返す' },
  { name: 'hiyori_create_event', scope: 'write', use: '日程調整イベントを新規作成する（作成者＝主催者）。共有 URL を返す' },
  { name: 'hiyori_vote', scope: 'write', use: 'あなた自身として投票する（未参加なら自動で参加登録）' },
  { name: 'hiyori_confirm', scope: 'write', use: '主催者としてイベントの開催日を確定する（.ics 配布が有効に）' },
  { name: 'hiyori_edit_event', scope: 'write', use: 'イベントの基本情報（タイトル・説明・締切など）を編集する。主催者のみ' },
  { name: 'hiyori_add_candidate', scope: 'write', use: '既存イベントに候補日時を 1 件追加する。主催者のみ' },
  { name: 'hiyori_add_subscription', scope: 'write', use: 'あなたの確定予定をまとめて配信する webcal 購読 URL を発行する' },
  { name: 'hiyori_delete_event', scope: 'write', destructive: true, use: 'イベントを完全に削除する（候補・投票・参加者も一括）。主催者のみ・取り消せない' },
  { name: 'hiyori_remove_candidate', scope: 'write', destructive: true, use: '候補日時を 1 件削除する（その候補への投票も削除）。主催者のみ・取り消せない' },
  { name: 'hiyori_unconfirm', scope: 'write', destructive: true, use: '確定済みの開催日をすべて取り消す。主催者のみ・.ics 配布は無効に' },
  { name: 'hiyori_remove_subscription', scope: 'write', destructive: true, use: 'カレンダー購読を削除する（本人のみ）。既存の webcal URL は無効に' },
  { name: 'hiyori_regen_subscription', scope: 'write', destructive: true, use: '購読トークンを再生成する（本人のみ）。旧 URL は無効になり新 URL を返す' },
]

function ScopeBadge({ scope }: { scope: 'read' | 'write' }) {
  const isRead = scope === 'read'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        color: isRead ? 'var(--color-blurple-ink)' : '#fff',
        background: isRead ? 'var(--color-surface-raised, #eef0ff)' : 'var(--color-blurple)',
        border: isRead ? '1px solid var(--separator)' : 'none',
      }}
    >
      {isRead ? 'read' : 'write'}
    </span>
  )
}

function ToolTable() {
  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 520 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--color-fg3)' }}>
            <th style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--separator)' }}>
              ツール名
            </th>
            <th style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--separator)', whiteSpace: 'nowrap' }}>
              区分
            </th>
            <th style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--separator)' }}>
              用途
            </th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map((t) => (
            <tr key={t.name}>
              <td
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--separator)',
                  verticalAlign: 'top',
                }}
              >
                <code style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--color-fg1)' }}>
                  {t.name}
                </code>
              </td>
              <td
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--separator)',
                  verticalAlign: 'top',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <ScopeBadge scope={t.scope} />
                  {t.destructive && (
                    <span
                      title="取り消せない破壊的操作"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        color: 'var(--color-danger, #d64545)',
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                    >
                      <Icon name="alert-circle" size={13} color="var(--color-danger, #d64545)" />
                      破壊的
                    </span>
                  )}
                </span>
              </td>
              <td
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--separator)',
                  color: 'var(--color-fg2)',
                  lineHeight: 1.6,
                }}
              >
                {t.use}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function McpGuidePage() {
  const navigate = useNavigate()
  const { data: mcpStatus } = useMcpStatus()
  const enabled = mcpStatus?.enabled ?? false

  return (
    <div>
      <AppHeader back={{ onClick: () => navigate(-1) }} />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 96px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="sparkles" size={26} color="var(--color-blurple)" />
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(24px, 5vw, 32px)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--color-fg1)',
            }}
          >
            AI との連携（MCP 接続ガイド）
          </h1>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
          Claude などの AI アシスタントを Hiyori につなぐと、チャットで話しかけるだけで日程調整を任せられます。
          「来週の飲み会の日程、候補 3 つで作って URL ちょうだい」——そんな依頼を AI が Hiyori の操作に翻訳して実行します。
        </p>

        {!enabled && (
          <Note>
            <strong>この Hiyori では MCP 連携はまだ有効化されていません（準備中）。</strong>{' '}
            公開されると、下記の手順でお使いの AI アシスタントから接続できるようになります。
            セルフホストの場合は、末尾の「セルフホスト時の設定」をご覧ください。
          </Note>
        )}

        <Section title="これは何？ — CLI との棲み分け">
          <p style={{ margin: 0 }}>
            MCP（Model Context Protocol）は、AI アシスタントに外部ツールをつなぐための共通規格です。
            Hiyori は MCP サーバーを備えているので、対応する AI クライアント（Claude など）から
            Hiyori のイベント作成・投票・確定・カレンダー連携を直接呼び出せます。
          </p>
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                MCP（このページ）— AI から操作する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                AI アシスタントに自然文で頼むだけ。技術知識は不要で、AI が適切なツールを選んで実行します。
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                CLI（<Code>hiyori</Code> コマンド）— 端末から操作する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                エンジニア向け。スクリプトやターミナルから明示的にコマンドを叩きたい人はこちら。
              </div>
            </div>
          </div>
        </Section>

        <Section title="接続する">
          <p style={{ margin: '0 0 4px' }}>
            お使いの MCP 対応クライアントに、Hiyori の MCP エンドポイント URL を追加します。
          </p>
          <Steps
            items={[
              {
                label: 'MCP エンドポイント URL を登録する',
                desc: (
                  <>
                    AI クライアントの MCP サーバー設定に、Hiyori のエンドポイントを追加します。
                    <div style={{ marginTop: 8 }}>
                      <Code>{`${PROD_HOST}/mcp`}</Code>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--color-fg3)' }}>
                      セルフホストの場合は <Code>https://（あなたの Hiyori の URL）/mcp</Code> を指定します。
                    </div>
                  </>
                ),
              },
              {
                label: 'Discord でログインする',
                desc: '接続時にブラウザが開き、Hiyori の既存の Web ログイン（Discord）で本人確認します。新しいアカウントは不要で、いつもの Hiyori アカウントがそのまま使われます。',
              },
              {
                label: '許可する範囲（スコープ）を選ぶ',
                desc: (
                  <>
                    同意画面で、AI に許可する操作範囲を選びます。必要なぶんだけチェックしてください。
                    <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                      <ScopeCard
                        name="hiyori:read"
                        title="読み取り"
                        desc="イベント一覧・詳細・集計・自分の投票・確定予定・カレンダー購読の閲覧。データを変更しません。"
                      />
                      <ScopeCard
                        name="hiyori:write"
                        title="書き込み"
                        desc="イベントの作成・編集・投票・確定、候補や購読の追加・削除など。データを変更します。"
                      />
                    </div>
                  </>
                ),
              },
              {
                label: '接続完了。あとは AI に頼むだけ',
                desc: '許可すると接続が完了し、以降 AI は選んだ範囲で Hiyori を操作できます。接続はいつでも解除・失効できます。',
              },
            ]}
          />
          <Note>
            スコープを指定せずに接続した場合は、安全側に倒して <Code>hiyori:read</Code>（読み取りのみ）が既定になります。
            綴り間違いなど無効なスコープだけを要求した接続は拒否されます。
          </Note>
        </Section>

        <Section title="使えるツール一覧（全 19 種）">
          <p style={{ margin: '0 0 4px' }}>
            接続後、AI が呼び出せる Hiyori のツールです。<ScopeBadge scope="read" /> は閲覧のみ、
            <ScopeBadge scope="write" /> はデータを変更します。
            <span style={{ color: 'var(--color-danger, #d64545)', fontWeight: 600 }}> 破壊的</span>{' '}
            と書かれたものは取り消せない削除・解除操作です。
          </p>
          <ToolTable />
          <Note>
            すべての操作は、Hiyori 本体と同じ権限チェック（主催者のみが確定・削除できる、など）を通ります。
            AI 経由だからといって余分な権限が与えられることはありません。
          </Note>
        </Section>

        <Section title="プライバシーと安全">
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
            <li>AI に渡るのは、あなたが同意画面で許可したスコープの範囲だけです。</li>
            <li>
              書き込みを許可していなければ、AI はイベントの作成・変更・削除を一切できません（読み取りのみ）。
            </li>
            <li>接続はいつでも解除でき、失効させれば発行済みのアクセスは無効になります。</li>
            <li>
              確定日の確定・イベントの削除など重要な操作は、通常どおり主催者本人（＝あなた）の権限内でのみ実行されます。
            </li>
          </ul>
        </Section>

        <Section title="セルフホスト時の設定">
          <p style={{ margin: 0 }}>
            Hiyori は OSS です。自分の Cloudflare アカウントで動かしているインスタンスでも MCP 連携を使えますが、
            既定ではオフになっています。有効化するには次の 2 つが必要です。
          </p>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                1. MCP を有効化する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                <Code>wrangler.jsonc</Code> の <Code>vars.MCP_ENABLED</Code> を <Code>"true"</Code>{' '}
                にします（既定は <Code>"false"</Code> で <Code>/mcp</Code> は 404）。
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                2. OAuth 用の KV を作成する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                <Code>wrangler kv namespace create OAUTH_KV</Code> を実行し、返ってきた id を{' '}
                <Code>wrangler.jsonc</Code> の <Code>OAUTH_KV</Code> バインディングに貼り付けます
                （D1 の <Code>database_id</Code> と同じ「自分の id を貼る」操作です）。
              </div>
            </div>
          </div>
          <Note>
            詳しい手順は、リポジトリの <Code>CLAUDE.md</Code> と企画書{' '}
            <Code>docs/plans/2026-07-21-mcp-server.md</Code>（§7 セルフホスト）を参照してください。
          </Note>
        </Section>

        <Section title="うまくいかないときは">
          <div style={{ display: 'grid', gap: 16 }}>
            {[
              {
                q: '接続時にログイン画面が出ません / 認証に失敗します',
                a: 'Hiyori に一度ブラウザで Discord ログインしてから、あらためて接続してください。MCP の同意画面は既存の Web ログインを再利用します。',
              },
              {
                q: 'AI が「権限がない」と言います',
                a: '接続時に許可したスコープを確認してください。書き込み操作には hiyori:write の許可が必要です。読み取りのみで接続した場合は、write を許可して接続し直します。',
              },
              {
                q: 'エンドポイントに繋がりません（404 など）',
                a: 'そのインスタンスで MCP がまだ有効化されていない可能性があります。セルフホストの場合は上記「セルフホスト時の設定」を確認してください。',
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
            接続でつまずいた点や気づいたことがあれば、ぜひお知らせください。ログイン不要で送れます。
          </p>
          <FeedbackButton variant="link" />
        </Section>
      </main>
    </div>
  )
}
