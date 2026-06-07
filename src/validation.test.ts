import { describe, it, expect } from 'vitest'
import { parseCreate, parseMember, parseAdminPatch, FIELD_LIMITS, PHONE_CAP } from './validation'

describe('parseCreate', () => {
  it('accepts a valid create body and surfaces the turnstile token', () => {
    const r = parseCreate({ name: '  Summer Interns  ', passphrase: 'let me in', turnstileToken: 'tok' })
    expect(r).toEqual({ ok: true, value: { name: 'Summer Interns', passphrase: 'let me in', turnstileToken: 'tok' } })
  })
  it('reads the cf-turnstile-response field name too', () => {
    const r = parseCreate({ name: 'G', passphrase: 'pw', 'cf-turnstile-response': 'abc' })
    expect(r.ok && r.value.turnstileToken).toBe('abc')
  })
  it('rejects missing name, too-long name, and missing/empty passphrase', () => {
    expect(parseCreate({ passphrase: 'pw' }).ok).toBe(false)
    expect(parseCreate({ name: 'a'.repeat(FIELD_LIMITS.name + 1), passphrase: 'pw' }).ok).toBe(false)
    expect(parseCreate({ name: 'G' }).ok).toBe(false)
    expect(parseCreate({ name: 'G', passphrase: '   ' }).ok).toBe(false)
    expect(parseCreate(null).ok).toBe(false)
  })
})

describe('parseMember', () => {
  it('normalizes phones, derives FN, and drops empty optionals', () => {
    const r = parseMember({ givenName: 'Ada', familyName: 'Lovelace', phones: ['(555) 123-4567'], note: '' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.fn).toBe('Ada Lovelace')
    expect(r.value.note).toBeNull()
    expect(JSON.parse(r.value.phonesJson)).toEqual([{ type: 'CELL', number: '+15551234567' }])
  })

  it('accepts {type, number} phone objects and sanitizes the type', () => {
    const r = parseMember({ fn: 'X', phones: [{ type: 'we;ird', number: '+15551234567' }] })
    expect(r.ok && JSON.parse(r.value.phonesJson)[0].type).toBe('CELL')
  })

  it('requires at least one valid phone and caps the count', () => {
    expect(parseMember({ fn: 'X', phones: [] }).ok).toBe(false)
    expect(parseMember({ fn: 'X', phones: ['nope'] }).ok).toBe(false)
    expect(parseMember({ fn: 'X', phones: ['+15551234567', '+15551112222', '+15553334444'] }).ok).toBe(false)
    expect(PHONE_CAP).toBe(2)
  })

  it('requires a name (fn or given/family)', () => {
    expect(parseMember({ phones: ['+15551234567'] }).ok).toBe(false)
    expect(parseMember({ givenName: 'Solo', phones: ['+15551234567'] }).ok).toBe(true)
  })

  it('rejects over-long fields and non-http urls', () => {
    expect(parseMember({ fn: 'a'.repeat(FIELD_LIMITS.fn + 1), phones: ['+15551234567'] }).ok).toBe(false)
    expect(parseMember({ fn: 'X', note: 'n'.repeat(FIELD_LIMITS.note + 1), phones: ['+15551234567'] }).ok).toBe(false)
    expect(parseMember({ fn: 'X', url: 'javascript:alert(1)', phones: ['+15551234567'] }).ok).toBe(false)
    expect(parseMember({ fn: 'X', url: 'https://ok.com', phones: ['+15551234567'] }).ok).toBe(true)
  })
})

describe('parseAdminPatch', () => {
  it('accepts rename, passphrase change, or both; rejects empty', () => {
    expect(parseAdminPatch({ name: 'New' })).toEqual({ ok: true, value: { name: 'New' } })
    expect(parseAdminPatch({ passphrase: 'fresh one' }).ok).toBe(true)
    expect(parseAdminPatch({ name: 'New', passphrase: 'fresh one' }).ok).toBe(true)
    expect(parseAdminPatch({}).ok).toBe(false)
    expect(parseAdminPatch({ name: '   ' }).ok).toBe(false)
    expect(parseAdminPatch({ passphrase: '  ' }).ok).toBe(false)
  })
})
