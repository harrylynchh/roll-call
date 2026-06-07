// Stateless session tokens (PLAN §8). Issued after a correct passphrase so the
// passphrase is entered once, not per action. Format:
//
//     base64url(payload) "." base64url(HMAC-SHA256(SERVER_SECRET, base64url(payload)))
//     payload = "<groupId>|<expiry>|<passVersion>"   (expiry = unix seconds)
//
// Verified statelessly on every gated request: recompute the HMAC, constant-time
// compare, check expiry, then the caller confirms groupId + passVersion match the
// target group. Bumping a group's pass_version (admin changes/clears the
// passphrase) invalidates every outstanding session for that group.

import { utf8, hmacSha256, bytesToBase64url, base64urlToBytes, timingSafeEqual } from './crypto'

export const SESSION_TTL_SECONDS = 24 * 60 * 60 // ~24h

export interface SessionClaims {
  groupId: number
  expiry: number // unix seconds
  passVersion: number
}

const dec = new TextDecoder()

/** Issue a signed session token for the given claims. */
export async function issueSession(secret: string, claims: SessionClaims): Promise<string> {
  const payload = `${claims.groupId}|${claims.expiry}|${claims.passVersion}`
  const payloadB64 = bytesToBase64url(utf8(payload))
  const sig = await hmacSha256(secret, payloadB64)
  return `${payloadB64}.${bytesToBase64url(sig)}`
}

/** Convenience: issue a session for a group that expires `ttl` seconds from now. */
export function createSessionForGroup(
  secret: string,
  groupId: number,
  passVersion: number,
  nowSeconds: number,
  ttl: number = SESSION_TTL_SECONDS,
): Promise<string> {
  return issueSession(secret, { groupId, passVersion, expiry: nowSeconds + ttl })
}

/**
 * Verify signature + expiry and return the claims, or null if the token is
 * malformed, tampered, or expired. Never throws. Does NOT check that the claims
 * match a particular group — use verifySessionForGroup for that.
 */
export async function verifySession(
  secret: string,
  token: string,
  opts: { nowSeconds: number },
): Promise<SessionClaims | null> {
  if (typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let providedSig: Uint8Array
  try {
    providedSig = base64urlToBytes(sigB64)
  } catch {
    return null
  }
  const expectedSig = await hmacSha256(secret, payloadB64)
  if (!timingSafeEqual(providedSig, expectedSig)) return null

  let payloadStr: string
  try {
    payloadStr = dec.decode(base64urlToBytes(payloadB64))
  } catch {
    return null
  }
  const parts = payloadStr.split('|')
  if (parts.length !== 3) return null
  const groupId = Number(parts[0])
  const expiry = Number(parts[1])
  const passVersion = Number(parts[2])
  if (!Number.isInteger(groupId) || !Number.isInteger(expiry) || !Number.isInteger(passVersion)) {
    return null
  }
  if (opts.nowSeconds >= expiry) return null
  return { groupId, expiry, passVersion }
}

/**
 * Full gate used by routes: a valid, unexpired session whose claims match the
 * target group's id AND current pass_version. Returns true only if all hold.
 */
export async function verifySessionForGroup(
  secret: string,
  token: string,
  target: { groupId: number; passVersion: number; nowSeconds: number },
): Promise<boolean> {
  const claims = await verifySession(secret, token, { nowSeconds: target.nowSeconds })
  return claims !== null && claims.groupId === target.groupId && claims.passVersion === target.passVersion
}
