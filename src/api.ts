// Roll Call API — Hono app mounted at /api by the Pages Function
// (functions/api/[[route]].ts). Thin handlers over the tested security modules.
//
// Auth surfaces (PLAN §2, §6):
//   - join token   → in the URL path (/groups/:joinToken/...)
//   - session      → header `X-Session-Token` (issued by /unlock; gates add/vcard)
//   - member token → header `X-Member-Token` for vcard reciprocity; URL path for
//                     /members/:memberToken self-edit/delete
//   - admin token  → URL path (/admin/:adminToken/...)
// Every unknown/malformed token yields an identical generic 404 (no oracle).
// Never logs a token, session, or passphrase.

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, GroupRow, MemberRow } from './types'
import {
  insertGroup,
  getGroupByJoinHash,
  getGroupByAdminHash,
  countMembers,
  insertMember,
  getMemberByHash,
  updateMember,
  deleteMember,
  deleteMemberInGroup,
  listMembers,
  renameGroup,
  changePassphrase,
  deleteGroup,
  touchGroup,
} from './db'
import { generateToken, hashToken, isWellFormedToken, generateUid } from './tokens'
import { hashPassphrase, verifyPassphrase, type PassRecord } from './passphrase'
import { createSessionForGroup, verifySessionForGroup, SESSION_TTL_SECONDS } from './session'
import { checkRateLimit, RULES, MEMBER_CAP, hashIp } from './ratelimit'
import { buildVCardCollection, vcardFilename, type VCardMember } from './vcard'
import { parseCreate, parseMember, parseAdminPatch } from './validation'
import { verifyTurnstile } from './turnstile'
import { encryptJoinToken, decryptJoinToken } from './joinlink'

type Ctx = Context<{ Bindings: Env }>

const app = new Hono<{ Bindings: Env }>().basePath('/api')

// ---- cross-cutting -----------------------------------------------------------

app.use('*', async (c, next) => {
  await next()
  const h = c.res.headers
  h.set('Referrer-Policy', 'no-referrer')
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  h.set('Cache-Control', 'no-store')
})

app.onError((_err, c) => c.json({ error: 'internal_error' }, 500))
app.notFound((c) => c.json({ error: 'not_found' }, 404))

// ---- helpers -----------------------------------------------------------------

const generic404 = (c: Ctx) => c.json({ error: 'not_found' }, 404)
const nowS = () => Math.floor(Date.now() / 1000)
const nowIso = () => new Date().toISOString()
const origin = (c: Ctx) => new URL(c.req.url).origin
const clientIp = (c: Ctx) => c.req.header('CF-Connecting-IP') || '0.0.0.0'
const ipHashOf = (c: Ctx, ip: string) => hashIp(ip, c.env.SERVER_SECRET, Date.now())

function passRecord(g: GroupRow): PassRecord | null {
  return g.pass_hash && g.pass_salt && g.pass_iters
    ? { hash: g.pass_hash, salt: g.pass_salt, iters: g.pass_iters }
    : null
}

async function requireSession(c: Ctx, group: GroupRow): Promise<boolean> {
  const token = c.req.header('X-Session-Token') || ''
  return verifySessionForGroup(c.env.SERVER_SECRET, token, {
    groupId: group.id,
    passVersion: group.pass_version,
    nowSeconds: nowS(),
  })
}

function parsePhones(json: string): { type: string; number: string }[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function toVCardMember(m: MemberRow): VCardMember {
  return {
    uid: m.uid,
    fn: m.fn,
    given: m.given_name,
    family: m.family_name,
    nickname: m.nickname,
    phones: parsePhones(m.phones),
    org: m.org,
    title: m.title,
    url: m.url,
    note: m.note,
    rev: m.updated_at,
  }
}

function sanitizeSince(v: string | undefined): string | null {
  if (!v) return null
  // We compare updated_at lexically (ISO8601 sorts correctly); guard the shape.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(v) ? v : null
}

// ---- public config -----------------------------------------------------------

app.get('/config', (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITEKEY }))

// ---- create group ------------------------------------------------------------

