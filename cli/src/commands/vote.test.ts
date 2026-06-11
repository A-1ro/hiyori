import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

vi.mock('@clack/prompts', () => ({
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  intro: vi.fn(),
}))

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-vote-test-'))
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

const eventId = 'event-uuid-123'
const candidateId = 'cand-uuid-456'

const mockEvent = {
  event: { id: eventId, title: 'Test Event', status: 'open' },
  candidates: [
    { id: candidateId, startAt: '2030-01-15T10:00:00.000Z', endAt: '2030-01-15T11:00:00.000Z' },
  ],
}
const mockVotesMe = {
  participant: { id: 'part-uuid-789', displayName: 'Test User' },
  votes: [{ candidateId, choice: 'yes' }],
}
const mockVotesMeNoParticipant = {
  participant: null,
  votes: [],
}
const mockVotesResult = {
  votes: [{ candidateId, choice: 'yes' }],
}
const mockParticipant = {
  participant: { id: 'part-uuid-789', displayName: 'New User' },
}

describe('vote コマンド', () => {
  it('既存参加者が --vote で非対話投票成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/votes/me`)) {
        return new Response(JSON.stringify(mockVotesMe), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}/votes`) && init?.method === 'PUT') {
        return new Response(JSON.stringify(mockVotesResult), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith(`/api/events/${eventId}`)) {
        return new Response(JSON.stringify(mockEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { voteCommand } = await import('./vote.js')
    const program = new Command()
    program.addCommand(voteCommand())
    await program.parseAsync(['vote', eventId, `--vote`, `${candidateId}=yes`], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('投票しました'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: {votes} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/votes/me`)) {
        return new Response(JSON.stringify(mockVotesMe), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}/votes`) && init?.method === 'PUT') {
        return new Response(JSON.stringify(mockVotesResult), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}`)) {
        return new Response(JSON.stringify(mockEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { voteCommand } = await import('./vote.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(voteCommand())
    await program.parseAsync(['--json', 'vote', eventId, '--vote', `${candidateId}=yes`], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('votes')
    vi.restoreAllMocks()
  })

  it('未登録ユーザーが --name で自己登録後に投票成功（POST participants が先に呼ばれる）', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/votes/me`)) {
        calls.push('GET votes/me')
        return new Response(JSON.stringify(mockVotesMeNoParticipant), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}/participants`) && init?.method === 'POST') {
        calls.push('POST participants')
        return new Response(JSON.stringify(mockParticipant), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}/votes`) && init?.method === 'PUT') {
        calls.push('PUT votes')
        return new Response(JSON.stringify(mockVotesResult), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}`)) {
        return new Response(JSON.stringify(mockEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { voteCommand } = await import('./vote.js')
    const program = new Command()
    program.addCommand(voteCommand())
    await program.parseAsync(['vote', eventId, '--name', 'New User', '--vote', `${candidateId}=yes`], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    // POST participants が PUT votes より先に呼ばれることを確認
    const participantsIdx = calls.indexOf('POST participants')
    const votesIdx = calls.indexOf('PUT votes')
    expect(participantsIdx).toBeGreaterThan(-1)
    expect(votesIdx).toBeGreaterThan(-1)
    expect(participantsIdx).toBeLessThan(votesIdx)
    vi.restoreAllMocks()
  })

  it('403 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/votes/me`)) {
        return new Response(JSON.stringify(mockVotesMe), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes(`/api/events/${eventId}/votes`) && init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith(`/api/events/${eventId}`)) {
        return new Response(JSON.stringify(mockEvent), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { voteCommand } = await import('./vote.js')
    const program = new Command()
    program.addCommand(voteCommand())
    await program.parseAsync(['vote', eventId, '--vote', `${candidateId}=yes`], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { voteCommand } = await import('./vote.js')
    const program = new Command()
    program.addCommand(voteCommand())
    await program.parseAsync(['vote', eventId, '--vote', `${candidateId}=yes`], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })
})
