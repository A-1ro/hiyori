import { useState, useMemo, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  fetchTally,
  fetchMyVotes,
  type TallyCandidate,
  type TallyVoteCell,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button, Badge, Icon } from '../components/primitives'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const CHOICE_LABEL: Record<string, string> = { yes: '○', maybe: '△', no: '×' }
const CHOICE_COLOR: Record<string, string> = {
  yes: 'var(--color-yes-ink)',
  maybe: 'var(--color-maybe-ink)',
  no: 'var(--color-no-ink)',
}

type SortBy = 'startAt' | 'scoreDesc'

export function EventTallyPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [sortBy, setSortBy] = useState<SortBy>('startAt')

  const { data: tallyData, isLoading: tallyLoading } = useQuery({
    queryKey: ['tally', id],
    queryFn: () => fetchTally(id!),
    enabled: !!id,
  })

  const { data: myData } = useQuery({
    queryKey: ['myVotes', id],
    queryFn: () => fetchMyVotes(id!),
    enabled: !!id,
  })

  const myParticipantId = myData?.participant?.id ?? null

  // TODO(F-04/F-06): organizer 判定はサーバが boolean で返す設計にしてから確定ボタンを復活させる

  const sortedCandidates = useMemo<TallyCandidate[]>(() => {
    if (!tallyData) return []
    const arr = [...tallyData.candidates]
    if (sortBy === 'scoreDesc') {
      arr.sort((a, b) => b.totalScore - a.totalScore)
    } else {
      arr.sort((a, b) => a.startAt.localeCompare(b.startAt))
    }
    return arr
  }, [tallyData, sortBy])

  if (tallyLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (!tallyData) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-no-ink)' }}>イベントが見つかりません。</p>
          <Button variant="ghost" onClick={() => navigate('/')} style={{ marginTop: 16 }}>
            ホームへ
          </Button>
        </main>
      </div>
    )
  }

  const { event, participants } = tallyData
  const isClosed = event.status === 'closed'
  const decidedCandidateId = tallyData.decision?.candidateId ?? null

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `minmax(160px, 200px) repeat(${sortedCandidates.length}, minmax(72px, 1fr))`,
    overflow: 'auto',
    maxHeight: 'calc(100vh - 240px)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md, 12px)',
    background: 'var(--color-surface)',
  }

  const stickyCorner: CSSProperties = {
    position: 'sticky',
    top: 0,
    left: 0,
    zIndex: 3,
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    padding: '8px 10px',
    fontSize: 12,
    color: 'var(--color-fg3)',
    fontWeight: 600,
  }

  const stickyHeader: CSSProperties = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    padding: '8px 6px',
    fontSize: 12,
    textAlign: 'center' as const,
    fontWeight: 600,
    color: 'var(--color-fg1)',
  }

  const stickyScoreCorner: CSSProperties = {
    position: 'sticky',
    top: 38,
    left: 0,
    zIndex: 3,
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    padding: '6px 10px',
    fontSize: 12,
    color: 'var(--color-fg3)',
    fontWeight: 600,
  }

  const stickyScoreCell: CSSProperties = {
    position: 'sticky',
    top: 38,
    zIndex: 2,
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    padding: '6px',
    textAlign: 'center' as const,
    fontSize: 12,
  }

  const stickyNameCell: CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    padding: '8px 10px',
    fontSize: 13,
    color: 'var(--color-fg1)',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 200,
  }

  const dataCell: CSSProperties = {
    borderBottom: '1px solid var(--color-border)',
    padding: '8px 4px',
    textAlign: 'center' as const,
    fontSize: 18,
  }

  return (
    <div>
      <AppHeader
        right={
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevron-left" size={16} />}
            onClick={() => navigate(-1)}
          >
            戻る
          </Button>
        }
      />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--color-fg1)' }}>
            {event.title}
          </h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isClosed && <Badge tone="confirmed">確定済み</Badge>}
          </div>
        </div>

        {isClosed && decidedCandidateId && (() => {
          const decided = tallyData.candidates.find((c) => c.id === decidedCandidateId)
          if (!decided) return null
          return (
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-yes-ink)', fontWeight: 600 }}>
              確定日時: {formatDateTime(decided.startAt)} 〜 {formatDateTime(decided.endAt)}
            </p>
          )
        })()}

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 20,
            marginBottom: 16,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--color-fg3)' }}>並び替え:</span>
          <button
            type="button"
            onClick={() => setSortBy('startAt')}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${sortBy === 'startAt' ? 'var(--color-blurple)' : 'var(--color-border)'}`,
              background: sortBy === 'startAt' ? 'var(--color-blurple-soft)' : 'transparent',
              color: sortBy === 'startAt' ? 'var(--color-blurple-ink)' : 'var(--color-fg2)',
              fontWeight: sortBy === 'startAt' ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            開催順
          </button>
          <button
            type="button"
            onClick={() => setSortBy('scoreDesc')}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${sortBy === 'scoreDesc' ? 'var(--color-blurple)' : 'var(--color-border)'}`,
              background: sortBy === 'scoreDesc' ? 'var(--color-blurple-soft)' : 'transparent',
              color: sortBy === 'scoreDesc' ? 'var(--color-blurple-ink)' : 'var(--color-fg2)',
              fontWeight: sortBy === 'scoreDesc' ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            スコア順
          </button>
          <Badge tone="neutral">{participants.length} 名</Badge>
        </div>

        {sortedCandidates.length === 0 ? (
          <p style={{ color: 'var(--color-fg3)', fontSize: 14 }}>候補枠がありません。</p>
        ) : (
          <div style={gridStyle} role="grid">
            {/* 候補ヘッダ行: 左上コーナー */}
            <div style={stickyCorner} role="columnheader" />
            {sortedCandidates.map((cand) => {
              const isDecided = cand.id === decidedCandidateId
              return (
                <div
                  key={`header-${cand.id}`}
                  role="columnheader"
                  style={{
                    ...stickyHeader,
                    background: isDecided ? 'var(--color-yes-soft)' : 'var(--color-surface)',
                  }}
                >
                  {isDecided && '★ '}
                  {formatDateTime(cand.startAt)}
                </div>
              )
            })}

            {/* スコア行: 左上コーナー */}
            <div style={stickyScoreCorner} role="rowheader">
              スコア
            </div>
            {sortedCandidates.map((cand) => {
              const isDecided = cand.id === decidedCandidateId
              return (
                <div
                  key={`score-${cand.id}`}
                  role="gridcell"
                  style={{
                    ...stickyScoreCell,
                    background: isDecided ? 'var(--color-yes-soft)' : 'var(--color-surface)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-fg1)' }}>
                    {cand.totalScore}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-fg3)', marginTop: 2 }}>
                    ○{cand.counts.yes} △{cand.counts.maybe} ×{cand.counts.no}
                  </div>
                </div>
              )
            })}

            {/* 参加者行 */}
            {participants.map((participant) => {
              const isMe = participant.id === myParticipantId
              const rowBg = isMe ? 'var(--color-blurple-soft)' : undefined
              return (
                <div key={participant.id} role="row" style={{ display: 'contents' }}>
                  <div
                    role="rowheader"
                    style={{
                      ...stickyNameCell,
                      background: rowBg ?? 'var(--color-surface)',
                    }}
                    title={participant.displayName}
                  >
                    {participant.displayName}
                    {isMe && (
                      <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--color-blurple-ink)' }}>
                        (あなた)
                      </span>
                    )}
                  </div>
                  {sortedCandidates.map((cand) => {
                    const isDecided = cand.id === decidedCandidateId
                    const cell: TallyVoteCell | undefined = cand.votesByParticipantId[participant.id]
                    const cellBg = isDecided
                      ? isMe ? 'color-mix(in srgb, var(--color-yes-soft) 70%, var(--color-blurple-soft) 30%)' : 'var(--color-yes-soft)'
                      : rowBg
                    return (
                      <div
                        key={`cell-${participant.id}-${cand.id}`}
                        role="gridcell"
                        style={{
                          ...dataCell,
                          background: cellBg,
                        }}
                        title={cell?.comment ?? undefined}
                      >
                        {cell ? (
                          <span style={{ color: CHOICE_COLOR[cell.choice], fontWeight: 700 }}>
                            {CHOICE_LABEL[cell.choice]}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-fg3)' }}>—</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
