// vCard 3.0 builder (PLAN §10). vCard 3.0 chosen for broadest iOS/Android
// compatibility; multiple cards are concatenated. Phone-only on contact methods,
// email intentionally excluded. We escape per RFC 2426 (\, ; , and newlines),
// fold long lines to ≤75 octets, and emit CRLF line endings.

import { utf8 } from './crypto'

export interface VCardPhone {
  type?: string
  number: string
}

export interface VCardMember {
  uid: string
  fn: string
  given?: string | null
  family?: string | null
  nickname?: string | null
  phones: VCardPhone[]
  org?: string | null
  title?: string | null
  url?: string | null
  note?: string | null
  rev: string // ISO8601 (from member.updated_at)
}

/** Escape a vCard 3.0 TEXT value: backslash, newline, comma, semicolon. */
export function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

const SAFE_TYPE = /^[A-Za-z]+$/
function telType(t?: string): string {
  const up = (t ?? 'CELL').toUpperCase()
  return SAFE_TYPE.test(up) ? up : 'CELL'
}

/**
 * Fold a single logical line to ≤75 octets per physical line (RFC 2425 §5.8.1),
 * continuation lines beginning with a single space. UTF-8 aware — never splits a
 * multibyte code point.
 */
export function foldLine(line: string): string {
  if (utf8(line).length <= 75) return line
  let out = ''
  let lineBytes = 0
  let budget = 75 // first physical line
  for (const ch of line) {
    const chBytes = utf8(ch).length
    if (lineBytes + chBytes > budget) {
      out += '\r\n ' // fold marker: CRLF + leading space (the space costs 1 octet)
      lineBytes = 0
      budget = 74 // continuation content budget (75 − leading space)
    }
    out += ch
    lineBytes += chBytes
  }
  return out
}

function buildLines(m: VCardMember): string[] {
  const lines: string[] = []
  const family = (m.family ?? '').toString()
  const given = (m.given ?? '').toString()
  const fn = m.fn && m.fn.trim() ? m.fn : `${given} ${family}`.trim() || 'Unknown'

  lines.push('BEGIN:VCARD')
  lines.push('VERSION:3.0')
  // N: family;given;additional;prefix;suffix  — each component escaped separately.
  lines.push(foldLine(`N:${escapeText(family)};${escapeText(given)};;;`))
  lines.push(foldLine(`FN:${escapeText(fn)}`))
  if (m.nickname) lines.push(foldLine(`NICKNAME:${escapeText(m.nickname)}`))
  for (const p of m.phones) {
    if (!p || !p.number) continue
    lines.push(foldLine(`TEL;TYPE=${telType(p.type)}:${escapeText(p.number)}`))
  }
  if (m.org) lines.push(foldLine(`ORG:${escapeText(m.org)}`))
  if (m.title) lines.push(foldLine(`TITLE:${escapeText(m.title)}`))
  if (m.url) lines.push(foldLine(`URL:${escapeText(m.url)}`))
  if (m.note) lines.push(foldLine(`NOTE:${escapeText(m.note)}`))
  lines.push(foldLine(`UID:${escapeText(m.uid)}`))
  lines.push(foldLine(`REV:${escapeText(m.rev)}`))
  lines.push('END:VCARD')
  return lines
}

/** Build a single vCard 3.0 card (CRLF-joined, no trailing newline). */
export function buildVCard(m: VCardMember): string {
  return buildLines(m).join('\r\n')
}

/** Build a concatenated vCard document for many members (trailing CRLF). */
export function buildVCardCollection(members: VCardMember[]): string {
  if (members.length === 0) return ''
  return members.map(buildVCard).join('\r\n') + '\r\n'
}

/** ASCII-safe `.vcf` filename derived from a group name, for Content-Disposition. */
export function vcardFilename(groupName: string): string {
  const base =
    groupName
      .replace(/[^A-Za-z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40) || 'contacts'
  return `${base}.vcf`
}
