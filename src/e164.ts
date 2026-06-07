// E.164 phone normalization (PLAN §8 "validate phone to E.164"). Numbers are
// self-asserted — there is no SMS verification (an explicit non-goal) — so this
// is format hygiene + safe vCard rendering, not proof a number is real.
//
// Dependency-free on purpose: keeps the Worker bundle tiny and within the free
// CPU/startup budget. It is NOT full libphonenumber-style validation — it strips
// formatting, applies a default country for bare national numbers, and checks
// the canonical E.164 shape. Callers wanting another default country must have
// users type the leading "+". (Tradeoff noted in HANDOFF.)

export interface NormalizeOptions {
  /** Country assumed for a bare national number with no leading "+". */
  defaultCountry?: 'US'
}

// Canonical-ish E.164: leading "+", country code starts 1-9, 8–15 total digits.
// (Spec max is 15; we floor at 8 to reject obvious garbage like "+1".)
const E164_RE = /^\+[1-9]\d{7,14}$/

/** True if `s` is already a well-formed E.164 string. */
export function isE164(s: string): boolean {
  return E164_RE.test(s)
}

/**
 * Normalize a raw phone string to E.164, or return null if it can't be.
 * Handles common separators, the "00" international prefix, and US national
 * numbers (10 digits → +1, or 11 digits starting with 1).
 */
export function normalizePhone(raw: string, opts: NormalizeOptions = {}): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (s === '') return null

  // "00" international call prefix → "+"
  if (s.startsWith('00')) s = '+' + s.slice(2)

  const hasPlus = s.startsWith('+')
  const digits = s.replace(/\D/g, '')
  if (digits === '') return null

  let candidate: string
  if (hasPlus) {
    candidate = '+' + digits
  } else {
    const country = opts.defaultCountry ?? 'US'
    if (country === 'US' && digits.length === 10) {
      candidate = '+1' + digits
    } else if (country === 'US' && digits.length === 11 && digits.startsWith('1')) {
      candidate = '+' + digits
    } else {
      // Ambiguous without a country code — require the user to type "+".
      return null
    }
  }

  return isE164(candidate) ? candidate : null
}
