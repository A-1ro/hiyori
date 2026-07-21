// MCP サーバーの型定義（Phase 0/1）。
//
// McpProps は「MCP クライアントが誰として動くか」を表す認証コンテキスト。
// McpAgent の props（Durable Object に渡される）としてツールから参照する。
//
// ★案 A（OAuth）差し替え可能ポイント:
//   - Phase 1（案 B）では handler.ts が「クライアントの Bearer をそのまま検証」して props を組み立て、
//     apiToken にはその Bearer をそのまま入れる（= パススルー）。
//   - Phase 2（案 A）では workers-oauth-provider が Discord 上流認証で props.discordUserId を確定し、
//     ツール呼び出し時に kind:'mcp' の短命セッションを発行して apiToken に入れる。
//   どちらの場合も「props に内部呼び出し用トークン + 本人情報が乗る」形は同じなので、ツール実装は無改造で済む。

export type McpScope = 'hiyori:read' | 'hiyori:write'

export interface McpProps extends Record<string, unknown> {
  userId: string
  discordUserId: string
  username: string
  globalName: string | null
  avatar: string | null
  displayName: string
  // 内部 /api/* を叩くための Bearer トークン（案 B: クライアント提示のセッショントークン）。
  apiToken: string
  // read/write スコープ。案 B では常に両方。案 A では同意画面で絞れる。
  scopes: McpScope[]
}
