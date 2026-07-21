import { useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { FeedbackButton } from '../components/FeedbackButton'

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
      <div style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
        {children}
      </div>
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

        <Section title="基本の流れ">
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

        <Section title="Discord Bot の使い方">
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
            <Steps
              items={[
                {
                  label: 'Bot 招待リンクを開く',
                  desc: 'サービスのトップページにある「Discord サーバーに追加」ボタンを押します。',
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
                マイページから Webcal 購読 URL を取得すると、今後確定するすべてのイベントが自動でカレンダーに反映されます。
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

        <Section title="フィードバック・不具合報告">
          <p style={{ margin: '0 0 12px' }}>
            使ってみて気づいた点や不具合があれば、ぜひお知らせください。ログイン不要で送れます
            （送信時に、見ているページの情報を一緒に添付します）。
          </p>
          <FeedbackButton variant="link" />
        </Section>
      </main>
    </div>
  )
}
