import { describe, it, expect } from 'vitest'
import { encryptJoinToken, decryptJoinToken } from './joinlink'
import { generateToken } from './tokens'

describe('joinlink (encrypt join token under the admin token)', () => {
  it('roundtrips with the correct admin token', async () => {
    const join = generateToken('join')
    const admin = generateToken('admin')
    const blob = await encryptJoinToken(join, admin)
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no padding
    expect(blob).not.toContain(join) // ciphertext, not plaintext
    expect(await decryptJoinToken(blob, admin)).toBe(join)
  })

  it('returns null for the wrong admin token (cannot recover from a DB dump)', async () => {
    const join = generateToken('join')
    const blob = await encryptJoinToken(join, generateToken('admin'))
    expect(await decryptJoinToken(blob, generateToken('admin'))).toBeNull()
  })

  it('returns null for a tampered blob (GCM auth)', async () => {
    const join = generateToken('join')
    const admin = generateToken('admin')
    const blob = await encryptJoinToken(join, admin)
    const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'BB' : 'AA')
    expect(await decryptJoinToken(tampered, admin)).toBeNull()
  })

  it('uses a fresh IV each time (same inputs → different ciphertext)', async () => {
    const join = generateToken('join')
    const admin = generateToken('admin')
    const a = await encryptJoinToken(join, admin)
    const b = await encryptJoinToken(join, admin)
    expect(a).not.toBe(b)
    expect(await decryptJoinToken(a, admin)).toBe(join)
    expect(await decryptJoinToken(b, admin)).toBe(join)
  })

  it('returns null on garbage / empty input without throwing', async () => {
    const admin = generateToken('admin')
    expect(await decryptJoinToken('', admin)).toBeNull()
    expect(await decryptJoinToken('!!!notbase64!!!', admin)).toBeNull()
    expect(await decryptJoinToken('AAAA', admin)).toBeNull()
  })
})
