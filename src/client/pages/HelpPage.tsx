import { Link, useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { DiscordMark, Icon } from '../components/primitives'
import { AiGuideIntro } from '../components/AiGuideIntro'
import { FeedbackButton } from '../components/FeedbackButton'
import { useMcpStatus } from '../auth/useMcpStatus'
import { DISCORD_BOT_INVITE_LABEL, DISCORD_BOT_INVITE_URL } from '../lib/discord'
import { DEVELOPMENT_SUPPORT_URL, GITHUB_REPOSITORY_URL } from '../lib/project'

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 40, scrollMarginTop: 84 }}>
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
      <div style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
        {children}
      </div>
    </section>
  )
}

function GuideNavigation() {
  const items = [
    { href: '#basics', label: '基本の使い方', desc: '作成・回答・カレンダー' },
    { href: '#discord', label: 'Discord Bot', desc: 'サーバーへの追加・通知' },
    { href: '#cli', label: 'CLI', desc: 'コマンドラインから使う' },
    { href: '#support', label: '開発・サポート', desc: 'ソースコード・開発支援' },
  ]
  return (
    <nav
      aria-label="使い方ページ内の案内"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 10,
        marginTop: 24,
      }}
    >
      {items.map(({ href, label, desc }) => (
        <a
          key={href}
          href={href}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '14px 16px',
            textDecoration: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
            background: 'var(--color-surface)',
            minWidth: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg1)' }}>{label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-fg2)', lineHeight: 1.65, marginTop: 3 }}>
              {desc}
            </div>
          </div>
          <span aria-hidden="true" style={{ color: 'var(--color-fg3)' }}>↓</span>
        </a>
      ))}
    </nav>
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

