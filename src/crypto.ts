// Low-level cryptographic primitives, built on WebCrypto (`crypto.subtle`), which
// is available identically in the Workers runtime and in Node 20+ (vitest). No
// external deps. Everything here is pure given its inputs (modulo CSPRNG).
//
// Encodings used across the app:
//   - tokens (in URLs) and session tokens:   base64url, unpadded
//   - SHA-256 token hashes + IP hashes (DB):  lowercase hex
//   - PBKDF2 salt + derived bits (DB):        base64url, unpadded

const enc = new TextEncoder()

/** UTF-8 encode a string to bytes. */
export function utf8(s: string): Uint8Array {
  return enc.encode(s)
}

/** Cryptographically-secure random bytes. */
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** Lowercase hex encoding. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

/** base64url (unpadded) encode. */
export function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url (padded or unpadded) decode. Throws on invalid input. */
export function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function asBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? utf8(data) : data
}

/** SHA-256 digest. */
export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', asBytes(data))
  return new Uint8Array(buf)
}

/** SHA-256 digest as lowercase hex. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256(data))
}

/** HMAC-SHA256(key, data) → bytes. */
export async function hmacSha256(
  key: string | Uint8Array,
  data: string | Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    asBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, asBytes(data))
  return new Uint8Array(sig)
}

/** PBKDF2-HMAC-SHA256 derive `bits` bits from a password + salt. */
export async function pbkdf2(
  password: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
  bits: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', asBytes(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    bits,
  )
  return new Uint8Array(derived)
}

/**
 * Constant-time byte comparison. Returns false for unequal lengths (the length
 * of a hash/HMAC/derived-bits is not itself secret in our uses), and otherwise
 * compares every byte without short-circuiting.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Constant-time comparison of two equal-length encoded strings (hex/base64url). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(utf8(a), utf8(b))
}
