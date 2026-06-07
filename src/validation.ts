// Request-body validation/normalization at the API boundary. Pure + unit-tested.
// Bounds every string (CLAUDE.md), normalizes phones to E.164, derives the vCard
// FN, and caps phones per the locked decision (up to 2). Rejects rather than
// silently truncates, so nothing is quietly lost.

import { normalizePhone } from './e164'
import { isAcceptablePassphrase } from './passphrase'

export const FIELD_LIMITS = {
  name: 80,
  fn: 80,
  given: 40,
  family: 40,
  nickname: 40,
  org: 80,
  title: 80,
  url: 200,
  note: 500,
} as const

export const PHONE_CAP = 2 // locked decision: up to 2 per member

export interface MemberInput {
  givenName: string | null
  familyName: string | null
  fn: string
  nickname: string | null
  phonesJson: string
  org: string | null
  title: string | null
  url: string | null
  note: string | null
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function sanitizeType(v: unknown): string {
  const up = (typeof v === 'string' ? v : 'CELL').toUpperCase()
  return /^[A-Z]{1,12}$/.test(up) ? up : 'CELL'
}

/** Parse the create-group body. */
export function parseCreate(
  body: unknown,
): Result<{ name: string; passphrase: string; turnstileToken: string }> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid body' }
  const b = body as Record<string, unknown>
  const name = trimStr(b.name)
  if (!name) return { ok: false, error: 'name required' }
  if (name.length > FIELD_LIMITS.name) return { ok: false, error: 'name too long' }
  if (!isAcceptablePassphrase(b.passphrase)) return { ok: false, error: 'passphrase required' }
  const turnstileToken =
    typeof b.turnstileToken === 'string'
      ? b.turnstileToken
      : typeof b['cf-turnstile-response'] === 'string'
        ? (b['cf-turnstile-response'] as string)
        : ''
  return { ok: true, value: { name, passphrase: b.passphrase as string, turnstileToken } }
}

/** Parse + normalize a member submission (add or edit). */
export function parseMember(body: unknown): Result<MemberInput> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid body' }
  const b = body as Record<string, unknown>

  // phones: array of strings or {type, number}
  const rawPhones = Array.isArray(b.phones) ? b.phones : []
  if (rawPhones.length === 0) return { ok: false, error: 'at least one phone is required' }
  if (rawPhones.length > PHONE_CAP) return { ok: false, error: `at most ${PHONE_CAP} phones` }
  const phones: { type: string; number: string }[] = []
  for (const p of rawPhones) {
    const raw = typeof p === 'string' ? p : ((p as Record<string, unknown>)?.number ?? '')
    const number = normalizePhone(typeof raw === 'string' ? raw : '')
    if (!number) return { ok: false, error: 'invalid phone number' }
    const type = sanitizeType(typeof p === 'object' && p ? (p as Record<string, unknown>).type : undefined)
    phones.push({ type, number })
  }

  const given = trimStr(b.givenName)
  const family = trimStr(b.familyName)
  const fnRaw = trimStr(b.fn)
  if (given.length > FIELD_LIMITS.given || family.length > FIELD_LIMITS.family || fnRaw.length > FIELD_LIMITS.fn) {
    return { ok: false, error: 'name too long' }
  }
  const fn = fnRaw || `${given} ${family}`.trim()
  if (!fn) return { ok: false, error: 'a name is required' }

  const nickname = trimStr(b.nickname)
  const org = trimStr(b.org)
  const title = trimStr(b.title)
  const url = trimStr(b.url)
  const note = trimStr(b.note)
  if (
    nickname.length > FIELD_LIMITS.nickname ||
    org.length > FIELD_LIMITS.org ||
    title.length > FIELD_LIMITS.title ||
    url.length > FIELD_LIMITS.url ||
    note.length > FIELD_LIMITS.note
  ) {
    return { ok: false, error: 'a field is too long' }
  }
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: 'url must start with http(s)://' }

  return {
    ok: true,
    value: {
      givenName: given || null,
      familyName: family || null,
      fn,
      nickname: nickname || null,
      phonesJson: JSON.stringify(phones),
      org: org || null,
      title: title || null,
      url: url || null,
      note: note || null,
    },
  }
}

/** Parse an admin PATCH body (rename and/or change passphrase). */
export function parseAdminPatch(
  body: unknown,
): Result<{ name?: string; passphrase?: string }> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid body' }
  const b = body as Record<string, unknown>
  const out: { name?: string; passphrase?: string } = {}
  if (b.name !== undefined) {
    const name = trimStr(b.name)
    if (!name || name.length > FIELD_LIMITS.name) return { ok: false, error: 'invalid name' }
    out.name = name
  }
  if (b.passphrase !== undefined) {
    if (!isAcceptablePassphrase(b.passphrase)) return { ok: false, error: 'invalid passphrase' }
    out.passphrase = b.passphrase as string
  }
  if (out.name === undefined && out.passphrase === undefined) {
    return { ok: false, error: 'nothing to update' }
  }
  return { ok: true, value: out }
}
