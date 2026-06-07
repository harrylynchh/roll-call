import { describe, it, expect } from 'vitest'
import {
  utf8,
  randomBytes,
  bytesToHex,
  bytesToBase64url,
  base64urlToBytes,
  sha256Hex,
  hmacSha256,
  pbkdf2,
  timingSafeEqual,
  timingSafeEqualStr,
} from './crypto'

describe('encoding', () => {
  it('hex encodes with zero padding', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff')
  })

  it('base64url roundtrips arbitrary bytes (unpadded, url-safe)', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n)
      const s = bytesToBase64url(b)
      expect(s).not.toMatch(/[+/=]/)
      expect([...base64urlToBytes(s)]).toEqual([...b])
    }
  })
})

describe('sha256', () => {
  it('matches the known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('hmacSha256', () => {
  it('matches the RFC test vector', async () => {
    const mac = await hmacSha256('key', 'The quick brown fox jumps over the lazy dog')
    expect(bytesToHex(mac)).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })
})

describe('pbkdf2', () => {
  it('matches a PBKDF2-HMAC-SHA256 known vector (c=1, dkLen=32)', async () => {
    const out = await pbkdf2('password', utf8('salt'), 1, 256)
    expect(bytesToHex(out)).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    )
  })

  it('is deterministic and salt-sensitive', async () => {
    const a = await pbkdf2('pw', utf8('saltA'), 1000, 256)
    const a2 = await pbkdf2('pw', utf8('saltA'), 1000, 256)
    const b = await pbkdf2('pw', utf8('saltB'), 1000, 256)
    expect(bytesToHex(a)).toBe(bytesToHex(a2))
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })
})

describe('timingSafeEqual', () => {
  it('returns true only for identical byte arrays', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
  })
  it('returns false on length mismatch', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
  })
  it('compares strings', () => {
    expect(timingSafeEqualStr('deadbeef', 'deadbeef')).toBe(true)
    expect(timingSafeEqualStr('deadbeef', 'deadbe0f')).toBe(false)
  })

  it('detects a difference in the first OR last byte (no early exit)', () => {
    const base = new Uint8Array([10, 20, 30, 40, 50])
    const firstDiff = new Uint8Array([99, 20, 30, 40, 50])
    const lastDiff = new Uint8Array([10, 20, 30, 40, 99])
    expect(timingSafeEqual(base, firstDiff)).toBe(false)
    expect(timingSafeEqual(base, lastDiff)).toBe(false)
    // a long string differing only in the very last char must still be unequal
    expect(timingSafeEqualStr('a'.repeat(63) + 'b', 'a'.repeat(63) + 'c')).toBe(false)
  })

  it('treats two empty arrays as equal', () => {
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })
})

describe('base64urlToBytes invalid input', () => {
  it('throws on illegal characters (callers rely on this for safe rejection)', () => {
    // verifySession / verifyPassphrase wrap this in try/catch to turn a tampered
    // encoding into a clean null/false instead of a 500.
    expect(() => base64urlToBytes('****')).toThrow()
    expect(() => base64urlToBytes('@@')).toThrow()
  })
})
