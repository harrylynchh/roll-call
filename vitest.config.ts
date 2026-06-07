import { defineConfig } from 'vitest/config'

// Pure security-critical helpers (crypto, tokens, passphrase, session, e164,
// vcard, ratelimit math) run under the plain Node environment — Node 20+ exposes
// the Web Crypto API on `globalThis.crypto`, matching the Workers runtime closely
// enough for these units. D1-backed integration tests (a later phase) will use
// @cloudflare/vitest-pool-workers against a real Miniflare D1. See HANDOFF.md.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
})
