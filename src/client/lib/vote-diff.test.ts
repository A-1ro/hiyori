import { describe, it, expect } from 'vitest'
import {
  dirtyCandidateIds,
  votesEqual,
  parseVoteDraft,
  serializeVoteDraft,
  reconcileVoteDraft,
  VOTE_DRAFT_VERSION,
  type VoteMap,
  type VoteDraft,
} from './vote-diff'

describe('dirtyCandidateIds / votesEqual', () => {
  it('両方空 → 差分なし', () => {
    expect(dirtyCandidateIds({}, {})).toEqual([])
    expect(votesEqual({}, {})).toBe(true)
  })

  it('完全一致 → 差分なし', () => {
    const a: VoteMap = { c1: 'yes', c2: 'no' }
    const b: VoteMap = { c1: 'yes', c2: 'no' }
    expect(dirtyCandidateIds(a, b)).toEqual([])
    expect(votesEqual(a, b)).toBe(true)
  })

  it('値が違う枠だけを差分として返す', () => {
    const current: VoteMap = { c1: 'yes', c2: 'maybe' }
    const server: VoteMap = { c1: 'yes', c2: 'no' }
    expect(dirtyCandidateIds(current, server)).toEqual(['c2'])
    expect(votesEqual(current, server)).toBe(false)
  })

  it('画面にあってサーバーに無い枠（新規入力・未送信）は差分', () => {
    const current: VoteMap = { c1: 'yes', c2: 'no' }
    const server: VoteMap = { c1: 'yes' }
    expect(dirtyCandidateIds(current, server)).toEqual(['c2'])
    expect(votesEqual(current, server)).toBe(false)
  })

  it('サーバーにあって画面に無い枠も差分', () => {
    const current: VoteMap = { c1: 'yes' }
    const server: VoteMap = { c1: 'yes', c2: 'no' }
    expect(dirtyCandidateIds(current, server)).toEqual(['c2'])
    expect(votesEqual(current, server)).toBe(false)
  })

  it('複数の差分枠をすべて返す', () => {
    const current: VoteMap = { c1: 'yes', c2: 'maybe', c3: 'no' }
    const server: VoteMap = { c1: 'no', c2: 'maybe', c3: 'yes' }
    expect(dirtyCandidateIds(current, server).sort()).toEqual(['c1', 'c3'])
  })
})

describe('parseVoteDraft', () => {
  it('v2 形式をそのまま復元', () => {
    const raw = JSON.stringify({ v: 2, votes: { c1: 'yes' }, baseline: { c1: 'no' } })
    expect(parseVoteDraft(raw)).toEqual({ votes: { c1: 'yes' }, baseline: { c1: 'no' }, legacy: false })
  })

  it('旧 v1（フラットマップ）を legacy=true・baseline 空で復元', () => {
    const raw = JSON.stringify({ c1: 'yes', c2: 'no' })
    expect(parseVoteDraft(raw)).toEqual({ votes: { c1: 'yes', c2: 'no' }, baseline: {}, legacy: true })
  })

  it('null / 空文字 / 壊れた JSON は null', () => {
    expect(parseVoteDraft(null)).toBeNull()
    expect(parseVoteDraft('')).toBeNull()
    expect(parseVoteDraft('{not json')).toBeNull()
  })

  it('投票選択肢でない値のフラットオブジェクトは null（誤検出しない）', () => {
    expect(parseVoteDraft(JSON.stringify({ c1: 'banana' }))).toBeNull()
  })
})

describe('serializeVoteDraft / round-trip', () => {
  it('v2 形式で直列化し parse で戻る', () => {
    const s = serializeVoteDraft({ c1: 'yes' }, { c1: 'no' })
    expect(JSON.parse(s).v).toBe(VOTE_DRAFT_VERSION)
    expect(parseVoteDraft(s)).toEqual({ votes: { c1: 'yes' }, baseline: { c1: 'no' }, legacy: false })
  })
})

describe('reconcileVoteDraft', () => {
  it('baseline == 現在サーバー → 下書き採用（ローカル未送信を維持）', () => {
    const draft: VoteDraft = { votes: { c1: 'yes', c2: 'no' }, baseline: { c1: 'yes' }, legacy: false }
    const server: VoteMap = { c1: 'yes' }
    const r = reconcileVoteDraft(draft, server)
    expect(r.source).toBe('draft')
    expect(r.externalChanged).toBe(false)
    expect(r.votes).toEqual({ c1: 'yes', c2: 'no' })
    // 採用した votes は baseline と差分あり = dirty（未送信が正しく出る）
    expect(dirtyCandidateIds(r.votes, draft.baseline)).toEqual(['c2'])
  })

  it('baseline != 現在サーバー（別経路で更新）→ サーバー採用・externalChanged・非 dirty', () => {
    const draft: VoteDraft = { votes: { c1: 'yes' }, baseline: { c1: 'no' }, legacy: false }
    const server: VoteMap = { c1: 'maybe', c2: 'yes' } // 外部で変わった
    const r = reconcileVoteDraft(draft, server)
    expect(r.source).toBe('server')
    expect(r.externalChanged).toBe(true)
    expect(r.votes).toEqual({ c1: 'maybe', c2: 'yes' })
    // 採用サーバー票を baseline(=サーバー) と比べれば dirty ではない（誤「未送信」を出さない）
    expect(dirtyCandidateIds(r.votes, server)).toEqual([])
  })

  it('下書きなし → サーバー採用・通知なし', () => {
    const server: VoteMap = { c1: 'yes' }
    const r = reconcileVoteDraft(null, server)
    expect(r.source).toBe('server')
    expect(r.externalChanged).toBe(false)
    expect(r.votes).toEqual({ c1: 'yes' })
  })

  it('旧 v1 下書き & サーバー空 → 下書き採用（純粋なローカル未送信を維持）', () => {
    const draft = parseVoteDraft(JSON.stringify({ c1: 'yes' }))! // legacy, baseline {}
    const r = reconcileVoteDraft(draft, {})
    expect(r.source).toBe('draft')
    expect(r.externalChanged).toBe(false)
    expect(r.votes).toEqual({ c1: 'yes' })
  })

  it('旧 v1 下書き & サーバーに票あり → サーバー採用・通知は出さない（静かに移行）', () => {
    const draft = parseVoteDraft(JSON.stringify({ c1: 'yes' }))! // legacy, baseline {}
    const server: VoteMap = { c1: 'no' }
    const r = reconcileVoteDraft(draft, server)
    expect(r.source).toBe('server')
    expect(r.externalChanged).toBe(false) // legacy は通知しない
    expect(r.votes).toEqual({ c1: 'no' })
  })
})
