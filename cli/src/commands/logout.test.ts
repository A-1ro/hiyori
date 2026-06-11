import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCredentials } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-logout-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
  process.env.HIYORI_API_URL = 'https://test.example.com'
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('logout コマンド', () => {
  it('token あり: Bearer 付きで POST /api/auth/logout を呼び、認証情報を削除する', async () => {
    await writeCredentials({ token: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://test.example.com' })

    let capturedUrl = ''
    let capturedAuthHeader = ''
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      capturedUrl = url
      const headers = init?.headers
      capturedAuthHeader = headers instanceof Headers
        ? (headers.get('Authorization') ?? '')
        : ((headers as Record<string, string> | undefined)?.Authorization ?? '')
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const { Command } = await import('commander')
    const { logoutCommand } = await import('./logout.js')
    const program = new Command()
    program.addCommand(logoutCommand())
    await program.parseAsync(['logout'], { from: 'user' })

    expect(capturedUrl).toContain('/api/auth/logout')
    expect(capturedAuthHeader).toBe('Bearer test-token')

    // ローカル認証情報が削除されていることを確認
    const credFile = path.join(tmpDir, 'hiyori', 'credentials.json')
    await expect(fs.access(credFile)).rejects.toThrow()
  })

  it('token なし: ローカル削除のみ（冪等）', async () => {
    let fetchCalled = false
    vi.stubGlobal('fetch', async () => {
      fetchCalled = true
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { Command } = await import('commander')
    const { logoutCommand } = await import('./logout.js')
    const program = new Command()
    program.addCommand(logoutCommand())
    await program.parseAsync(['logout'], { from: 'user' })

    // token がないので fetch は呼ばれていない
    expect(fetchCalled).toBe(false)
    expect(process.exitCode).toBeFalsy()
    consoleSpy.mockRestore()
  })
})
