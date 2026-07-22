import { describe, it, expect } from 'vitest'
import { linkify } from '../linkify'

describe('linkify', () => {
  it('純テキスト（URL 含まず）はそのまま1セグメントで返る', () => {
    const segs = linkify('こんにちは。今日は良いお知らせです。')
    expect(segs).toEqual([{ type: 'text', value: 'こんにちは。今日は良いお知らせです。' }])
  })

  it('単一 URL（https）は 1 個の url セグメントとして抽出される', () => {
    const segs = linkify('https://example.com')
    expect(segs).toEqual([{ type: 'url', value: 'https://example.com' }])
  })

  it('http スキームも通る', () => {
    const segs = linkify('http://example.com/path')
    expect(segs).toEqual([{ type: 'url', value: 'http://example.com/path' }])
  })

  it('URL＋句読点：URL に末尾の 。 を含まない', () => {
    const segs = linkify('ご案内は https://example.com/foo。 です')
    expect(segs).toEqual([
      { type: 'text', value: 'ご案内は ' },
      { type: 'url', value: 'https://example.com/foo' },
      { type: 'text', value: '。 です' },
    ])
  })

  it('URL＋半角句読点：URL に末尾の . を含まない', () => {
    const segs = linkify('詳細は https://example.com/foo.')
    expect(segs).toEqual([
      { type: 'text', value: '詳細は ' },
      { type: 'url', value: 'https://example.com/foo' },
      { type: 'text', value: '.' },
    ])
  })

  it('javascript: 混入はリンク化されない（regex 段階で除外）', () => {
    const segs = linkify('クリック javascript:alert(1) してください')
    expect(segs).toEqual([
      { type: 'text', value: 'クリック javascript:alert(1) してください' },
    ])
  })

  it('data: 混入はリンク化されない', () => {
    const segs = linkify('data:text/html,<script>alert(1)</script> を含む本文')
    // data: は http/https ではないので regex にマッチしない
    const hasUrl = segs.some((s) => s.type === 'url')
    expect(hasUrl).toBe(false)
  })

  it('URL 複数：2 個以上抽出される', () => {
    const segs = linkify('例A: https://a.example.com そして 例B: https://b.example.com/x')
    const urls = segs.filter((s) => s.type === 'url').map((s) => s.value)
    expect(urls).toEqual(['https://a.example.com', 'https://b.example.com/x'])
  })

  it('全角 URL 疑似（全角コロンなど）はリンク化されない', () => {
    const segs = linkify('ｈｔｔｐｓ：／／example.com は全角なのでリンクにならない')
    const hasUrl = segs.some((s) => s.type === 'url')
    expect(hasUrl).toBe(false)
    expect(segs).toEqual([
      { type: 'text', value: 'ｈｔｔｐｓ：／／example.com は全角なのでリンクにならない' },
    ])
  })

  it('全角閉じ括弧 ）で URL 境界が切れる', () => {
    const segs = linkify('（詳細は https://example.com/foo）を参照')
    expect(segs).toEqual([
      { type: 'text', value: '（詳細は ' },
      { type: 'url', value: 'https://example.com/foo' },
      { type: 'text', value: '）を参照' },
    ])
  })

  it('複数改行・URL 混在', () => {
    const segs = linkify('修正内容:\n- 変更1\n- 詳細: https://example.com/log\nよろしくお願いします')
    const urls = segs.filter((s) => s.type === 'url').map((s) => s.value)
    expect(urls).toEqual(['https://example.com/log'])
  })

  it('空文字列は空配列', () => {
    expect(linkify('')).toEqual([])
  })
})
