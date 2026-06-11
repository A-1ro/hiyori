import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, } from 'vitest'
import {
  DEFAULT_API_URL,
  clearCredentials,
  readConfig,
  resolveApiUrl,
  resolveToken,
  writeConfig,
  writeCredentials,
} from './config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyori-test-'))
  process.env.XDG_CONFIG_HOME = tmpDir
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  delete process.env.HIYORI_API_URL
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('config set/get api-url', () => {
  it('set → get 往復', async () => {
    await writeConfig({ apiUrl: 'https://example.com' })
    const config = await readConfig()
    expect(config.apiUrl).toBe('https://example.com')
  })

  it('空ファイルから readConfig は空オブジェクトを返す', async () => {
    const config = await readConfig()
    expect(config).toEqual({})
  })
})

describe('resolveApiUrl 優先順位', () => {
  it('flag > env > config > default の順: flag が最優先', async () => {
    process.env.HIYORI_API_URL = 'https://env.example.com'
    await writeConfig({ apiUrl: 'https://config.example.com' })
    const url = await resolveApiUrl({ flag: 'https://flag.example.com' })
    expect(url).toBe('https://flag.example.com')
  })

  it('flag > env > config > default の順: env が config より優先', async () => {
    process.env.HIYORI_API_URL = 'https://env.example.com'
    await writeConfig({ apiUrl: 'https://config.example.com' })
    const url = await resolveApiUrl({})
    expect(url).toBe('https://env.example.com')
  })

  it('flag > env > config > default の順: config が default より優先', async () => {
    await writeConfig({ apiUrl: 'https://config.example.com' })
    const url = await resolveApiUrl({})
    expect(url).toBe('https://config.example.com')
  })

  it('flag > env > config > default の順: 何もなければ default', async () => {
    const url = await resolveApiUrl({})
    expect(url).toBe(DEFAULT_API_URL)
  })
})

describe('writeCredentials mode 600', () => {
  it('credentials.json が mode 600 で書き込まれる', async () => {
    await writeCredentials({ token: 'tok', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://example.com' })
    const credFile = path.join(tmpDir, 'hiyori', 'credentials.json')
    const stat = await fs.stat(credFile)
    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('resolveToken apiUrl 不一致で null', () => {
  it('apiUrl が一致すれば token を返す', async () => {
    await writeCredentials({ token: 'mytoken', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://example.com' })
    const token = await resolveToken({ apiUrl: 'https://example.com' })
    expect(token).toBe('mytoken')
  })

  it('apiUrl が不一致なら null を返す', async () => {
    await writeCredentials({ token: 'mytoken', expiresAt: '2999-01-01T00:00:00.000Z', apiUrl: 'https://example.com' })
    const token = await resolveToken({ apiUrl: 'https://other.example.com' })
    expect(token).toBeNull()
  })

  it('credentials がなければ null を返す', async () => {
    await clearCredentials()
    const token = await resolveToken({ apiUrl: 'https://example.com' })
    expect(token).toBeNull()
  })

  it('expiresAt が過去なら null を返す', async () => {
    await writeCredentials({ token: 'mytoken', expiresAt: '2000-01-01T00:00:00.000Z', apiUrl: 'https://example.com' })
    const token = await resolveToken({ apiUrl: 'https://example.com' })
    expect(token).toBeNull()
  })
})
