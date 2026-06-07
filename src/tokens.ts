// Capability tokens (PLAN §2, §4). Three independent scopes — join / admin /
// member — each an unguessable CSPRNG value carried in a URL. We store ONLY
// SHA-256(token) (hex) in D1 and look up by that hash, so a DB dump yields no
// working links. Raw tokens never touch the database or logs.

import { randomBytes, bytesToBase64url, sha256Hex } from './crypto'

export type TokenKind = 'join' | 'admin' | 'member'

/** Token entropy per scope. Admin is doubled — it is the most powerful scope. */
export const TOKEN_BYTES: Record<TokenKind, number> = {
  join: 16, // 128-bit
  admin: 32, // 256-bit
  member: 16, // 128-bit
}

// Exact unpadded-base64url length for N random bytes = ceil(N*8 / 6).
const TOKEN_LEN: Record<TokenKind, number> = {
  join: 22, // 16 bytes
  admin: 43, // 32 bytes
  member: 22, // 16 bytes
}

const BASE64URL_CHAR = /^[A-Za-z0-9_-]+$/

/** Generate a fresh raw token (base64url, unpadded) for the given scope. */
export function generateToken(kind: TokenKind): string {
  return bytesToBase64url(randomBytes(TOKEN_BYTES[kind]))
}

/** SHA-256(token) as lowercase hex — the value stored in / looked up from D1. */
export function hashToken(token: string): Promise<string> {
  return sha256Hex(token)
}

/**
 * Cheap shape check so routes can reject obviously-malformed tokens BEFORE a DB
 * lookup. Callers must still return the SAME generic 404 for malformed and for
 * well-formed-but-unknown tokens — this is only an optimisation / input bound,
 * never an enumeration oracle.
 */
export function isWellFormedToken(token: string, kind: TokenKind): boolean {
  return token.length === TOKEN_LEN[kind] && BASE64URL_CHAR.test(token)
}

/** Stable, random vCard UID for a member (PLAN §10). */
export function generateUid(): string {
  return crypto.randomUUID()
}
