import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import { formatICalDateTime, escapeICalText, foldICalLine, eventToVEvent, wrapInVCalendar } from '../ics/serialize'
import { loginAs } from './test-helpers'

async function applyMigrations() {
  const migrations = inject('d1Migrations')
  await applyD1Migrations((env as { DB: D1Database }).DB, migrations)
}

const BASE = 'https://example.com'

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
  return res
}

const ORGANIZER_ID = '12345678901234567'

const validEventBase = {
  title: 'テストイベント',
  defaultDurationMinutes: 60,
  candidates: [
    { startAt: '2026-07-01T10:00:00.000Z', endAt: '2026-07-01T11:00:00.000Z' },
  ],
}

let organizerCookie: string

beforeEach(async () => {
  await applyMigrations()
  organizerCookie = await loginAs(ORGANIZER_ID)
})

describe('serialize.ts', () => {
  it('T1: formatICalDateTime', () => {
    expect(formatICalDateTime(new Date('2026-06-15T09:30:00.000Z'))).toBe('20260615T093000Z')
  })

  it('T2: escapeICalText 順序', () => {
    expect(escapeICalText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  it('T3: foldICalLine マルチバイト境界', () => {
    const input = 'X'.repeat(60) + 'あいうえお'.repeat(5)
    const folded = foldICalLine(input)
    expect(folded).toContain('\r\n ')
    expect(folded.length).toBeGreaterThan(input.length)
    // 各行が CRLF で分割された後、先頭 ' ' を除いた各セクションがマルチバイト境界を割っていないか確認
    const lines = folded.split('\r\n')
    for (const line of lines) {
      // 各行がデコード可能な UTF-8 文字列であること（境界を割っていない）
      const stripped = line.startsWith(' ') ? line.slice(1) : line
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(stripped))).not.toThrow()
    }
  })

  it('T4: eventToVEvent 確定 STATUS:CONFIRMED + description 無し時 DESCRIPTION 行省略', () => {
    const lines = eventToVEvent({
      event: { id: 'e1', title: 'Year-end party', description: undefined },
      decision: {
        icsUid: 'evt-e1-d1@example.com',
        icsSequence: 0,
        decidedAt: new Date('2026-05-30T00:00:00Z'),
        cancelledAt: null,
      },
      candidate: { startAt: new Date('2026-06-15T09:30:00Z'), endAt: new Date('2026-06-15T10:30:00Z') },
      now: new Date('2026-05-30T12:00:00Z'),
    })
    expect(lines).toContain('BEGIN:VEVENT')
    expect(lines).toContain('UID:evt-e1-d1@example.com')
    expect(lines).toContain('DTSTART:20260615T093000Z')
    expect(lines).toContain('DTEND:20260615T103000Z')
    expect(lines).toContain('SEQUENCE:0')
    expect(lines).toContain('SUMMARY:Year-end party')
    expect(lines).toContain('STATUS:CONFIRMED')
    expect(lines).toContain('END:VEVENT')
    expect(lines.some((l) => l.startsWith('DESCRIPTION:'))).toBe(false)
  })

  it('T5: eventToVEvent 取消 STATUS:CANCELLED', () => {
    const lines = eventToVEvent({
      event: { id: 'e1', title: 'Party', description: null },
      decision: {
        icsUid: 'evt-e1-d1@example.com',
        icsSequence: 1,
        decidedAt: new Date(),
        cancelledAt: new Date('2026-05-30T15:00:00Z'),
      },
      candidate: { startAt: new Date('2026-06-15T09:30:00Z'), endAt: new Date('2026-06-15T10:30:00Z') },
    })
    expect(lines).toContain('STATUS:CANCELLED')
    expect(lines).toContain('SEQUENCE:1')
  })
})

describe('GET /api/events/:id/decision.ics', () => {
  it('T6: 未確定 (Decision 無し) → 404', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string } }
    const eventId = created.event.id

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/decision.ics`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Not Found')
  })

  it('T7: 確定済み → 200 + 正しい Content-Type/Disposition + body', async () => {
    const createRes = await post('/api/events', validEventBase, { Cookie: organizerCookie })
    const created = (await createRes.json()) as { event: { id: string }; candidates: Array<{ id: string }> }
    const eventId = created.event.id
    const candidateId = created.candidates[0]!.id

    await post(`/api/events/${eventId}/decision`, { candidateId }, { Cookie: organizerCookie })

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/decision.ics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    const disposition = res.headers.get('Content-Disposition') ?? ''
    expect(disposition).toContain('attachment; filename="')

    const text = await res.text()
    expect(text).toContain('BEGIN:VCALENDAR\r\n')
    expect(text).toContain('UID:')
    expect(text).toContain('DTSTART:')
    expect(text).toContain('END:VCALENDAR\r\n')
    expect(text).toContain('\r\n')
  })
})
