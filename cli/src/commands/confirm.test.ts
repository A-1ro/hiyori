import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}))

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-confirm-test-'))
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

const mockDecisionResponse = {
  decisions: [{ id: 'dec-uuid-789', candidateId }],
  event: { id: eventId, title: 'Test Event', status: 'confirmed' },
}

const mockUnconfirmResponse = {
  decisions: [],
  event: { id: eventId, title: 'Test Event', status: 'open' },
}

describe('confirm コマンド', () => {
  it('confirm で確定結果を出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'POST') {
        return new Response(JSON.stringify(mockDecisionResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { confirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(confirmCommand())
    await program.parseAsync(['confirm', eventId, candidateId], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('確定しました'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: {decisions, event} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'POST') {
        return new Response(JSON.stringify(mockDecisionResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { confirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(confirmCommand())
    await program.parseAsync(['--json', 'confirm', eventId, candidateId], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('decisions')
    expect(parsed).toHaveProperty('event')
    vi.restoreAllMocks()
  })

  it('status 200（既に確定していた）でも成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'POST') {
        return new Response(JSON.stringify(mockDecisionResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { confirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(confirmCommand())
    await program.parseAsync(['confirm', eventId, candidateId], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('確定しました'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('403 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { confirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(confirmCommand())
    await program.parseAsync(['confirm', eventId, candidateId], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { confirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(confirmCommand())
    await program.parseAsync(['confirm', eventId, candidateId], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('unconfirm コマンド', () => {
  it('--yes で確定解除成功', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'DELETE') {
        return new Response(JSON.stringify(mockUnconfirmResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { unconfirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(unconfirmCommand())
    await program.parseAsync(['unconfirm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBeUndefined()
    expect(output.some((l) => l.includes('解除しました'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('--json: {decisions, event} を JSON 出力', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'DELETE') {
        return new Response(JSON.stringify(mockUnconfirmResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    let jsonOutput = ''
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { jsonOutput += msg })

    const { Command } = await import('commander')
    const { unconfirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.option('--json')
    program.addCommand(unconfirmCommand())
    await program.parseAsync(['--json', 'unconfirm', eventId, '--yes'], { from: 'user' })

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveProperty('decisions')
    expect(parsed).toHaveProperty('event')
    vi.restoreAllMocks()
  })

  it('403 で fail して非0終了', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes(`/api/events/${eventId}/decision`) && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { unconfirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(unconfirmCommand())
    await program.parseAsync(['unconfirm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    vi.restoreAllMocks()
  })

  it('未ログインで「hiyori login を実行してください」+ 非0終了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { Command } = await import('commander')
    const { unconfirmCommand } = await import('./confirm.js')
    const program = new Command()
    program.addCommand(unconfirmCommand())
    await program.parseAsync(['unconfirm', eventId, '--yes'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes('hiyori login'))).toBe(true)
    vi.restoreAllMocks()
  })
})