export function HelpPage() {
  const navigate = useNavigate()
  const { data: mcpStatus } = useMcpStatus()
  return (
    <div>
      <AppHeader back={{ onClick: () => navigate(-1) }} />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 96px' }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'clamp(24px, 5vw, 32px)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          使い方ガイド
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
          Hiyori は Discord と連携した日程調整ツールです。候補日の収集から確定・通知・カレンダー追加まで、
          一気通貫で行えます。
        </p>

        {mcpStatus?.enabled && <AiGuideIntro />}
        <GuideNavigation />

        <Section id="basics" title="基本の流れ">
          <Steps
            items={[
              {
                label: 'イベントを作成する',
                desc: (
                  <>
                    Discord で <Code>/hiyori new</Code> を実行するか、Web から「イベントを作る」ボタンを押します。
                    タイトル・候補日時・締切を入力して作成します。
                  </>
                ),
              },
              {
                label: '参加者に URL を共有する',
                desc: 'イベントページのリンクをコピーして、日程を聞きたいメンバーに送ります。',
              },
              {
                label: '参加者が回答する',
                desc: (
                  <>
                    各参加者が候補枠に <strong>○ / △ / ×</strong> で回答します。
                    Discord アカウントなしでもゲストとして参加できます。
                  </>
                ),
              },
              {
                label: 'オーガナイザーが日程を確定する',
                desc: '集計画面で全員の回答を確認し、最適な候補枠を選んで確定します。',
              },
              {
                label: 'Discord に通知・カレンダーに追加',
                desc: 'Discord 連携している場合、確定と同時に指定チャンネルへ通知が届きます。参加者は通知からカレンダーに 1 タップで予定を追加できます。',
              },
            ]}
          />
        </Section>

        <Section id="discord" title="Discord Bot の使い方">
          <p style={{ margin: 0 }}>
            Hiyori Bot をサーバーに招待すると、Discord 上から直接イベントを作成してチャンネルに紐付けられます。
          </p>

          <div style={{ marginTop: 20, display: 'grid', gap: 20 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 6 }}>
                /hiyori new — イベントを作成する
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                コマンドを実行したチャンネルにイベントが紐付けられます。確定時にそのチャンネルへ通知が届きます。
              </div>
              <Note>
                コマンドを実行できるのは、そのチャンネルへのアクセス権限を持つメンバーのみです。
                権限のないチャンネルへ通知を送ることはできません。
              </Note>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 6 }}>
              Bot をサーバーに招待するには
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
              サーバー管理者が以下の手順で Hiyori Bot を招待してください。
            </p>
            <a
              href={DISCORD_BOT_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${DISCORD_BOT_INVITE_LABEL}（別タブで開きます）`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--color-blurple-ink)',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                minHeight: 44,
                marginBottom: 12,
              }}
            >
              <DiscordMark size={16} color="var(--color-blurple)" />
              {DISCORD_BOT_INVITE_LABEL} <span aria-hidden="true">↗</span>
            </a>
            <Steps
              items={[
                {
                  label: 'Bot 招待リンクを開く',
                  desc: '「Hiyori Bot をサーバーに招待」から Discord の認証画面を開きます。',
                },
                {
                  label: '招待先サーバーを選ぶ',
                  desc: 'Discord の認証画面でサーバーを選択し「認証」を押します。Bot の追加には「サーバー管理」権限が必要です。',
                },
                {
                  label: 'スラッシュコマンドを使う',
                  desc: (
                    <>
                      招待が完了すると <Code>/hiyori new</Code> が使えるようになります。
                      コマンドが表示されない場合はDiscord を再起動してみてください。
                    </>
                  ),
                },
              ]}
            />
          </div>
        </Section>

        <Section title="ゲストとして参加する">
          <p style={{ margin: '0 0 8px' }}>
            Discord アカウントがなくても、表示名を入力するだけでイベントに回答できます。
          </p>
          <Steps
            items={[
              {
                label: '共有リンクを開く',
                desc: 'オーガナイザーから受け取った URL をブラウザで開きます。',
              },
              {
                label: '「ゲストとして回答する」を選ぶ',
                desc: 'ログインしなくても、表示名を入力して回答できます。',
              },
              {
                label: '候補日時に回答する',
                desc: '各候補枠に ○ / △ / × で回答し、送信します。同じブラウザからであれば後から修正できます。',
              },
            ]}
          />
        </Section>

        <Section title="カレンダーに追加する">
          <p style={{ margin: '0 0 8px' }}>
            日程が確定すると、イベントページから Apple Calendar などのカレンダーアプリに追加できます。
          </p>
          <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                .ics ダウンロード
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                確定したイベントページの「カレンダーに追加」ボタンから .ics ファイルをダウンロードして、
                カレンダーアプリに読み込めます。
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                Webcal 購読（ログイン済みユーザーのみ）
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                マイページから Webcal 購読 URL を取得すると、参加または主催する公開イベントの有効な確定日がカレンダーに反映されます。
                主催者は候補日への回答不要です。招待限定と取消済みは含まれません。
                発行済み URL に今後の確定日も反映され、反映時期はカレンダーアプリの更新間隔によります。
              </div>
            </div>
          </div>
        </Section>

        <Section title="よくある質問">
          <div style={{ display: 'grid', gap: 20 }}>
            {[
              {
                q: 'Discord にログインしないとイベントを作れませんか？',
                a: 'イベントの作成・確定はオーガナイザーとして Discord ログインが必要です。投票・回答はゲストでも行えます。',
              },
              {
                q: '/hiyori new コマンドが表示されません',
                a: 'Bot がサーバーに招待されているかサーバー管理者に確認してください。招待直後は Discord の再起動が必要な場合があります。',
              },
              {
                q: 'Discord の通知が届きません',
                a: 'イベント作成時に /hiyori new コマンドを使ってチャンネルを紐付けている必要があります。Web から作成したイベントは Discord 通知が届きません。',
              },
              {
                q: '候補日を後から追加・変更できますか？',
                a: 'オーガナイザーはイベントの編集ページから候補日時を変更できます。ただし、すでに回答済みの参加者は再度回答が必要になる場合があります。',
              },
            ].map(({ q, a }, i) => (
              <div key={i}>
                <div style={{ fontWeight: 600, color: 'var(--color-fg1)', marginBottom: 4 }}>
                  Q. {q}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-fg2)' }}>
                  A. {a}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="cli" title="ターミナルから使う（CLI）">
          <p style={{ margin: '0 0 12px' }}>
            <Code>hiyori</Code> コマンドで、ターミナルから直接 Hiyori を操作できます（自動化・スクリプト・パワーユーザー向け）。
            インストール・初期設定・コマンド一覧は専用ガイドにまとめています。
          </p>
          <Link
            to="/help/cli"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-blurple-ink)',
              textDecoration: 'none',
            }}
          >
            <Icon name="chevron-right" size={16} color="var(--color-blurple)" />
            CLI（コマンドライン）ガイドを見る
            <Icon name="arrow-right" size={15} />
          </Link>
        </Section>

        <Section title="フィードバック・不具合報告">
          <p style={{ margin: '0 0 12px' }}>
            使ってみて気づいた点や不具合があれば、ぜひお知らせください。ログイン不要で送れます
            （送信時に、見ているページの情報を一緒に添付します）。
          </p>
          <FeedbackButton variant="link" />
        </Section>
        <section
          id="support"
          style={{
            marginTop: 40,
            paddingTop: 24,
            scrollMarginTop: 84,
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
            開発・サポート
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
            Hiyori はソースコードを公開しています。開発への参加や、ご支援はこちらから。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 24px', marginTop: 10, fontSize: 14 }}>
            {[
              { href: GITHUB_REPOSITORY_URL, label: 'GitHub でソースコードを見る' },
              { href: DEVELOPMENT_SUPPORT_URL, label: '開発を支援する' },
            ].map(({ href, label }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${label}（別タブで開きます）`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  minHeight: 44,
                  color: 'var(--color-fg2)',
                  textDecoration: 'none',
                }}
              >
                {label} <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
