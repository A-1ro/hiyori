const APP_ID = process.env.DISCORD_APP_ID
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const GUILD_ID = process.env.DISCORD_GUILD_ID

if (!APP_ID || !BOT_TOKEN) {
  console.error('DISCORD_APP_ID と DISCORD_BOT_TOKEN を環境変数で渡してください。')
  console.error('例: DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... pnpm discord:register')
  console.error('ギルド限定で登録する場合は DISCORD_GUILD_ID も指定（即時反映）。')
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
