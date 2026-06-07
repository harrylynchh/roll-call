// Per-group passphrase (PLAN §8). PBKDF2-HMAC-SHA256 via WebCrypto, per-group
// random salt, iteration count stored per group, constant-time compare. The
// plaintext is NEVER stored, logged, or echoed — it travels only in the /unlock
// POST body. Backed by the 128-bit join link + a tight /unlock attempt limit, so
// it does not need extreme KDF hardening; iterations are tuned to fit the 10ms
// CPU/req free budget (measure with `wrangler tail`).

import { pbkdf2, randomBytes, bytesToBase64url, base64urlToBytes, timingSafeEqual } from './crypto'

/** Starting point; tune against the 10ms CPU budget after measuring (PLAN §3, §8). */
export const DEFAULT_PBKDF2_ITERS = 100_000
const SALT_BYTES = 16
const DERIVED_BITS = 256

export const MIN_PASSPHRASE_LEN = 1
export const MAX_PASSPHRASE_LEN = 200

/** Stored passphrase material for a group (all base64url; never the plaintext). */
export interface PassRecord {
  hash: string
  salt: string
  iters: number
}

/** Normalize so the same human passphrase matches regardless of OS/IME encoding. */
function normalize(passphrase: string): string {
  return passphrase.normalize('NFC')
}

/**
 * Validate a candidate passphrase at the API boundary. "Always required" ⇒ must
 * be non-empty (after trimming) and within length bounds. We hash the RAW
 * (NFC-normalized) value, not the trimmed one, so surrounding characters are
 * preserved — trimming is only for the emptiness check.
 */
export function isAcceptablePassphrase(passphrase: unknown): passphrase is string {
  return (
    typeof passphrase === 'string' &&
    passphrase.length >= MIN_PASSPHRASE_LEN &&
    passphrase.length <= MAX_PASSPHRASE_LEN &&
    passphrase.trim().length > 0
  )
}

/** Hash a passphrase into a fresh {hash, salt, iters} record. */
export async function hashPassphrase(
  passphrase: string,
  opts?: { salt?: Uint8Array; iters?: number },
): Promise<PassRecord> {
  const salt = opts?.salt ?? randomBytes(SALT_BYTES)
  const iters = opts?.iters ?? DEFAULT_PBKDF2_ITERS
  const derived = await pbkdf2(normalize(passphrase), salt, iters, DERIVED_BITS)
  return { hash: bytesToBase64url(derived), salt: bytesToBase64url(salt), iters }
}

/** Constant-time verify a passphrase against a stored record. */
export async function verifyPassphrase(passphrase: string, rec: PassRecord): Promise<boolean> {
  const salt = base64urlToBytes(rec.salt)
  const derived = await pbkdf2(normalize(passphrase), salt, rec.iters, DERIVED_BITS)
  return timingSafeEqual(derived, base64urlToBytes(rec.hash))
}
