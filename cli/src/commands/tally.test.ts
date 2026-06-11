import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-tally-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = 'https://test.example.com'
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  process.exitCode = undefined
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const eventId = 'tally-event-id'
const mockTallyData = {
  event: {
    id: eventId,
    title: 'Tally Test Event',
    status: 'open',
    timezone: 'Asia/Tokyo',
    defaultDurationMinutes: 60,
  },
  participants: [
    { id: 'p1', displayName: 'Alice' },
    { id: 'p2', displayName: 'Bob' },
  ],
  candidates: [
    {
      id: 'c1',
      startAt: '2030-01-15T10:00:00.000Z',
      endAt: '2030-01-15T11:00:00.000Z',
      totalScore: 3,
      counts: { yes: 1, maybe: 1, no: 0 },
      votesByParticipantId: {
        p1: { choice: 'yes', comment: null, updatedAt: '2030-01-01T00:00:00.000Z' },
        p2: { choice: 'maybe', comment: null, updatedAt: '2030-01-01T00:00:00.000Z' },
      },
    },
    {
      id: 'c2',
      startAt: '2030-01-16T10:00:00.000Z',
      endAt: '2030-01-16T11:00:00.000Z',
      totalScore: 0,
      counts: { yes: 0, maybe: 0, no: 0 },
      votesByParticipantId: {},
    },
  ],
  decisions: [{ candidateId: 'c1', decidedAt: '2030-01-10T00:00:00.000Z' }],
}

describe('tally コマンド', () => {
  it('マトリクスをスナップショット検証する', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/tally`)) {
        return new Response(JSON.stringify(mockTallyData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { tallyCommand } = await import('./tally.js')
    const program = new Command()
    program.addCommand(tallyCommand())
    await program.parseAsync(['tally', eventId], { from: 'user' })

    const joined = output.join('\n')
    expect(joined).toContain('Alice')
    expect(joined).toContain('Bob')
    expect(joined).toContain('○')
    expect(joined).toContain('△')
    expect(joined).toContain('·')
    vi.restoreAllMocks()
  })

  it('--json: 生データを passthrough する', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/tally`)) {
        return new Response(JSON.stringify(mockTallyData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { tallyCommand } = await import('./tally.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(tallyCommand())
    await program.parseAsync(['--json', 'tally', eventId], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('participants')
    expect(parsed).toHaveProperty('candidates')
    vi.restoreAllMocks()
  })

  it('404: 非0終了', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { tallyCommand } = await import('./tally.js')
    const program = new Command()
    program.addCommand(tallyCommand())
    await program.parseAsync(['tally', 'nonexistent-id'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
  })
})
