import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'

// Exercise both installed local-runtime paths, including the older Vitest pool.
for (const tool of ['wrangler', '@cloudflare/vitest-pool-workers']) {
  const toolRequire = createRequire(import.meta.resolve(tool))
  const miniflareRequire = createRequire(toolRequire.resolve('miniflare'))
  const workerd = miniflareRequire('workerd')

  test(`${tool} uses a native workerd with the CVE-2026-111497 fix`, () => {
    assert.match(workerd.version, /^\d+\.\d+\.\d+$/)
    const [major, release, patch] = workerd.version.split('.').map(Number)
    assert.ok(major > 1 || (major === 1 && (release > 20261027 || (release === 20261027 && patch >= 1))),
      `${tool} resolves unpatched workerd ${workerd.version}`)
    assert.equal(execFileSync(workerd.default, ['--version'], { encoding: 'utf8' }).trim(),
      `workerd ${workerd.compatibilityDate}`)
  })

  test(`${tool} preserves native Brotli compression and decompression`, { timeout: 30000 }, async (t) => {
    const { Miniflare, convertV4MiniflareOptions } = toolRequire('miniflare')
    const worker = new Miniflare({
      ...convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: '2026-05-01',
        compatibilityFlags: ['nodejs_compat'],
        script: `
        import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
        import { Buffer } from 'node:buffer';
        export default {
          fetch() {
            const input = Buffer.from('Hiyori Brotli 日本語');
            return new Response(brotliDecompressSync(brotliCompressSync(input)).toString('utf8'));
          }
        };
        `,
      }),
      cf: false,
      telemetry: { enabled: false },
    })
    t.after(() => worker.dispose())
    const response = await worker.dispatchFetch('http://localhost/')
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'Hiyori Brotli 日本語')
  })
}
