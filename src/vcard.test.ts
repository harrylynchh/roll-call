import { describe, it, expect } from 'vitest'
import {
  buildVCard,
  buildVCardCollection,
  escapeText,
  foldLine,
  vcardFilename,
  type VCardMember,
} from './vcard'

function member(overrides: Partial<VCardMember> = {}): VCardMember {
  return {
    uid: 'uid-123',
    fn: 'Ada Lovelace',
    given: 'Ada',
    family: 'Lovelace',
    phones: [{ type: 'CELL', number: '+15551234567' }],
    rev: '2026-06-07T12:00:00Z',
    ...overrides,
  }
}

describe('escapeText', () => {
  it('escapes backslash, comma, semicolon, and newlines', () => {
    expect(escapeText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
    expect(escapeText('line1\nline2')).toBe('line1\\nline2')
    expect(escapeText('crlf\r\nhere')).toBe('crlf\\nhere')
  })

  it('collapses a lone CR to an escaped newline', () => {
    expect(escapeText('a\rb')).toBe('a\\nb')
  })
})

describe('buildVCard', () => {
  it('emits a well-formed vCard 3.0 card with CRLF lines', () => {
    const v = buildVCard(member())
    const lines = v.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCARD')
    expect(lines[1]).toBe('VERSION:3.0')
    expect(v).toContain('N:Lovelace;Ada;;;')
    expect(v).toContain('FN:Ada Lovelace')
    expect(v).toContain('TEL;TYPE=CELL:+15551234567')
    expect(v).toContain('UID:uid-123')
    expect(v).toContain('REV:2026-06-07T12:00:00Z')
    expect(lines[lines.length - 1]).toBe('END:VCARD')
  })

  it('omits optional fields when absent and includes them when present', () => {
    expect(buildVCard(member())).not.toContain('NICKNAME')
    const full = buildVCard(
      member({ nickname: 'Countess', org: 'Analytical Engine', title: 'Programmer', url: 'https://ex.com', note: 'first' }),
    )
    expect(full).toContain('NICKNAME:Countess')
    expect(full).toContain('ORG:Analytical Engine')
    expect(full).toContain('TITLE:Programmer')
    expect(full).toContain('URL:https://ex.com')
    expect(full).toContain('NOTE:first')
  })

  it('renders multiple phones and sanitizes the TYPE param', () => {
    const v = buildVCard(
      member({ phones: [{ type: 'cell', number: '+15551110000' }, { type: 'we;ird', number: '+15552220000' }] }),
    )
    expect(v).toContain('TEL;TYPE=CELL:+15551110000') // lowercased -> upper
    expect(v).toContain('TEL;TYPE=CELL:+15552220000') // invalid type -> CELL fallback
  })

  it('escapes injection attempts in the display name', () => {
    const v = buildVCard(member({ fn: 'Evil\nEND:VCARD\nBEGIN:VCARD' }))
    // the newline is escaped, so no extra physical BEGIN/END is injected
    expect(v.split('\r\n').filter((l) => l === 'BEGIN:VCARD')).toHaveLength(1)
    expect(v.split('\r\n').filter((l) => l === 'END:VCARD')).toHaveLength(1)
    expect(v).toContain('FN:Evil\\nEND:VCARD\\nBEGIN:VCARD')
  })

  it('derives FN from given/family when fn is blank', () => {
    expect(buildVCard(member({ fn: '   ' }))).toContain('FN:Ada Lovelace')
  })

  it('escapes ; inside N components so they cannot inject extra structured fields', () => {
    const v = buildVCard(member({ family: 'Smith;EVIL', given: 'Bo;b', fn: 'X' }))
    expect(v).toContain('N:Smith\\;EVIL;Bo\\;b;;;')
    const nLine = v.split('\r\n').find((l) => l.startsWith('N:'))!
    // remove escaped \; then split on the structural ; — must be exactly 5 components
    const components = nLine.slice(2).replace(/\\;/g, '').split(';')
    expect(components).toHaveLength(5)
  })

  it('neutralizes CRLF/property injection in EVERY text field (not just FN)', () => {
    const payload = 'x\r\nEND:VCARD\r\nBEGIN:VCARD\r\nTEL;TYPE=CELL:+1900'
    const v = buildVCard(
      member({
        given: payload,
        family: payload,
        nickname: payload,
        org: payload,
        title: payload,
        url: payload,
        note: payload,
      }),
    )
    const lines = v.split('\r\n')
    expect(lines.filter((l) => l === 'BEGIN:VCARD')).toHaveLength(1)
    expect(lines.filter((l) => l === 'END:VCARD')).toHaveLength(1)
    // the smuggled "TEL;TYPE=CELL:+1900" must NOT become its own physical property
    // (continuation lines always start with a space, so they never match exactly)
    expect(lines.filter((l) => l === 'TEL;TYPE=CELL:+1900')).toHaveLength(0)
    // unfold (strip fold markers) then confirm the CRLF was collapsed to literal \n
    expect(v.replace(/\r\n /g, '')).toContain('\\nEND:VCARD\\nBEGIN:VCARD')
  })

  it('neutralizes injection inside a phone number too', () => {
    const v = buildVCard(
      member({ phones: [{ type: 'CELL', number: '+1555\r\nTEL;TYPE=CELL:+1900' }] }),
    )
    const telLines = v.split('\r\n').filter((l) => l.startsWith('TEL;'))
    expect(telLines).toHaveLength(1) // exactly one TEL property, no injected second one
  })
})

describe('foldLine', () => {
  it('keeps short lines intact', () => {
    expect(foldLine('NOTE:short')).toBe('NOTE:short')
  })
  it('folds long lines to <=75 octets per physical line', () => {
    const long = 'NOTE:' + 'x'.repeat(300)
    const folded = foldLine(long)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    for (const p of physical) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    }
    // continuation lines start with a single space
    for (let i = 1; i < physical.length; i++) expect(physical[i]!.startsWith(' ')).toBe(true)
    // unfolding (strip CRLF + leading space) restores the original
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })
})

describe('buildVCardCollection', () => {
  it('concatenates cards and ends with CRLF; empty -> empty string', () => {
    expect(buildVCardCollection([])).toBe('')
    const doc = buildVCardCollection([member({ uid: 'a' }), member({ uid: 'b' })])
    expect(doc.split('BEGIN:VCARD').length - 1).toBe(2)
    expect(doc.endsWith('\r\n')).toBe(true)
  })
})

describe('vcardFilename', () => {
  it('sanitizes to an ASCII .vcf name with a fallback', () => {
    expect(vcardFilename('Summer Interns 2026')).toBe('Summer_Interns_2026.vcf')
    expect(vcardFilename('!!!')).toBe('contacts.vcf')
    expect(vcardFilename('a'.repeat(100))).toBe('a'.repeat(40) + '.vcf')
  })
})
