import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-login-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = 'https://test.example.com'
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.clearAllMocks()
  process.exitCode = undefined
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const startResponse = {
  deviceCode: 'dev-code-123',
  userCode: 'USER-CODE',
  verificationUri: 'https://test.example.com/cli',
  verificationUriComplete: 'https://test.example.com/cli?code=USER-CODE',
  interval: 1,
  expiresIn: 30,
}

describe('login コマンド', () => {
  it('approved: token が保存される', async () => {
    let pollCount = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/cli/start')) {
        return new Response(JSON.stringify(startResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/auth/cli/poll')) {
        pollCount++
        if (pollCount < 2) {
          return new Response(JSON.stringify({ status: 'pending' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(
          JSON.stringify({ status: 'approved', token: 'cli-token-abc', expiresAt: '2999-01-01T00:00:00.000Z' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    })

    const { Command } = await import('commander')
    const { loginCommand } = await import('./login.js')
    const program = new Command()
    program.addCommand(loginCommand())
    await program.parseAsync(['login'], { from: 'user' })

    const credFile = path.join(tmpDir, 'hiyori', 'credentials.json')
    const raw = await fs.readFile(credFile, 'utf-8')
    const creds = JSON.parse(raw)
    expect(creds.token).toBe('cli-token-abc')
    expect(process.exitCode).toBeFalsy()
    vi.unstubAllGlobals()
  })

  it('slow_down: バックオフ後 approved', async () => {
    let pollCount = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/cli/start')) {
        return new Response(JSON.stringify(startResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/auth/cli/poll')) {
        pollCount++
        if (pollCount === 1) {
          return new Response(JSON.stringify({ status: 'slow_down', interval: 1 }), { status: 429, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(
          JSON.stringify({ status: 'approved', token: 'cli-token-slow', expiresAt: '2999-01-01T00:00:00.000Z' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    })

    const { Command } = await import('commander')
    const { loginCommand } = await import('./login.js')
    const program = new Command()
    program.addCommand(loginCommand())
    await program.parseAsync(['login'], { from: 'user' })

    const credFile = path.join(tmpDir, 'hiyori', 'credentials.json')
    const raw = await fs.readFile(credFile, 'utf-8')
    const creds = JSON.parse(raw)
    expect(creds.token).toBe('cli-token-slow')
    vi.unstubAllGlobals()
  })

  it('denied: 非0終了', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/cli/start')) {
        return new Response(JSON.stringify(startResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/auth/cli/poll')) {
        return new Response(JSON.stringify({ status: 'denied' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { loginCommand } = await import('./login.js')
    const program = new Command()
    program.addCommand(loginCommand())
    await program.parseAsync(['login'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('expired: 非0終了', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/cli/start')) {
        return new Response(JSON.stringify(startResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/api/auth/cli/poll')) {
        return new Response(JSON.stringify({ status: 'expired' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { loginCommand } = await import('./login.js')
    const program = new Command()
    program.addCommand(loginCommand())
    await program.parseAsync(['login'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('expiresIn タイムアウト: 非0終了', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/cli/start')) {
        // expiresIn を 0 にして即タイムアウト
        return new Response(JSON.stringify({ ...startResponse, expiresIn: 0, interval: 0 }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { loginCommand } = await import('./login.js')
    const program = new Command()
    program.addCommand(loginCommand())
    await program.parseAsync(['login'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
