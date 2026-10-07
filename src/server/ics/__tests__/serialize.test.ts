import { describe, it, expect } from 'vitest'
import {
  formatICalDateTime,
  escapeICalText,
  foldICalLine,
  eventToVEvent,
  wrapInVCalendar,
} from '../serialize'

describe('formatICalDateTime', () => {
  it('UTC の日時を iCalendar 形式 (YYYYMMDDTHHmmssZ) に変換する', () => {
    expect(formatICalDateTime(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z')
  })

  it('ミリ秒成分は切り捨てられる', () => {
    expect(formatICalDateTime(new Date('2026-08-20T00:00:00.999Z'))).toBe('20260820T000000Z')
  })
})

describe('escapeICalText', () => {
  it('バックスラッシュをエスケープする', () => {
    expect(escapeICalText('a\\b')).toBe('a\\\\b')
  })

  it('セミコロンとカンマをエスケープする', () => {
    expect(escapeICalText('a;b,c')).toBe('a\\;b\\,c')
  })

  it('改行を \\n に変換する（CRLF/LF どちらも）', () => {
    expect(escapeICalText('line1\r\nline2\nline3')).toBe('line1\\nline2\\nline3')
  })

  it('特殊文字を含まないテキストはそのまま返す', () => {
    expect(escapeICalText('普通のテキスト hello')).toBe('普通のテキスト hello')
  })

  it('エスケープ順序が正しい（バックスラッシュを先に処理し二重エスケープしない）', () => {
    // 先にセミコロンを \; にしてからバックスラッシュを \\ にすると \\; になってしまう不具合を防ぐ
    expect(escapeICalText(';')).toBe('\\;')
  })
})

describe('foldICalLine', () => {
  it('75 オクテット以下の行はそのまま返す', () => {
    const line = 'SUMMARY:short line'
    expect(foldICalLine(line)).toBe(line)
  })

  it('75 オクテットを超える行は CRLF + 半角スペースで折り返す', () => {
    const line = 'DESCRIPTION:' + 'a'.repeat(100)
    const folded = foldICalLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    // 継続行は先頭が半角スペース
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true)
    }
    // 折り返しても元の文字列を復元できる（先頭スペースを除去して結合）
    const restored = parts[0] + parts.slice(1).map((p) => p.slice(1)).join('')
    expect(restored).toBe(line)
  })

  it('マルチバイト文字境界を壊さずに折り返す', () => {
    const line = 'SUMMARY:' + '日'.repeat(40)
    const folded = foldICalLine(line)
    const encoder = new TextEncoder()
    for (const part of folded.split('\r\n')) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
    }
    // 文字化け（サロゲート分割等）していないことを確認
    expect(folded).not.toContain('�')
  })
})

describe('eventToVEvent', () => {
  const baseArgs = {
    event: { id: 'ev1', title: '定例MTG', description: undefined as string | null | undefined },
    decision: {
      icsUid: 'uid-1',
      icsSequence: 0,
      decidedAt: new Date('2026-01-01T00:00:00.000Z'),
      cancelledAt: null as Date | null,
    },
    candidate: {
      startAt: new Date('2026-01-10T09:00:00.000Z'),
      endAt: new Date('2026-01-10T10:00:00.000Z'),
    },
  }

  it('確定イベントは STATUS:CONFIRMED を含み DTSTAMP に decidedAt を使う', () => {
    const lines = eventToVEvent(baseArgs)
    expect(lines[0]).toBe('BEGIN:VEVENT')
    expect(lines).toContain('UID:uid-1')
    expect(lines).toContain('DTSTAMP:20260101T000000Z')
    expect(lines).toContain('DTSTART:20260110T090000Z')
    expect(lines).toContain('DTEND:20260110T100000Z')
    expect(lines).toContain('SUMMARY:定例MTG')
    expect(lines).toContain('STATUS:CONFIRMED')
    expect(lines.at(-1)).toBe('END:VEVENT')
  })

  it('取消済みイベントは STATUS:CANCELLED を含み DTSTAMP に cancelledAt を使う', () => {
    const args = {
      ...baseArgs,
      decision: {
        ...baseArgs.decision,
        cancelledAt: new Date('2026-01-05T12:00:00.000Z'),
      },
    }
    const lines = eventToVEvent(args)
    expect(lines).toContain('DTSTAMP:20260105T120000Z')
    expect(lines).toContain('STATUS:CANCELLED')
  })

  it('description が未設定なら DESCRIPTION 行を出力しない', () => {
    const lines = eventToVEvent(baseArgs)
    expect(lines.some((l) => l.startsWith('DESCRIPTION:'))).toBe(false)
  })

  it('description が空文字なら DESCRIPTION 行を出力しない', () => {
    const args = { ...baseArgs, event: { ...baseArgs.event, description: '' } }
    const lines = eventToVEvent(args)
    expect(lines.some((l) => l.startsWith('DESCRIPTION:'))).toBe(false)
  })

  it('description があれば DESCRIPTION 行をエスケープして出力する', () => {
    const args = { ...baseArgs, event: { ...baseArgs.event, description: '会議室; 3F,受付前' } }
    const lines = eventToVEvent(args)
    expect(lines).toContain('DESCRIPTION:会議室\\; 3F\\,受付前')
  })

  it('now を明示的に渡すとそれを DTSTAMP に使う（cancelledAt/decidedAt より優先）', () => {
    const args = { ...baseArgs, now: new Date('2026-02-02T02:02:02.000Z') }
    const lines = eventToVEvent(args)
    expect(lines).toContain('DTSTAMP:20260202T020202Z')
  })
})

describe('wrapInVCalendar', () => {
  it('VCALENDAR ヘッダー/フッターで VEVENT 群を包む', () => {
    const vevents = [['BEGIN:VEVENT', 'UID:a', 'END:VEVENT']]
    const result = wrapInVCalendar(vevents)
    expect(result.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(result).toContain('VERSION:2.0')
    expect(result).toContain('PRODID:-//Hiyori//Hiyori//JA')
    expect(result).toContain('BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT')
    expect(result.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('複数イベントを平坦化して全て含める', () => {
    const vevents = [
      ['BEGIN:VEVENT', 'UID:a', 'END:VEVENT'],
      ['BEGIN:VEVENT', 'UID:b', 'END:VEVENT'],
    ]
    const result = wrapInVCalendar(vevents)
    expect(result).toContain('UID:a')
    expect(result).toContain('UID:b')
  })

  it('イベントが空でも有効な VCALENDAR ヘッダー/フッターを返す', () => {
    const result = wrapInVCalendar([])
    expect(result).toBe(
      ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hiyori//Hiyori//JA', 'METHOD:PUBLISH', 'CALSCALE:GREGORIAN', 'END:VCALENDAR']
        .join('\r\n') + '\r\n',
    )
  })
})
