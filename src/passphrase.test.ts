import { describe, it, expect } from 'vitest'
import {
  hashPassphrase,
  verifyPassphrase,
  isAcceptablePassphrase,
  MAX_PASSPHRASE_LEN,
} from './passphrase'

// Use low iterations for fast tests; the stored iters drive verification.
const FAST = { iters: 1000 }

describe('hashPassphrase / verifyPassphrase', () => {
  it('verifies the correct passphrase and rejects a wrong one', async () => {
    const rec = await hashPassphrase('correct horse battery staple', FAST)
    expect(rec.hash).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(rec.salt).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(rec.iters).toBe(1000)
    expect(await verifyPassphrase('correct horse battery staple', rec)).toBe(true)
    expect(await verifyPassphrase('wrong', rec)).toBe(false)
  })

  it('uses a fresh random salt each time (same input -> different stored hash)', async () => {
    const a = await hashPassphrase('same', FAST)
    const b = await hashPassphrase('same', FAST)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    expect(await verifyPassphrase('same', a)).toBe(true)
    expect(await verifyPassphrase('same', b)).toBe(true)
  })

  it('NFC-normalizes so equivalent unicode forms match', async () => {
    // "e-acute" precomposed (U+00E9) vs decomposed (e + U+0301 combining acute):
    // distinct byte sequences that must hash/verify identically after NFC.
    // Built from code points so the source file stays pure ASCII.
    const precomposed = 'caf' + String.fromCharCode(0x00e9)
    const decomposed = 'caf' + String.fromCharCode(0x0065, 0x0301)
    expect(precomposed).not.toBe(decomposed)
    const rec = await hashPassphrase(precomposed, FAST)
    expect(await verifyPassphrase(decomposed, rec)).toBe(true)
  })
})

describe('isAcceptablePassphrase', () => {
  it('requires a non-empty, non-whitespace, bounded string', () => {
    expect(isAcceptablePassphrase('x')).toBe(true)
    expect(isAcceptablePassphrase('a decent passphrase')).toBe(true)
    expect(isAcceptablePassphrase('')).toBe(false)
    expect(isAcceptablePassphrase('   ')).toBe(false)
    expect(isAcceptablePassphrase('a'.repeat(MAX_PASSPHRASE_LEN + 1))).toBe(false)
    expect(isAcceptablePassphrase(null)).toBe(false)
    expect(isAcceptablePassphrase(12345)).toBe(false)
  })

  it('accepts exactly MAX_PASSPHRASE_LEN and rejects one over (boundary)', () => {
    expect(isAcceptablePassphrase('a'.repeat(MAX_PASSPHRASE_LEN))).toBe(true)
    expect(isAcceptablePassphrase('a'.repeat(MAX_PASSPHRASE_LEN + 1))).toBe(false)
  })

  it('trims only for the emptiness check — surrounding whitespace is hashed', async () => {
    expect(isAcceptablePassphrase('  x  ')).toBe(true)
    const rec = await hashPassphrase('  x  ', FAST)
    expect(await verifyPassphrase('  x  ', rec)).toBe(true)
    expect(await verifyPassphrase('x', rec)).toBe(false) // whitespace is significant
  })
})
