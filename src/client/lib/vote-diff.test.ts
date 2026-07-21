import { describe, it, expect } from 'vitest'
import { dirtyCandidateIds, votesEqual, type VoteMap } from './vote-diff'

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
