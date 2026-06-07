import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-whoami-test-'))
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

const mockUser = {
  userId: 'user-1',
  discordUserId: '123456789',
  username: 'testuser',
  globalName: 'Test User',
  avatar: null,
  displayName: 'Test User',
}

describe('whoami コマンド', () => {
  it('認証済み: ユーザー情報を表示する', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ user: mockUser }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => { output.push(msg) })

    const { Command } = await import('commander')
    const { whoamiCommand } = await import('./whoami.js')
    const program = new Command()
    program.addCommand(whoamiCommand())
    await program.parseAsync(['whoami'], { from: 'user' })

    expect(output.some((l) => l.includes('testuser'))).toBe(true)
    expect(process.exitCode).toBeFalsy()
    vi.restoreAllMocks()
  })

  it('未認証 (user=null): 非0終了', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ user: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { whoamiCommand } = await import('./whoami.js')
    const program = new Command()
    program.addCommand(whoamiCommand())
    await program.parseAsync(['whoami'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    consoleSpy.mockRestore()
  })
})