app.post('/groups', async (c) => {
  const ip = clientIp(c)
  const parsed = parseCreate(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: 'invalid_request', detail: parsed.error }, 400)

  const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET, parsed.value.turnstileToken, ip)
  if (!ok) return c.json({ error: 'turnstile_failed' }, 403)

  const ipHash = await ipHashOf(c, ip)
  const rl = await checkRateLimit(c.env.DB, RULES.create, ipHash, Date.now())
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429)

  const joinToken = generateToken('join')
  const adminToken = generateToken('admin')
  const [joinHash, adminHash, pass, joinEnc] = await Promise.all([
    hashToken(joinToken),
    hashToken(adminToken),
    hashPassphrase(parsed.value.passphrase),
    encryptJoinToken(joinToken, adminToken), // lets the admin re-share the link later
  ])
  const ts = nowIso()
  await insertGroup(c.env.DB, {
    joinHash,
    adminHash,
    name: parsed.value.name,
    pass,
    nowIso: ts,
    creatorIpHash: ipHash,
    joinEnc,
  })

  const o = origin(c)
  return c.json(
    {
      name: parsed.value.name,
      join: { token: joinToken, url: `${o}/g/${joinToken}` },
      admin: { token: adminToken, url: `${o}/a/${adminToken}` },
    },
    201,
  )
})

// ---- group metadata ----------------------------------------------------------

app.get('/groups/:joinToken', async (c) => {
  const t = c.req.param('joinToken')
  if (!isWellFormedToken(t, 'join')) return generic404(c)
  const group = await getGroupByJoinHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)
  const memberCount = await countMembers(c.env.DB, group.id)
  return c.json({ name: group.name, memberCount, passphraseRequired: group.pass_hash !== null })
})

// ---- unlock (passphrase → session) ------------------------------------------

app.post('/groups/:joinToken/unlock', async (c) => {
  const t = c.req.param('joinToken')
  if (!isWellFormedToken(t, 'join')) return generic404(c)
  const group = await getGroupByJoinHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)

  // Brute-force defense: rate-limit per group BEFORE verifying.
  const ipHash = await ipHashOf(c, clientIp(c))
  const rl = await checkRateLimit(c.env.DB, RULES.unlock, ipHash, Date.now(), group.id)
  if (!rl.allowed) return c.json({ error: 'too_many_attempts' }, 429)

  const body = (await c.req.json().catch(() => null)) as { passphrase?: unknown } | null
  const passphrase = body && typeof body.passphrase === 'string' ? body.passphrase : ''
  const rec = passRecord(group)
  const valid = rec ? await verifyPassphrase(passphrase, rec) : false
  if (!valid) return c.json({ error: 'invalid_passphrase' }, 401)

  const session = await createSessionForGroup(c.env.SERVER_SECRET, group.id, group.pass_version, nowS())
  return c.json({ session, expiresInSeconds: SESSION_TTL_SECONDS })
})

// ---- add self ----------------------------------------------------------------

app.post('/groups/:joinToken/members', async (c) => {
  const t = c.req.param('joinToken')
  if (!isWellFormedToken(t, 'join')) return generic404(c)
  const group = await getGroupByJoinHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)
  if (!(await requireSession(c, group))) return c.json({ error: 'unauthorized' }, 401)

  const ipHash = await ipHashOf(c, clientIp(c))
  const rl = await checkRateLimit(c.env.DB, RULES.addMember, ipHash, Date.now())
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429)

  // Member cap (server-enforced; small TOCTOU race is acceptable for abuse cap).
  if ((await countMembers(c.env.DB, group.id)) >= MEMBER_CAP) {
    return c.json({ error: 'group_full' }, 409)
  }

  const parsed = parseMember(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: 'invalid_request', detail: parsed.error }, 400)

  const memberToken = generateToken('member')
  const memberHash = await hashToken(memberToken)
  const uid = generateUid()
  const ts = nowIso()
  const v = parsed.value
  await insertMember(c.env.DB, {
    groupId: group.id,
    memberHash,
    uid,
    givenName: v.givenName,
    familyName: v.familyName,
    fn: v.fn,
    nickname: v.nickname,
    phonesJson: v.phonesJson,
    org: v.org,
    title: v.title,
    url: v.url,
    note: v.note,
    nowIso: ts,
  })
  await touchGroup(c.env.DB, group.id, ts)
  return c.json({ memberToken, uid }, 201)
})

// ---- vcard (session + reciprocity + delta) ----------------------------------

app.get('/groups/:joinToken/vcard', async (c) => {
  const t = c.req.param('joinToken')
  if (!isWellFormedToken(t, 'join')) return generic404(c)
  const group = await getGroupByJoinHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)
  if (!(await requireSession(c, group))) return c.json({ error: 'unauthorized' }, 401)

  // Reciprocity: the requester must hold a member token belonging to THIS group.
  const mt = c.req.header('X-Member-Token') || ''
  if (!isWellFormedToken(mt, 'member')) return c.json({ error: 'reciprocity_required' }, 403)
  const requester = await getMemberByHash(c.env.DB, await hashToken(mt))
  if (!requester || requester.group_id !== group.id) {
    return c.json({ error: 'reciprocity_required' }, 403)
  }

  const ipHash = await ipHashOf(c, clientIp(c))
  const rl = await checkRateLimit(c.env.DB, RULES.vcard, ipHash, Date.now())
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429)

  const since = sanitizeSince(c.req.query('since'))
  const { results } = await listMembers(c.env.DB, group.id, since)
  const vcf = buildVCardCollection(results.map(toVCardMember))
  return new Response(vcf, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `attachment; filename="${vcardFilename(group.name)}"`,
    },
  })
})

