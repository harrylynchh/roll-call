import { describe, it, expect } from 'vitest'
import { generateToken, hashToken, isWellFormedToken, generateUid, TOKEN_BYTES } from './tokens'

describe('generateToken', () => {
  it('produces url-safe base64url of the right length per scope', () => {
    expect(TOKEN_BYTES).toEqual({ join: 16, admin: 32, member: 16 })
    expect(generateToken('join')).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(generateToken('member')).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(generateToken('admin')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('is effectively unique across many draws', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateToken('join')))
    expect(set.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('is a deterministic 64-char hex sha256, distinct per token', async () => {
    const t = generateToken('admin')
    const h = await hashToken(t)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken(t)).toBe(h)
    expect(await hashToken(generateToken('admin'))).not.toBe(h)
  })
})

describe('isWellFormedToken', () => {
  it('accepts freshly generated tokens of the matching scope', () => {
    expect(isWellFormedToken(generateToken('join'), 'join')).toBe(true)
    expect(isWellFormedToken(generateToken('admin'), 'admin')).toBe(true)
  })
  it('rejects wrong length, wrong scope, and bad characters', () => {
    expect(isWellFormedToken(generateToken('join'), 'admin')).toBe(false) // 22 != 43
    expect(isWellFormedToken('short', 'join')).toBe(false)
    expect(isWellFormedToken('a'.repeat(22).replace('a', '+'), 'join')).toBe(false)
    expect(isWellFormedToken('!'.repeat(22), 'join')).toBe(false)
    expect(isWellFormedToken('', 'join')).toBe(false)
  })

  it('separates admin (43) from member (22) by length', () => {
    expect(isWellFormedToken(generateToken('admin'), 'member')).toBe(false)
    expect(isWellFormedToken(generateToken('member'), 'admin')).toBe(false)
  })

  it('does NOT distinguish join from member by shape — both are 16B/22ch', () => {
    // Equal-length scopes pass each other's shape check. The REAL join-vs-member
    // scope boundary is the hash lookup against the correct column (join_hash vs
    // member_hash), never this shape check. Documented here so it is not mistaken
    // for an authorization gate.
    expect(isWellFormedToken(generateToken('join'), 'member')).toBe(true)
    expect(isWellFormedToken(generateToken('member'), 'join')).toBe(true)
  })
})

describe('generateUid', () => {
  it('is a uuid', () => {
    expect(generateUid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})
