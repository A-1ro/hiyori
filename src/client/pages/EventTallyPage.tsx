import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchTally,
  fetchMyVotes,
  applyDecisions,
  cancelDecisions,
  fetchPermissions,
  type TallyCandidate,
  type TallyVoteCell,
} from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Avatar, Badge, Button, Icon } from '../components/primitives'

const WD = ['日', '月', '火', '水', '木', '金', '土']

function partsOf(iso: string) {
  const dt = new Date(iso)
  return {
    ymd: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    md: `${dt.getMonth() + 1}/${dt.getDate()}`,
    hm: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
    wd: dt.getDay(),
    ts: dt.getTime(),
  }
}

const MK: Record<string, string> = { yes: '○', maybe: '△', no: '×' }
const MKCLS: Record<string, { bg: string; fg: string }> = {
  yes: { bg: 'var(--color-yes-soft)', fg: 'var(--color-yes-ink)' },
  maybe: { bg: 'var(--color-maybe-soft)', fg: 'var(--color-maybe-ink)' },
  no: { bg: 'var(--color-no-soft)', fg: 'var(--color-no-ink)' },
}

interface SlotCol {
  cand: TallyCandidate
  ymd: string
  hm: string
  wd: number
  md: string
  isDayBoundary: boolean
}
interface DayHead {
  ymd: string
  md: string
  wd: number
  span: number
}

