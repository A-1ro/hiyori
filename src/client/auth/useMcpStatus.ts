import { useQuery } from '@tanstack/react-query'

// MCP サーバー（AI 連携）が本番で有効かどうか。フッター等の導線を MCP_ENABLED に追従させるために使う。
// 単一の真実の源はサーバー側の環境フラグ（/api/mcp/status）。取得失敗時は無効扱い（導線を出さない）。
export function useMcpStatus() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ['mcp-status'],
    queryFn: async () => {
      const res = await fetch('/api/mcp/status')
      if (!res.ok) return { enabled: false }
      return res.json()
    },
    staleTime: Infinity,
  })
}
