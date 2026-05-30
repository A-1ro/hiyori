import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/server/index.tsx',
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    globalSetup: ['./src/server/__tests__/global-setup.ts'],
  },
})
