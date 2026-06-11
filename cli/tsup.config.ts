import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  dts: false,
  bundle: true,
})
