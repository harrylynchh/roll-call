import { describe, it, expect } from 'vitest'
import {
  issueSession,
  createSessionForGroup,
  verifySession,
  verifySessionForGroup,
  SESSION_TTL_SECONDS,
  issueVcardTicket,
  verifyVcardTicket,
  VCARD_TICKET_TTL_SECONDS,
} from './session'
import { utf8, hmacSha256, bytesToBase64url } from './crypto'

// Forge a token with a VALID signature over an arbitrary payload string, to probe
// the post-signature parsing guards (Number.isInteger, parts.length).
async function signPayload(secret: string, payload: string): Promise<string> {
  const p = bytesToBase64url(utf8(payload))
  const sig = bytesToBase64url(await hmacSha256(secret, p))
  return `${p}.${sig}`
}

const SECRET = 'unit-test-server-secret'
const NOW = 1_700_000_000 // fixed unix seconds

describe('issueSession / verifySession', () => {
  it('roundtrips claims and has the payload.signature shape', async () => {
    const token = await issueSession(SECRET, { groupId: 42, expiry: NOW + 100, passVersion: 3 })
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const claims = await verifySession(SECRET, token, { nowSeconds: NOW })
    expect(claims).toEqual({ groupId: 42, expiry: NOW + 100, passVersion: 3 })
  })

  it('rejects a tampered signature', async () => {
    const token = await issueSession(SECRET, { groupId: 1, expiry: NOW + 100, passVersion: 1 })
    const [payload, sig] = token.split('.')
    const flipped = sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A')
    expect(await verifySession(SECRET, `${payload}.${flipped}`, { nowSeconds: NOW })).toBeNull()
  })

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const token = await issueSession(SECRET, { groupId: 1, expiry: NOW + 100, passVersion: 1 })
    const sig = token.split('.')[1]
    const forgedPayload = btoa('999|9999999999|1').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifySession(SECRET, `${forgedPayload}.${sig}`, { nowSeconds: NOW })).toBeNull()
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await issueSession('other-secret', { groupId: 1, expiry: NOW + 100, passVersion: 1 })
    expect(await verifySession(SECRET, token, { nowSeconds: NOW })).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await issueSession(SECRET, { groupId: 1, expiry: NOW, passVersion: 1 })
    expect(await verifySession(SECRET, token, { nowSeconds: NOW })).toBeNull() // now >= expiry
    expect(await verifySession(SECRET, token, { nowSeconds: NOW - 1 })).not.toBeNull()
  })

  it('rejects malformed tokens without throwing', async () => {
    for (const bad of ['', 'nodot', 'a.', '.b', '@@@.@@@', 'a.b.c']) {
      expect(await verifySession(SECRET, bad, { nowSeconds: NOW })).toBeNull()
    }
  })
})

describe('verifySessionForGroup', () => {
  it('passes only when groupId AND passVersion match', async () => {
    const token = await createSessionForGroup(SECRET, 7, 2, NOW)
    expect(await verifySessionForGroup(SECRET, token, { groupId: 7, passVersion: 2, nowSeconds: NOW })).toBe(true)
    // wrong group
    expect(await verifySessionForGroup(SECRET, token, { groupId: 8, passVersion: 2, nowSeconds: NOW })).toBe(false)
    // passphrase changed -> pass_version bumped -> old session invalid
    expect(await verifySessionForGroup(SECRET, token, { groupId: 7, passVersion: 3, nowSeconds: NOW })).toBe(false)
  })

  it('default TTL is ~24h', async () => {
    const token = await createSessionForGroup(SECRET, 1, 1, NOW)
    const claims = await verifySession(SECRET, token, { nowSeconds: NOW })
    expect(claims!.expiry).toBe(NOW + SESSION_TTL_SECONDS)
  })

  it('passphrase change is a clean cutover: old rejected, new accepted, other groups untouched', async () => {
    const target = { groupId: 7, nowSeconds: NOW }
    const sessionOld = await createSessionForGroup(SECRET, 7, 1, NOW) // minted at passVersion 1
    // admin changes passphrase → group.pass_version becomes 2
    expect(await verifySessionForGroup(SECRET, sessionOld, { ...target, passVersion: 2 })).toBe(false)
    const sessionNew = await createSessionForGroup(SECRET, 7, 2, NOW) // re-unlocked at passVersion 2
    expect(await verifySessionForGroup(SECRET, sessionNew, { ...target, passVersion: 2 })).toBe(true)
    expect(await verifySessionForGroup(SECRET, sessionNew, { ...target, passVersion: 1 })).toBe(false)
    // a DIFFERENT group's session is unaffected by group 7's bump
    const otherGroup = await createSessionForGroup(SECRET, 9, 1, NOW)
    expect(await verifySessionForGroup(SECRET, otherGroup, { groupId: 9, passVersion: 1, nowSeconds: NOW })).toBe(true)
  })
})

describe('verifySession parsing guards (validly-signed but malformed payload)', () => {
  it('rejects non-integer / wrong-arity claims even with a correct signature', async () => {
    for (const payload of ['1|abc|1', '1|2', '1|2|3|4', 'x|1|1', '1|1|y']) {
      const token = await signPayload(SECRET, payload)
      expect(await verifySession(SECRET, token, { nowSeconds: 0 })).toBeNull()
    }
  })
})

describe('vcard download tickets', () => {
  it('roundtrips groupId/memberId/since and sets a short expiry', async () => {
    const tk = await issueVcardTicket(SECRET, { groupId: 5, memberId: 9, since: '', nowSeconds: NOW })
    const v = await verifyVcardTicket(SECRET, tk, { nowSeconds: NOW })
    expect(v).toEqual({ groupId: 5, memberId: 9, since: '', expiry: NOW + VCARD_TICKET_TTL_SECONDS })
  })

  it('preserves an ISO since cursor (special chars) intact', async () => {
    const since = '2026-06-07T19:00:00.000Z'
    const tk = await issueVcardTicket(SECRET, { groupId: 1, memberId: 1, since, nowSeconds: NOW })
    const v = await verifyVcardTicket(SECRET, tk, { nowSeconds: NOW })
    expect(v!.since).toBe(since)
  })

  it('expires after the TTL and rejects tamper / wrong secret', async () => {
    const tk = await issueVcardTicket(SECRET, { groupId: 1, memberId: 1, since: '', nowSeconds: NOW })
    expect(await verifyVcardTicket(SECRET, tk, { nowSeconds: NOW + VCARD_TICKET_TTL_SECONDS })).toBeNull()
    expect(await verifyVcardTicket('other', tk, { nowSeconds: NOW })).toBeNull()
    const [p, sig] = tk.split('.')
    const flipped = sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A')
    expect(await verifyVcardTicket(SECRET, `${p}.${flipped}`, { nowSeconds: NOW })).toBeNull()
  })

  it('does not accept a session token as a ticket (and vice-versa)', async () => {
    const session = await createSessionForGroup(SECRET, 7, 1, NOW)
    expect(await verifyVcardTicket(SECRET, session, { nowSeconds: NOW })).toBeNull()
    const ticket = await issueVcardTicket(SECRET, { groupId: 7, memberId: 1, since: '', nowSeconds: NOW })
    expect(await verifySession(SECRET, ticket, { nowSeconds: NOW })).toBeNull()
  })
})
