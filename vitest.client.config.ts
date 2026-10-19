import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// クライアント（React コンポーネント）用の vitest 設定。
// ルートの vitest.config.ts は Cloudflare Workers プール（DOM 無し）なので、
// jsdom を要するコンポーネント統合テストはこの別 config で分離して走らせる。
// （CLI が cli/vitest.config.ts を別立てしているのと同じ方針）
// 実行: pnpm test:client
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Node 25+ の native Web Storage が jsdom の Storage を隠すのを防ぐ。
    // https://github.com/vitest-dev/vitest/issues/10867
    execArgv: Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-webstorage'] : [],
    globals: true,
    include: ['src/client/**/*.test.tsx'],
    setupFiles: ['./vitest.client.setup.ts'],
    restoreMocks: true,
  },
})
