import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

// TODO: 本番ドメイン確定後に差し替え
export const DEFAULT_API_URL = 'https://hiyori.example.workers.dev'

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? path.join(xdg, 'hiyori') : path.join(os.homedir(), '.config', 'hiyori')
}

async function ensureConfigDir(): Promise<string> {
  const dir = getConfigDir()
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await fs.chmod(dir, 0o700)
  } catch {
    // best-effort
  }
  return dir
}

export interface Config {
  apiUrl?: string
}

export interface Credentials {
  token: string
  expiresAt: string
  apiUrl: string
}

export async function readConfig(): Promise<Config> {
  const dir = getConfigDir()
  const file = path.join(dir, 'config.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as Config
  } catch {
    return {}
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const dir = await ensureConfigDir()
  const file = path.join(dir, 'config.json')
  await fs.writeFile(file, JSON.stringify(config, null, 2))
}

export async function readCredentials(): Promise<Credentials | null> {
  const dir = getConfigDir()
  const file = path.join(dir, 'credentials.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const dir = await ensureConfigDir()
  const file = path.join(dir, 'credentials.json')
  await fs.writeFile(file, JSON.stringify(creds, null, 2), { mode: 0o600 })
  await fs.chmod(file, 0o600)
}

export async function clearCredentials(): Promise<void> {
  const dir = getConfigDir()
  const file = path.join(dir, 'credentials.json')
  try {
    await fs.unlink(file)
  } catch {
    // ignore if not exists
  }
}

export async function resolveApiUrl(opts: { flag?: string }): Promise<string> {
  if (opts.flag) return opts.flag
  if (process.env.HIYORI_API_URL) return process.env.HIYORI_API_URL
  const config = await readConfig()
  if (config.apiUrl) return config.apiUrl
  return DEFAULT_API_URL
}

export async function resolveToken(opts: { apiUrl: string }): Promise<string | null> {
  const creds = await readCredentials()
  if (!creds) return null
  if (creds.apiUrl !== opts.apiUrl) return null
  if (new Date(creds.expiresAt).getTime() < Date.now()) return null
  return creds.token
}
