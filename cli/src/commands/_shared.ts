import type { Command } from 'commander'
import { createCliApi, unwrap, HiyoriApiError } from '../api.js'
import { resolveApiUrl, resolveToken } from '../config.js'
import { fail } from '../output.js'

export { unwrap, HiyoriApiError }

export interface ParentOpts {
  apiUrl?: string
  json?: boolean
}

export function resolveParent(cmd: Command): ParentOpts {
  const grandParent = cmd.parent?.parent?.opts<ParentOpts>() ?? {}
  const parent = cmd.parent?.opts<ParentOpts>() ?? {}
  return { ...grandParent, ...parent }
}

export async function requireAuthedApi(parentOpts: ParentOpts) {
  const apiUrl = await resolveApiUrl({ flag: parentOpts.apiUrl })
  const token = await resolveToken({ apiUrl })
  if (!token) {
    fail('hiyori login を実行してください')
    return null
  }
  const api = createCliApi(apiUrl, token)
  return { api, apiUrl }
}

interface ResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

export async function expectNoContent(res: ResponseLike): Promise<boolean> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore parse errors
    }
    fail(`エラー: ${message}`)
    return false
  }
  return true
}
