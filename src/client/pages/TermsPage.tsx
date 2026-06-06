import { Link, useNavigate } from 'react-router'
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

export function TermsPage() {
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
          利用規約
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-fg3)' }}>
          最終更新日: {LAST_UPDATED}
        </p>

        <p style={{ marginTop: 24, fontSize: 15, lineHeight: 1.8, color: 'var(--color-fg2)' }}>
          この利用規約（以下「本規約」）は、Hiyori（以下「本サービス」）の利用条件を定めるものです。
          本サービスを利用される方（以下「ユーザー」）は、本規約に同意のうえご利用ください。本サービスを
          利用した時点で、本規約に同意したものとみなします。
        </p>

        <Section title="第1条（適用）">
          本規約は、ユーザーと本サービスの運営者（入口英一郎。以下「運営者」）との間の、本サービスの
          利用に関わる一切の関係に適用されます。運営者が本サービス上で別途定める個別規定やガイドラインは、
          本規約の一部を構成するものとします。
        </Section>

        <Section title="第2条（定義）">
          <OrderedList
            items={[
              <>「イベント」とは、ユーザーが候補日時を提示して参加可否を募る日程調整の単位をいいます。</>,
              <>「オーガナイザー」とは、イベントを作成し、日程の確定を行うユーザーをいいます。</>,
              <>「参加者」とは、イベントの候補日時に対して回答するユーザーをいいます。</>,
              <>「ゲスト」とは、Discord ログインを行わず、表示名のみを入力して回答する参加者をいいます。</>,
            ]}
          />
        </Section>

        <Section title="第3条（アカウントとログイン）">
          <OrderedList
            items={[
              <>本サービスは、認証手段として Discord による OAuth2 ログインを利用します。ログインにあたっては、Discord の利用規約その他の定めにも従うものとします。</>,
              <>ユーザーは、自己の責任において本サービスのログイン状態（セッション）を管理するものとします。</>,
              <>ログインによって取得した情報の利用範囲は、本サービスの提供および第11条に定めるデータの取り扱いの範囲に限られます。</>,
            ]}
          />
        </Section>

        <Section title="第4条（ゲストとしての利用）">
          <OrderedList
            items={[
              <>ゲストは、ログインを行わずに表示名を入力して回答できます。ただし、完全な匿名での回答はできません。</>,
              <>ゲストには回答を編集するためのトークンが発行され、同一ブラウザから自身の回答を編集できます。当該トークンの管理はゲスト自身の責任とします。</>,
              <>ゲストは、他者になりすます表示名や、第三者に不利益を与える表示名を使用してはなりません。</>,
            ]}
          />
        </Section>

        <Section title="第5条（Discord 連携）">
          <OrderedList
            items={[
              <>本サービスは、オーガナイザーの操作に基づき、指定された Discord チャンネルへ日程の確定等を通知することがあります。</>,
              <>通知先チャンネルの指定は、Discord 上の正規の手続き（スラッシュコマンド等）を通じて行われ、ユーザーが権限を持たないチャンネルへ通知することはできません。</>,
              <>Discord の仕様変更・障害・利用制限等により連携機能が利用できない場合があります。これらについて運営者は責任を負いません。</>,
            ]}
          />
        </Section>

        <Section title="第6条（カレンダー連携）">
          <OrderedList
            items={[
              <>本サービスは、確定した日程について iCalendar 形式（.ics）のファイル生成および Webcal 購読 URL の発行を行うことがあります。</>,
              <>購読 URL を第三者に共有した場合、当該 URL を知る者が予定の内容を閲覧できる可能性があります。URL の管理はユーザーの責任とします。</>,
              <>カレンダーアプリ側の仕様・反映タイミングについて、運営者はその正確性・即時性を保証しません。</>,
            ]}
          />
        </Section>

        <Section title="第7条（禁止事項）">
          ユーザーは、本サービスの利用にあたり、次の行為をしてはなりません。
          <OrderedList
            items={[
              <>法令または公序良俗に違反する行為</>,
              <>犯罪行為に関連する行為</>,
              <>運営者、他のユーザー、または第三者の権利・利益を侵害する行為</>,
              <>他者になりすます行為、虚偽の情報を登録する行為</>,
              <>本サービスのサーバーやネットワークに過度な負荷をかける行為、または不正にアクセスする行為</>,
              <>本サービスの運営を妨害する行為</>,
              <>スパム、無差別な通知の送信その他の迷惑行為</>,
              <>その他、運営者が不適切と判断する行為</>,
            ]}
          />
        </Section>

        <Section title="第8条（ユーザーが投稿するコンテンツ）">
          <OrderedList
            items={[
              <>ユーザーが本サービスに入力した情報（イベント名、説明、表示名、回答等）について、その内容に関する責任はユーザーが負うものとします。</>,
              <>ユーザーは、自らが入力する情報が第三者の権利を侵害しないことを保証するものとします。</>,
              <>運営者は、本規約に違反すると判断した情報を、事前の通知なく削除できるものとします。</>,
            ]}
          />
        </Section>

        <Section title="第9条（サービスの提供の停止等）">
          運営者は、次のいずれかに該当する場合、ユーザーへの事前通知なく本サービスの全部または一部の
          提供を停止・中断できるものとします。
          <OrderedList
            items={[
              <>システムの保守点検または更新を行う場合</>,
              <>地震・火災・停電等の不可抗力により提供が困難となった場合</>,
              <>Discord 等の外部サービスの障害・仕様変更により提供が困難となった場合</>,
              <>その他、運営者が提供の停止・中断を必要と判断した場合</>,
            ]}
          />
        </Section>

        <Section title="第10条（免責事項）">
          <OrderedList
            items={[
              <>本サービスは現状有姿で提供され、運営者は、本サービスの完全性・正確性・有用性・特定目的への適合性等について、明示・黙示を問わず保証しません。</>,
              <>本サービスの利用または利用不能により生じた損害について、運営者は、法令上許容される範囲で責任を負いません。</>,
              <>本サービスを通じた日程の確定・通知・カレンダー反映等は、運営者がその結果（参加者の実際の出席等）を保証するものではありません。</>,
            ]}
          />
        </Section>

        <Section title="第11条（データの取り扱い）">
          <OrderedList
            items={[
              <>本サービスは、機能の提供に必要な範囲で、Discord アカウント情報（識別子・表示名等）、ユーザーが入力した情報、および回答内容を取得・保存します。</>,
              <>運営者は、取得した情報を本サービスの提供・改善の目的の範囲で利用し、法令に基づく場合を除き、ユーザーの同意なく第三者に提供しません。</>,
              <>
                個人情報を含む情報の取り扱いの詳細は、
                <Link to="/privacy" style={{ color: 'var(--color-blurple-ink)' }}>
                  プライバシーポリシー
                </Link>
                に定めるものとします。
              </>,
            ]}
          />
        </Section>

        <Section title="第12条（本サービスの変更・終了）">
          運営者は、ユーザーへの事前の通知をもって（ただし緊急時はこの限りでない）、本サービスの内容を
          変更し、または提供を終了できるものとします。これによりユーザーに生じた損害について、運営者は
          責任を負いません。
        </Section>

        <Section title="第13条（利用規約の変更）">
          運営者は、必要と判断した場合、ユーザーに通知することなく本規約を変更できるものとします。変更後の
          本規約は、本サービス上に表示した時点から効力を生じ、変更後に本サービスを利用したユーザーは、変更
          後の本規約に同意したものとみなします。
        </Section>

        <Section title="第14条（準拠法）">
          本規約の解釈にあたっては、日本法を準拠法とします。
        </Section>

        <Section title="お問い合わせ">
          本規約または本サービスに関するお問い合わせは、下記までご連絡ください。
          <div style={{ marginTop: 8 }}>
            運営者: 入口英一郎
            <br />
            連絡先:{' '}
            <a
              href="mailto:eiichiro_iriguchi@a-1ro.dev"
              style={{ color: 'var(--color-blurple-ink)' }}
            >
              eiichiro_iriguchi@a-1ro.dev
            </a>
          </div>
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
