#!/usr/bin/env node
// お知らせ投稿・アーカイブ用 CLI（企画書 §6.2）。
// - 依存ゼロ・Node 22 標準（fetch / node:process / node:util.parseArgs / node:fs）のみ。
// - 認証: env `ANNOUNCEMENTS_ADMIN_TOKEN` を Bearer で送る。
// - 確認プロンプトは `/dev/tty` を直接 open して読む（stdin は本文で consumed 済みの前提）。
// - tty が無い環境（CI 等）では `--yes` が必須（未指定は即エラー終了）。
//
// 使用例:
//   ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
//     --api-url https://hiyori-schedule.com \
//     --title "投票の重複バグを修正しました" \
//     --category bug_fix \
//     --body "詳細..."
//
//   echo "本文" | ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
//     --api-url https://hiyori-schedule.com --title "..." --category notice --yes
//
//   ANNOUNCEMENTS_ADMIN_TOKEN=xxx node scripts/announce.mjs \
//     --api-url https://hiyori-schedule.com --archive 018f-...-abc --yes

import { parseArgs } from 'node:util'
import { readFileSync, openSync, readSync, closeSync } from 'node:fs'
import process from 'node:process'

const CATEGORIES = ['bug_fix', 'new_feature', 'notice']

function die(msg, code = 1) {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

function isTTY() {
  return Boolean(process.stdin.isTTY) || Boolean(process.stdout.isTTY)
}

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// /dev/tty を直接 open してユーザー入力を 1 行読む（stdin が本文で consumed されているケース対策）。
// tty がない環境ではエラーで返す（呼び出し側で `--yes` の有無を検査する）。
function promptFromTty(question) {
  let fd
  try {
    fd = openSync('/dev/tty', 'r')
  } catch (err) {
    throw new Error(`/dev/tty を開けませんでした: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    process.stderr.write(question)
    const buf = Buffer.alloc(1024)
    let out = ''
    while (true) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      const chunk = buf.slice(0, n).toString('utf8')
      const nl = chunk.indexOf('\n')
      if (nl >= 0) {
        out += chunk.slice(0, nl)
        break
      }
      out += chunk
    }
    return out.trim()
  } finally {
    closeSync(fd)
  }
}

function usage() {
  return `使い方:
  node scripts/announce.mjs [options]

投稿モード（既定）:
  --api-url <url>          必須。省略時は env HIYORI_API_URL
  --title <text>           必須。1〜120 字
  --category <cat>         必須。${CATEGORIES.join(' / ')}
  --body <text>            任意。省略時は stdin から読む
  --published-at <iso>     任意。ISO 8601（過去30日以内・未来不可）
  --yes                    確認プロンプトをスキップ
  --dry-run                送信せずリクエスト JSON を stdout に出す

アーカイブモード:
  --archive <id>           指定 id を status='archived' に更新

環境変数:
  ANNOUNCEMENTS_ADMIN_TOKEN 必須。Bearer で送る admin トークン
  HIYORI_API_URL           --api-url 未指定時の既定 API URL
`
}

async function main() {
  let args
  try {
    args = parseArgs({
      options: {
        'api-url': { type: 'string' },
        title: { type: 'string' },
        category: { type: 'string' },
        body: { type: 'string' },
        'published-at': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        archive: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    })
  } catch (err) {
    die(`引数エラー: ${err instanceof Error ? err.message : String(err)}\n\n${usage()}`)
    return
  }
  const { values } = args
  if (values.help) {
    process.stdout.write(usage())
    return
  }

  const apiUrl = values['api-url'] ?? process.env.HIYORI_API_URL
  if (!apiUrl) die('--api-url もしくは HIYORI_API_URL が必要です')
  const token = process.env.ANNOUNCEMENTS_ADMIN_TOKEN
  if (!token) die('環境変数 ANNOUNCEMENTS_ADMIN_TOKEN が未設定です')

  const isArchive = typeof values.archive === 'string' && values.archive.length > 0

  if (isArchive) {
    const id = values.archive
    if (values['dry-run']) {
      process.stdout.write(
        `${JSON.stringify({ method: 'PATCH', url: `${apiUrl}/api/announcements/${id}`, body: { status: 'archived' } }, null, 2)}\n`,
      )
      return
    }
    if (!values.yes && !isTTY()) {
      die('tty がない環境では --yes 必須です')
    }
    if (!values.yes) {
      const ans = promptFromTty(`archive: id=${id} を送信しますか？ [y/N] `)
      if (!/^y(es)?$/i.test(ans)) die('中止しました', 0)
    }
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/announcements/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'archived' }),
    })
    const text = await res.text()
    if (!res.ok) die(`エラー ${res.status}: ${text}`)
    process.stdout.write(`${text}\n`)
    return
  }

  // 投稿モード
  const title = values.title
  const category = values.category
  if (!title) die('--title が必要です')
  if (!category) die('--category が必要です')
  if (!CATEGORIES.includes(category)) die(`--category は ${CATEGORIES.join(' / ')} のいずれか`)

  let body = values.body
  if (!body) {
    body = readStdinSync().trim()
  }
  if (!body) die('本文が空です（--body もしくは stdin で指定）')

  const payload = {
    title,
    body,
    category,
    ...(values['published-at'] ? { publishedAt: values['published-at'] } : {}),
  }

  if (values['dry-run']) {
    process.stdout.write(
      `${JSON.stringify({ method: 'POST', url: `${apiUrl}/api/announcements`, body: payload }, null, 2)}\n`,
    )
    return
  }

  if (!values.yes) {
    if (!isTTY()) die('tty がない環境では --yes 必須です')
    process.stderr.write('--- 投稿内容 ---\n')
    process.stderr.write(`title: ${payload.title}\n`)
    process.stderr.write(`category: ${payload.category}\n`)
    if (payload.publishedAt) process.stderr.write(`publishedAt: ${payload.publishedAt}\n`)
    process.stderr.write(`body:\n${payload.body}\n`)
    process.stderr.write('----------------\n')
    const ans = promptFromTty('この内容で送信しますか？ [y/N] ')
    if (!/^y(es)?$/i.test(ans)) die('中止しました', 0)
  }

  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/announcements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) die(`エラー ${res.status}: ${text}`)
  process.stdout.write(`${text}\n`)
}

main().catch((err) => die(`予期しないエラー: ${err instanceof Error ? err.message : String(err)}`))
