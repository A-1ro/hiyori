import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  fetchEvent,
  fetchTally,
  deleteEvent,
  createSubscription,
  ApiError,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Badge, Button, DiscordMark, Icon } from '../components/primitives'
import { DISCORD_BOT_INVITE_URL, DISCORD_BOT_INVITE_LABEL } from '../lib/discord'

const WD = ['日', '月', '火', '水', '木', '金', '土']

function partsOf(iso: string) {
  const dt = new Date(iso)
  return {
    md: `${dt.getMonth() + 1}/${dt.getDate()}`,
    hm: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
    wd: dt.getDay(),
  }
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [subError, setSubError] = useState<string | undefined>()

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', id],
    queryFn: () => fetchEvent(id!),
    enabled: !!id,
  })

  const { data: tallyData } = useQuery({
    queryKey: ['tally', id],
    queryFn: () => fetchTally(id!),
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(id!),
    onSuccess: () => navigate('/'),
  })

  const subUrl = typeof window !== 'undefined' ? window.location.href : ''

  const decidedCandidates = useMemo(() => {
    const decisions = tallyData?.decisions ?? []
    if (decisions.length === 0 || !data) return []
    const byId = new Map(data.candidates.map((c) => [c.id, c]))
    return decisions
      .map((d) => byId.get(d.candidateId))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
  }, [data, tallyData])

  if (isLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-no-ink)' }}>
            {error instanceof ApiError && error.status === 404
              ? 'イベントが見つかりません。'
              : 'エラーが発生しました。'}
          </p>
          <Button variant="ghost" onClick={() => navigate('/')} style={{ marginTop: 16 }}>
            ホームへ
          </Button>
        </main>
      </div>
    )
  }

  const { event } = data
  const isClosed = event.status === 'closed'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(subUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard unavailable
    }
  }

  const handleSubscribe = async () => {
    setSubError(undefined)
    try {
      const { webcalUrl } = await createSubscription()
      window.location.href = webcalUrl
    } catch (e) {
      setSubError(
        e instanceof ApiError && e.status === 401
          ? '購読には Discord ログインが必要です'
          : '購読の作成に失敗しました',
      )
    }
  }

  const handleDelete = () => {
    if (!confirm('このイベントを削除しますか？参加者の回答もすべて消えます。')) return
    deleteMutation.mutate()
  }

  // -----------------------------------------------------------------
  // Closed → ConfirmedScreen-style (1件 or 複数件)
  // -----------------------------------------------------------------
  if (isClosed && decidedCandidates.length > 0) {
    const multi = decidedCandidates.length > 1
    const formatted = decidedCandidates.map((c) => {
      const p = partsOf(c.startAt)
      const e = partsOf(c.endAt)
      return { id: c.id, p, range: `${p.hm}–${e.hm}` }
    })
    const first = formatted[0]!
    return (
      <div>
        <AppHeader
          right={
            <Badge tone="confirmed" dot>
              確定済み{multi ? ` ${formatted.length}件` : ''}
            </Badge>
          }
        />
        <main style={{ maxWidth: 560, margin: '0 auto', padding: '44px 24px 80px' }}>
          <div style={{ textAlign: 'center', marginBottom: 30 }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'var(--color-yes-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 18px',
              }}
            >
              <Icon name="check" size={30} color="var(--color-yes-ink)" />
            </div>
            <h2
              style={{
                margin: '0 0 6px',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--color-fg1)',
              }}
            >
              {multi ? `${formatted.length}件の日程が確定しました` : '日程が確定しました'}
            </h2>
            {!multi ? (
              <>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    color: 'var(--color-fg1)',
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 10,
                  }}
                >
                  {first.p.md}
                  <span style={{ fontSize: 18, color: 'var(--color-fg3)', marginLeft: 6 }}>
                    {WD[first.p.wd]}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: 'var(--color-fg2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {first.range}
                </div>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 16,
                  textAlign: 'left',
                }}
              >
                {formatted.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 16px',
                      boxShadow: 'var(--shadow-xs)',
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: 'var(--color-yes-soft)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 'none',
                      }}
                    >
                      <Icon name="check" size={15} color="var(--color-yes-ink)" />
                    </div>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: 'var(--color-fg1)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {f.p.md}
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--color-fg3)',
                          margin: '0 8px 0 6px',
                        }}
                      >
                        {WD[f.p.wd]}
                      </span>
                      <span
                        style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg2)' }}
                      >
                        {f.range}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Discord message preview — only if a channel was configured */}
          {event.discordChannelId && (
            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden',
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '12px 16px 10px',
                  borderBottom: '1px solid var(--separator)',
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--color-blurple)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <DiscordMark size={15} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-fg1)' }}>
                  Hiyori
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#fff',
                    background: 'var(--color-blurple)',
                    padding: '1px 5px',
                    borderRadius: 4,
                  }}
                >
                  BOT
                </span>
                <span
                  style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-fg4)' }}
                >
                  channel
                </span>
              </div>
              <div style={{ padding: '14px 16px 16px' }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: 'var(--color-fg1)',
                    marginBottom: 5,
                  }}
                >
                  📅 {multi ? `日程が確定しました（${formatted.length}件）` : '日程が確定しました'}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--color-fg2)',
                    lineHeight: 1.55,
                    marginBottom: 13,
                  }}
                >
                  <b style={{ color: 'var(--color-fg1)' }}>{event.title}</b>
                  <br />
                  {formatted.map((f) => (
                    <span key={f.id}>
                      {f.p.md}（{WD[f.p.wd]}） {f.range}
                      <br />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Webcal subscribe */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-blue-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              <Icon name="calendar" size={20} color="var(--color-blue)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg1)' }}>
                Apple Calendar に自動で反映
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-fg3)' }}>
                Webcal を購読すると、次回以降の確定も自動で届きます
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleSubscribe}>
              購読
            </Button>
          </div>
          {subError && (
            <p
              style={{
                marginTop: 8,
                fontSize: 13,
                color: 'var(--color-no-ink)',
                textAlign: 'center',
              }}
            >
              {subError}
            </p>
          )}

          <div
            style={{
              marginTop: 30,
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Link to={`/events/${id}/tally`}>
              <Button variant="secondary" size="md" icon={<Icon name="users" size={16} />}>
                投票結果を見る
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigate('/')}
              icon={<Icon name="arrow-right" size={16} />}
            >
              ホームへ
            </Button>
          </div>
        </main>
      </div>
    )
  }

  // -----------------------------------------------------------------
  // Open → ShareScreen-style
  // -----------------------------------------------------------------
  return (
    <div>
      <AppHeader
        right={
          <Badge tone="open" dot>
            受付中
          </Badge>
        }
      />
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '56px 24px 80px' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--color-yes-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 22px',
            }}
          >
            <Icon name="check" size={32} color="var(--color-yes-ink)" />
          </div>
          <h2
            style={{
              margin: '0 0 8px',
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--color-fg1)',
            }}
          >
            {event.title}
          </h2>
          <p style={{ margin: '0 0 30px', fontSize: 15, color: 'var(--color-fg2)' }}>
            このリンクを仲間に共有して、回答を集めましょう。
          </p>
        </div>

        {event.description && (
          <p
            style={{
              margin: '-12px 0 24px',
              fontSize: 14,
              color: 'var(--color-fg2)',
              lineHeight: 1.6,
              textAlign: 'center',
            }}
          >
            {event.description}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 8px 8px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <Icon name="link" size={18} color="var(--color-fg4)" />
          <span
            style={{
              flex: 1,
              textAlign: 'left',
              fontSize: 14,
              color: 'var(--color-fg1)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subUrl}
          </span>
          <Button
            variant={copied ? 'secondary' : 'primary'}
            size="sm"
            onClick={handleCopy}
            icon={
              <Icon
                name={copied ? 'check' : 'copy'}
                size={15}
                color={copied ? 'var(--color-yes-ink)' : '#fff'}
              />
            }
          >
            {copied ? 'コピー済み' : 'コピー'}
          </Button>
        </div>

        {event.discordChannelId && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 16,
              background: 'var(--color-blurple-soft)',
              border: '1px solid var(--color-blurple-border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              textAlign: 'left',
            }}
          >
            <DiscordMark size={22} color="var(--color-blurple)" />
            <div style={{ flex: 1 }}>
              <div
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-blurple-ink)' }}
              >
                Discord チャンネルに調整リンクを投稿
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-blurple-ink)',
                  opacity: 0.8,
                }}
              >
                Bot がチャンネルに URL を共有します
              </div>
              <a
                href={DISCORD_BOT_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 6,
                  fontSize: 12,
                  color: 'var(--color-blurple)',
                  textDecoration: 'underline',
                }}
              >
                {DISCORD_BOT_INVITE_LABEL}
              </a>
            </div>
          </div>
        )}

        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link to={`/events/${id}/vote`} style={{ display: 'block' }}>
            <Button
              variant="secondary"
              size="lg"
              full
              iconRight={<Icon name="arrow-right" size={18} />}
            >
              自分も回答する
            </Button>
          </Link>
          <Link to={`/events/${id}/tally`} style={{ display: 'block' }}>
            <Button
              variant="ghost"
              size="md"
              full
              icon={<Icon name="users" size={16} />}
            >
              投票結果を見る
            </Button>
          </Link>
        </div>

        {/* Organizer actions — quiet row, only for those who can */}
        <div
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: '1px solid var(--separator)',
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Link to={`/events/${id}/edit`}>
            <Button variant="ghost" size="sm" icon={<Icon name="calendar" size={14} />}>
              編集
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSubscribe}
            icon={<Icon name="calendar" size={14} />}
          >
            Apple Calendar に購読
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            icon={<Icon name="trash" size={14} />}
          >
            削除
          </Button>
        </div>
        {subError && (
          <p
            style={{
              marginTop: 8,
              fontSize: 13,
              color: 'var(--color-no-ink)',
              textAlign: 'center',
            }}
          >
            {subError}
          </p>
        )}
      </main>
    </div>
  )
}
