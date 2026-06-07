// Encrypt the join token so ONLY the admin (who holds the admin token) can
// recover and re-share the join link (PLAN §4). AES-256-GCM under a key derived
// from the admin token. The key is never stored — a DB dump holds only the
// ciphertext + admin_hash, neither of which yields the key — so the "a dump
// yields no working links" guarantee is preserved.

import { sha256, randomBytes, utf8, bytesToBase64url, base64urlToBytes } from './crypto'

const KEY_CONTEXT = 'rc-joinkey-v1|'
const IV_BYTES = 12

async function deriveKey(adminToken: string): Promise<CryptoKey> {
  // adminToken is a 256-bit CSPRNG value, so a single SHA-256 (with a domain
  // separation prefix) is a sound way to obtain a uniform 256-bit AES key.
  const keyBytes = await sha256(KEY_CONTEXT + adminToken)
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Encrypt a join token under the admin token → base64url(iv ‖ ciphertext+tag). */
export async function encryptJoinToken(joinToken: string, adminToken: string): Promise<string> {
  const key = await deriveKey(adminToken)
  const iv = randomBytes(IV_BYTES)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(joinToken)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return bytesToBase64url(out)
}

/** Decrypt with the admin token; returns null if absent, wrong key, or tampered. */
export async function decryptJoinToken(blob: string, adminToken: string): Promise<string | null> {
  try {
    const data = base64urlToBytes(blob)
    if (data.length <= IV_BYTES) return null
    const iv = data.subarray(0, IV_BYTES)
    const ct = data.subarray(IV_BYTES)
    const key = await deriveKey(adminToken)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}
