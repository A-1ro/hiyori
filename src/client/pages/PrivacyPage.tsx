import { useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'

const LAST_UPDATED = '2026年6月6日'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 32 }}>
      <h2
        style={{
          margin: '0 0 10px',
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--color-fg1)',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.8,
          color: 'var(--color-fg2)',
        }}
      >
        {children}
      </div>
    </section>
  )
}

function OrderedList({ items }: { items: ReactNode[] }) {
  return (
    <ol style={{ margin: '4px 0 0', paddingLeft: 22, display: 'grid', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  )
}

export function PrivacyPage() {
  const navigate = useNavigate()
  return (
    <div>
      <AppHeader back={{ onClick: () => navigate(-1) }} />
      <main
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '40px 24px 96px',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 'clamp(24px, 5vw, 32px)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          プライバシーポリシー
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-fg3)' }}>
          最終更新日: {LAST_UPDATED}
        </p>

        <p style={{ marginTop: 24, fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
          本プライバシーポリシー（以下「本ポリシー」）は、Hiyori（以下「本サービス」）における、利用者
          （以下「ユーザー」）の情報の取り扱いについて定めるものです。本サービスの運営者（以下「運営者」）は、
          本サービスの提供に必要な範囲で、以下のとおり情報を取得・利用します。
        </p>

        <Section title="1. 取得する情報">
          本サービスは、機能の提供に必要な範囲で次の情報を取得します。
          <OrderedList
            items={[
              <>
                <b>Discord アカウント情報</b> — Discord による OAuth2 ログインを行った場合、Discord から
                提供されるユーザー識別子、ユーザー名、表示名、アバター等の情報。
              </>,
              <>
                <b>ゲストの表示名</b> — ログインせず回答する場合に入力された表示名。完全な匿名での回答は
                できません。
              </>,
              <>
                <b>ユーザーが入力した情報</b> — イベント名、説明、候補日時、投票（○ / △ / ×）やコメント等の
                回答内容。
              </>,
              <>
                <b>認証・連携用のトークン</b> — セッションの識別、ゲスト回答の編集、カレンダー購読のために
                発行されるトークン。詳細は「5. セキュリティ」をご覧ください。
              </>,
              <>
                <b>技術的情報</b> — 本サービスの提供・保守のために、アクセスに伴う技術的なログ（リクエスト
                情報等）が記録される場合があります。
              </>,
            ]}
          />
        </Section>

        <Section title="2. 利用目的">
          取得した情報は、次の目的の範囲で利用します。
          <OrderedList
            items={[
              <>本サービス（日程調整、集計、確定、通知、カレンダー配信等）の提供のため</>,
              <>ユーザーの認証およびセッションの管理のため</>,
              <>確定した日程の Discord 通知およびカレンダー（.ics / Webcal）への反映のため</>,
              <>不正利用の防止、本サービスの保守・改善のため</>,
            ]}
          />
        </Section>

        <Section title="3. 第三者への提供">
          運営者は、次の場合を除き、ユーザーの同意なく取得した情報を第三者に提供しません。
          <OrderedList
            items={[
              <>法令に基づく場合</>,
              <>人の生命・身体または財産の保護のために必要で、本人の同意を得ることが困難な場合</>,
              <>本サービスの機能としてユーザー自身が情報の共有を選択した場合（例: 投票結果の他参加者への表示、確定日程の Discord チャンネルへの通知）</>,
            ]}
          />
        </Section>

        <Section title="4. 外部サービスの利用">
          本サービスは、提供にあたり次の外部サービスを利用します。各サービスにおける情報の取り扱いは、
          それぞれの提供事業者の定めに従います。
          <OrderedList
            items={[
              <>
                <b>Discord</b> — ログイン認証、確定日程等の通知に利用します。本サービスは Discord に
                対し、通知に必要な範囲でメッセージの送信を行います。
              </>,
              <>
                <b>Cloudflare</b> — 本サービスのホスティングおよびデータベース（D1）の基盤として利用します。
                取得した情報は当該基盤上に保存されます。
              </>,
            ]}
          />
        </Section>

        <Section title="5. セキュリティ">
          <OrderedList
            items={[
              <>セッションを識別するトークンは、ハッシュ化した値のみを保存し、生のトークンをデータベースに保存しません。</>,
              <>ゲスト回答の編集トークンやカレンダー購読トークン等の秘密情報は、外部に出力されない形（サーバー内部のみで扱う項目）として管理されます。</>,
              <>カレンダーの購読 URL は、これを知る者が予定の内容を閲覧できる可能性があるため、ユーザーの責任で管理してください。</>,
              <>運営者は、取得した情報の漏えい・滅失・毀損の防止その他の安全管理のために、合理的な措置を講じます。</>,
            ]}
          />
        </Section>

        <Section title="6. Cookie の利用">
          <OrderedList
            items={[
              <>本サービスは、ログイン状態（セッション）を維持するために Cookie を利用します。当該 Cookie は HttpOnly・Secure・SameSite 属性を付与し、一定期間で失効します。</>,
              <>OAuth ログインの過程で、安全性確保（CSRF 対策）のために一時的な Cookie を利用します。</>,
              <>ブラウザの設定により Cookie を無効化できますが、その場合、本サービスの一部機能が利用できないことがあります。</>,
            ]}
          />
        </Section>

        <Section title="7. 情報の保存期間と削除">
          <OrderedList
            items={[
              <>取得した情報は、本サービスの提供に必要な期間、または法令で定められた期間、保存します。</>,
              <>セッション情報は有効期限を過ぎると無効となります。</>,
              <>ユーザーが本サービス上でイベントや回答を削除した場合、当該情報は本サービスのデータベースから削除されます。</>,
            ]}
          />
        </Section>

        <Section title="8. ユーザーの権利">
          ユーザーは、自己に関する情報の開示、訂正、削除等を求めることができます。ご希望の場合は、
          「10. お問い合わせ」の窓口までご連絡ください。本人確認のうえ、法令に従い対応します。
        </Section>

        <Section title="9. 本ポリシーの変更">
          運営者は、必要に応じて本ポリシーを変更することがあります。変更後の本ポリシーは、本サービス上に
          表示した時点から効力を生じます。重要な変更を行う場合は、本サービス上で適切に告知します。
        </Section>

        <Section title="10. お問い合わせ">
          本ポリシーまたは本サービスにおける情報の取り扱いに関するお問い合わせは、運営者の定める窓口まで
          ご連絡ください。
        </Section>

        <p
          style={{
            marginTop: 40,
            paddingTop: 20,
            borderTop: '1px solid var(--color-border)',
            fontSize: 13,
            color: 'var(--color-fg3)',
          }}
        >
          以上
        </p>
      </main>
    </div>
  )
}
