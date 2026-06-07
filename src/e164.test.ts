import { describe, it, expect } from 'vitest'
import { normalizePhone, isE164 } from './e164'

describe('isE164', () => {
  it('accepts canonical numbers and rejects malformed', () => {
    expect(isE164('+15551234567')).toBe(true)
    expect(isE164('+442079460958')).toBe(true)
    expect(isE164('5551234567')).toBe(false) // no +
    expect(isE164('+1')).toBe(false) // too short
    expect(isE164('+0123456789')).toBe(false) // country code starts with 0
  })
})

describe('normalizePhone', () => {
  it('passes through valid E.164', () => {
    expect(normalizePhone('+15551234567')).toBe('+15551234567')
  })

  it('formats US national numbers (default country)', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567')
    expect(normalizePhone('555.123.4567')).toBe('+15551234567')
    expect(normalizePhone('5551234567')).toBe('+15551234567')
    expect(normalizePhone('1 555 123 4567')).toBe('+15551234567')
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567')
  })

  it('handles international with + and the 00 prefix', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
    expect(normalizePhone('00442079460958')).toBe('+442079460958')
  })

  it('rejects garbage, empty, and ambiguous bare numbers', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('+1')).toBeNull()
    expect(normalizePhone('12345')).toBeNull() // ambiguous, not 10/11-digit US
    // @ts-expect-error runtime guard for non-string
    expect(normalizePhone(null)).toBeNull()
  })

  it('leniently collapses stray separators / repeated +', () => {
    expect(normalizePhone('++1-555-123-4567')).toBe('+15551234567')
  })

  it('enforces the 15-digit E.164 ceiling', () => {
    expect(isE164('+' + '1'.repeat(15))).toBe(true) // 15 digits OK
    expect(isE164('+' + '1'.repeat(16))).toBe(false) // 16 digits rejected
    // an absurdly long digit run must not pass through as a giant TEL value
    expect(normalizePhone('+' + '9'.repeat(40))).toBeNull()
    expect(normalizePhone('9'.repeat(40))).toBeNull()
  })
})
