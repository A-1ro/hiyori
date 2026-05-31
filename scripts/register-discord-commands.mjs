// 値は `.dev.vars`（pnpm discord:register が --env-file-if-exists で読み込む）
// またはコマンドライン環境変数で渡す。
const APP_ID = process.env.DISCORD_APP_ID
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const GUILD_ID = process.env.DISCORD_GUILD_ID

const missing = []
if (!APP_ID) missing.push('DISCORD_APP_ID')
if (!BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN')

if (missing.length > 0) {
  console.error(`必須環境変数が未設定: ${missing.join(', ')}`)
  console.error('')
  console.error('設定方法:')
  console.error('  1. .dev.vars に追記（推奨）')
  console.error('     DISCORD_APP_ID=...')
  console.error('     DISCORD_BOT_TOKEN=...')
  console.error('     # 開発中はギルド限定で即時反映させる場合のみ')
  console.error('     DISCORD_GUILD_ID=...')
  console.error('  2. または環境変数で直接渡す')
  console.error('     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... pnpm discord:register')
  console.error('')
  console.error('DISCORD_APP_ID は Discord Developer Portal → General Information の "Application ID"')
  process.exit(1)
}

const commands = [
  {
    name: 'hiyori',
    description: 'Hiyori で日程調整を作成',
    options: [
      {
        type: 1,
        name: 'new',
        description: 'このチャンネルに連携した新しい日程調整を作成',
      },
    ],
  },
]

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
})

if (!res.ok) {
  console.error(`登録失敗 (${res.status}):`)
  console.error(await res.text())
  process.exit(1)
}

const registered = await res.json()
console.log(GUILD_ID ? `ギルド ${GUILD_ID} に登録 (即時反映)` : 'グローバル登録 (反映に最大1時間)')
for (const cmd of registered) {
  console.log(`  - ${cmd.name} (${cmd.id})`)
}