// ---- member self edit / delete ----------------------------------------------

app.patch('/members/:memberToken', async (c) => {
  const t = c.req.param('memberToken')
  if (!isWellFormedToken(t, 'member')) return generic404(c)
  const member = await getMemberByHash(c.env.DB, await hashToken(t))
  if (!member) return generic404(c)

  const parsed = parseMember(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: 'invalid_request', detail: parsed.error }, 400)

  const ts = nowIso()
  const v = parsed.value
  await updateMember(c.env.DB, member.id, {
    givenName: v.givenName,
    familyName: v.familyName,
    fn: v.fn,
    nickname: v.nickname,
    phonesJson: v.phonesJson,
    org: v.org,
    title: v.title,
    url: v.url,
    note: v.note,
    nowIso: ts,
  })
  await touchGroup(c.env.DB, member.group_id, ts)
  return c.json({ ok: true, uid: member.uid })
})

app.delete('/members/:memberToken', async (c) => {
  const t = c.req.param('memberToken')
  if (!isWellFormedToken(t, 'member')) return generic404(c)
  const member = await getMemberByHash(c.env.DB, await hashToken(t))
  if (!member) return generic404(c)
  await deleteMember(c.env.DB, member.id)
  await touchGroup(c.env.DB, member.group_id, nowIso())
  return c.json({ ok: true })
})

// ---- admin -------------------------------------------------------------------

app.get('/admin/:adminToken', async (c) => {
  const t = c.req.param('adminToken')
  if (!isWellFormedToken(t, 'admin')) return generic404(c)
  const group = await getGroupByAdminHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)
  const { results } = await listMembers(c.env.DB, group.id, null)

  // Re-share: recover the join link by decrypting with the admin token from the
  // URL. Null for groups created before join_enc existed, or if decryption fails.
  let join: { url: string } | null = null
  if (group.join_enc) {
    const joinToken = await decryptJoinToken(group.join_enc, t)
    if (joinToken) join = { url: `${origin(c)}/g/${joinToken}` }
  }

  return c.json({
    name: group.name,
    passphraseRequired: group.pass_hash !== null,
    createdAt: group.created_at,
    join,
    members: results.map((m) => ({
      id: m.id,
      fn: m.fn,
      givenName: m.given_name,
      familyName: m.family_name,
      nickname: m.nickname,
      phones: parsePhones(m.phones),
      org: m.org,
      title: m.title,
      url: m.url,
      note: m.note,
      updatedAt: m.updated_at,
    })),
  })
})

app.patch('/admin/:adminToken', async (c) => {
  const t = c.req.param('adminToken')
  if (!isWellFormedToken(t, 'admin')) return generic404(c)
  const group = await getGroupByAdminHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)

  const parsed = parseAdminPatch(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: 'invalid_request', detail: parsed.error }, 400)

  const ts = nowIso()
  if (parsed.value.name !== undefined) await renameGroup(c.env.DB, group.id, parsed.value.name, ts)
  if (parsed.value.passphrase !== undefined) {
    const pass = await hashPassphrase(parsed.value.passphrase)
    await changePassphrase(c.env.DB, group.id, pass, ts) // bumps pass_version → invalidates sessions
  }
  return c.json({ ok: true, passphraseChanged: parsed.value.passphrase !== undefined })
})

app.delete('/admin/:adminToken/members/:id', async (c) => {
  const t = c.req.param('adminToken')
  if (!isWellFormedToken(t, 'admin')) return generic404(c)
  const group = await getGroupByAdminHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_request' }, 400)
  const removed = await deleteMemberInGroup(c.env.DB, group.id, id)
  await touchGroup(c.env.DB, group.id, nowIso())
  return c.json({ ok: removed })
})

app.delete('/admin/:adminToken', async (c) => {
  const t = c.req.param('adminToken')
  if (!isWellFormedToken(t, 'admin')) return generic404(c)
  const group = await getGroupByAdminHash(c.env.DB, await hashToken(t))
  if (!group) return generic404(c)
  await deleteGroup(c.env.DB, group.id)
  return c.json({ ok: true })
})

export default app