export function EventTallyPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [hoverCol, setHoverCol] = useState<string | null>(null)

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

  const { data: permissionsData } = useQuery({
    queryKey: ['permissions', id],
    queryFn: () => fetchPermissions(id!),
    enabled: !!id,
  })
  const isOrganizer = permissionsData?.isOrganizer ?? false

  // 既存の確定済みセットを初期選択に同期（編集モードに自然に入れる）
  const confirmedSet = useMemo(
    () => new Set(tallyData?.decisions?.map((d) => d.candidateId) ?? []),
    [tallyData],
  )
  useEffect(() => {
    setSel(new Set(confirmedSet))
  }, [confirmedSet])

  const applyMutation = useMutation({
    mutationFn: (candidateIds: string[]) => applyDecisions(id!, { candidateIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tally', id] })
      queryClient.invalidateQueries({ queryKey: ['event', id] })
    },
  })

  const cancelAllMutation = useMutation({
    mutationFn: () => cancelDecisions(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tally', id] })
      queryClient.invalidateQueries({ queryKey: ['event', id] })
    },
  })

  const { slots, days, bestId } = useMemo(() => {
    if (!tallyData)
      return { slots: [] as SlotCol[], days: [] as DayHead[], bestId: null as string | null }
    const sorted = [...tallyData.candidates].sort((a, b) => a.startAt.localeCompare(b.startAt))
    const slots: SlotCol[] = []
    const days: DayHead[] = []
    let currentDayYmd: string | null = null
    let currentDay: DayHead | null = null
    for (const c of sorted) {
      const p = partsOf(c.startAt)
      const isBoundary = p.ymd !== currentDayYmd
      if (isBoundary) {
        currentDayYmd = p.ymd
        currentDay = { ymd: p.ymd, md: p.md, wd: p.wd, span: 0 }
        days.push(currentDay)
      }
      currentDay!.span += 1
      slots.push({ cand: c, ymd: p.ymd, hm: p.hm, wd: p.wd, md: p.md, isDayBoundary: isBoundary })
    }
    let best: TallyCandidate | null = null
    for (const c of sorted) {
      if (!best || c.totalScore > best.totalScore) best = c
    }
    return { slots, days, bestId: best?.id ?? null }
  }, [tallyData])

  if (tallyLoading) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-fg3)' }}>読み込み中...</p>
        </main>
      </div>
    )
  }

  if (!tallyData) {
    return (
      <div>
        <AppHeader />
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
          <p style={{ color: 'var(--color-no-ink)' }}>イベントが見つかりません。</p>
          <Button variant="ghost" onClick={() => navigate('/')} style={{ marginTop: 16 }}>
            ホームへ
          </Button>
        </main>
      </div>
    )
  }

  const { event, participants } = tallyData
  const hasDecisions = confirmedSet.size > 0

  const toggle = (cid: string) => {
    if (!isOrganizer) return
    setSel((cur) => {
      const next = new Set(cur)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
      return next
    })
  }

  const handleApply = () => {
    if (sel.size === 0) {
      cancelAllMutation.mutate()
      return
    }
    applyMutation.mutate([...sel])
  }

  // 編集中=現在の選択と、サーバ側に保存されている確定セットが違うか
  const isDirty = useMemo(() => {
    if (sel.size !== confirmedSet.size) return true
    for (const x of sel) if (!confirmedSet.has(x)) return true
    return false
  }, [sel, confirmedSet])

  const sep = (s: SlotCol): string =>
    s.isDayBoundary && s !== slots[0] ? '1px solid var(--color-border)' : 'none'
  const colBg = (cid: string): string => {
    if (sel.has(cid)) return 'var(--color-yes-soft)'
    if (isOrganizer && hoverCol === cid) return 'var(--color-gray-50)'
    return 'transparent'
  }
  const colCellProps = (cid: string) =>
    isOrganizer
      ? {
          onClick: () => toggle(cid),
          onMouseEnter: () => setHoverCol(cid),
          onMouseLeave: () => setHoverCol(null),
        }
      : {}
  const selSlots = slots.filter((s) => sel.has(s.cand.id))
  const addedCount = [...sel].filter((c) => !confirmedSet.has(c)).length
  const removedCount = [...confirmedSet].filter((c) => !sel.has(c)).length

  return (
    <div>
      <AppHeader
        right={
          <>
            {hasDecisions ? (
              <Badge tone="confirmed" dot>
                確定済み {confirmedSet.size}件
              </Badge>
            ) : (
              <Badge tone="open" dot>
                受付中
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="chevron-left" size={16} />}
              onClick={() => navigate(-1)}
            >
              戻る
            </Button>
          </>
        }
      />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 140px' }}>
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg1)',
          }}
        >
          {event.title}
        </h2>
        <p
          style={{
            margin: '0 0 24px',
            fontSize: 14.5,
            color: 'var(--color-fg2)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <Icon name="users" size={16} color="var(--color-fg3)" /> {participants.length}名が回答
          {isOrganizer && (
            <>
              <span> · 確定する</span>
              <b style={{ color: 'var(--color-fg1)' }}>時間帯</b>
              <span>を選んでください</span>
              <span style={{ color: 'var(--color-fg4)', fontWeight: 500 }}>（複数選択可）</span>
            </>
          )}
        </p>

        {slots.length === 0 ? (
          <p style={{ color: 'var(--color-fg3)', fontSize: 14 }}>候補枠がありません。</p>
        ) : (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              padding: 18,
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                width: '100%',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <thead>
                <tr>
                  <th></th>
                  {days.map((d, di) => {
                    const hasSel = slots.some(
                      (s) => s.ymd === d.ymd && sel.has(s.cand.id),
                    )
                    const wdColor =
                      d.wd === 0
                        ? 'var(--color-no-ink)'
                        : d.wd === 6
                          ? 'var(--color-blue)'
                          : 'var(--color-fg4)'
                    return (
                      <th
                        key={d.ymd}
                        colSpan={d.span}
                        style={{
                          padding: '2px 6px 8px',
                          textAlign: 'center',
                          borderLeft: di === 0 ? 'none' : '1px solid var(--color-border)',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: hasSel ? 'var(--color-yes-ink)' : 'var(--color-fg1)',
                          }}
                        >
                          {d.md}
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 500, color: wdColor }}>
                          {WD[d.wd]}
                        </div>
                      </th>
                    )
                  })}
                </tr>
                <tr>
                  <th></th>
                  {slots.map((s) => {
                    const on = sel.has(s.cand.id)
                    const wasConfirmed = confirmedSet.has(s.cand.id)
                    return (
                      <th
                        key={s.cand.id}
                        {...colCellProps(s.cand.id)}
                        style={{
                          padding: '4px 6px 8px',
                          textAlign: 'center',
                          cursor: isOrganizer ? 'pointer' : 'default',
                          minWidth: 56,
                          background: colBg(s.cand.id),
                          borderRadius: '10px 10px 0 0',
                          borderLeft: sep(s),
                          transition: 'background 130ms var(--ease-out)',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: on ? 'var(--color-yes-ink)' : 'var(--color-fg2)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          {on && <Icon name="check" size={12} color="var(--color-yes-ink)" />}
                          {s.hm}
                        </div>
                        {wasConfirmed && (
                          <div
                            style={{
                              fontSize: 9,
                              color: 'var(--color-yes-ink)',
                              fontWeight: 700,
                              marginTop: 2,
                            }}
                          >
                            ★確定
                          </div>
                        )}
                        {!wasConfirmed && s.cand.id === bestId && (
                          <div
                            style={{
                              fontSize: 9,
                              color: 'var(--color-yes-ink)',
                              fontWeight: 700,
                              marginTop: 2,
                            }}
                          >
                            ★最有力
                          </div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {participants.map((p, ri) => {
                  const isMe = p.id === myParticipantId
                  return (
                    <tr key={p.id}>
                      <td
                        style={{
                          textAlign: 'left',
                          fontSize: 13.5,
                          fontWeight: 500,
                          color: 'var(--color-fg2)',
                          padding: '6px 14px 6px 4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <Avatar
                            name={p.displayName}
                            kind={p.kind === 'discord' ? 'discord' : 'guest'}
                            size={24}
                            idx={ri}
                          />
                          {p.displayName}
                          {isMe && (
                            <span
                              style={{
                                marginLeft: 2,
                                fontSize: 11,
                                color: 'var(--color-blurple-ink)',
                                fontWeight: 600,
                              }}
                            >
                              (あなた)
                            </span>
                          )}
                        </span>
                      </td>
                      {slots.map((s) => {
                        const cell: TallyVoteCell | undefined =
                          s.cand.votesByParticipantId[p.id]
                        const cls = cell ? MKCLS[cell.choice] : null
                        return (
                          <td
                            key={s.cand.id}
                            {...colCellProps(s.cand.id)}
                            style={{
                              textAlign: 'center',
                              height: 38,
                              background: colBg(s.cand.id),
                              borderLeft: sep(s),
                              cursor: isOrganizer ? 'pointer' : 'default',
                              transition: 'background 130ms var(--ease-out)',
                            }}
                            title={cell?.comment ?? undefined}
                          >
                            {cell ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 30,
                                  height: 30,
                                  borderRadius: 9,
                                  fontSize: 16,
                                  fontWeight: 700,
                                  background: cls!.bg,
                                  color: cls!.fg,
                                }}
                              >
                                {MK[cell.choice]}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-fg4)' }}>—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                <tr>
                  <td
                    style={{
                      textAlign: 'left',
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: 'var(--color-fg1)',
                      padding: '12px 14px 0 4px',
                    }}
                  >
                    スコア
                  </td>
                  {slots.map((s) => {
                    const on = sel.has(s.cand.id)
                    return (
                      <td
                        key={s.cand.id}
                        {...colCellProps(s.cand.id)}
                        style={{
                          textAlign: 'center',
                          paddingTop: 12,
                          paddingBottom: 8,
                          background: colBg(s.cand.id),
                          borderRadius: '0 0 10px 10px',
                          borderLeft: sep(s),
                          cursor: isOrganizer ? 'pointer' : 'default',
                          transition: 'background 130ms var(--ease-out)',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: on ? 'var(--color-yes-ink)' : 'var(--color-fg1)',
                          }}
                        >
                          {s.cand.totalScore}
                        </div>
                        <div
                          style={{
                            fontSize: 9.5,
                            color: 'var(--color-fg4)',
                            marginTop: 2,
                            fontWeight: 600,
                          }}
                        >
                          ○{s.cand.counts.yes} △{s.cand.counts.maybe} ×{s.cand.counts.no}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* sticky confirm bar */}
      {isOrganizer && slots.length > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--surface-frost)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            borderTop: '1px solid var(--separator)',
            padding: '14px 24px',
          }}
        >
          <div
            style={{
              maxWidth: 720,
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{ flex: 1, fontSize: 14, color: 'var(--color-fg2)' }}>
              {selSlots.length === 0 ? (
                hasDecisions ? (
                  <span style={{ color: 'var(--color-no-ink)' }}>
                    保存すると全ての確定が解除されます
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-fg3)' }}>
                    確定する時間帯を選んでください
                  </span>
                )
              ) : (
                <>
                  <span style={{ color: 'var(--color-fg3)', marginRight: 6 }}>選択中</span>
                  <b
                    style={{
                      color: 'var(--color-fg1)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {selSlots.length}枠
                  </b>
                  {isDirty && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-fg4)' }}>
                      （
                      {addedCount > 0 && (
                        <span style={{ color: 'var(--color-yes-ink)' }}>+{addedCount}</span>
                      )}
                      {addedCount > 0 && removedCount > 0 && ' / '}
                      {removedCount > 0 && (
                        <span style={{ color: 'var(--color-no-ink)' }}>−{removedCount}</span>
                      )}
                      ）
                    </span>
                  )}
                </>
              )}
            </div>
            <Button
              variant="primary"
              size="md"
              disabled={
                !isDirty || applyMutation.isPending || cancelAllMutation.isPending
              }
              onClick={handleApply}
              icon={<Icon name="check-circle" size={18} color="#fff" />}
            >
              {selSlots.length === 0
                ? '全て解除'
                : `${selSlots.length}枠で確定する`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
