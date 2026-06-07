// D1 data-access helpers. Parameterized statements ONLY (never interpolate SQL).
// Timestamps are passed in by callers (never Date.now() here) so logic stays
// deterministic and testable. D1 does not reliably honor FK cascade per request,
// so deletes that span tables are done explicitly (members before group).

import type { GroupRow, MemberRow } from './types'
import type { PassRecord } from './passphrase'

export interface NewGroup {
  joinHash: string
  adminHash: string
  name: string
  pass: PassRecord
  nowIso: string
  creatorIpHash: string | null
  joinEnc: string | null
}

export interface NewMember {
  groupId: number
  memberHash: string
  uid: string
  givenName: string | null
  familyName: string | null
  fn: string
  nickname: string | null
  phonesJson: string
  org: string | null
  title: string | null
  url: string | null
  note: string | null
  nowIso: string
}

export interface MemberUpdate {
  givenName: string | null
  familyName: string | null
  fn: string
  nickname: string | null
  phonesJson: string
  org: string | null
  title: string | null
  url: string | null
  note: string | null
  nowIso: string
}

// ---- groups -----------------------------------------------------------------

export async function insertGroup(db: D1Database, g: NewGroup): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO groups
         (join_hash, admin_hash, name, pass_hash, pass_salt, pass_iters,
          pass_version, created_at, last_active_at, creator_ip_hash, join_enc)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7, ?8, ?9)
       RETURNING id`,
    )
    .bind(
      g.joinHash,
      g.adminHash,
      g.name,
      g.pass.hash,
      g.pass.salt,
      g.pass.iters,
      g.nowIso,
      g.creatorIpHash,
      g.joinEnc,
    )
    .first<{ id: number }>()
  if (!row) throw new Error('insertGroup: no id returned')
  return row.id
}

export function getGroupByJoinHash(db: D1Database, joinHash: string): Promise<GroupRow | null> {
  return db.prepare(`SELECT * FROM groups WHERE join_hash = ?1`).bind(joinHash).first<GroupRow>()
}

export function getGroupByAdminHash(db: D1Database, adminHash: string): Promise<GroupRow | null> {
  return db.prepare(`SELECT * FROM groups WHERE admin_hash = ?1`).bind(adminHash).first<GroupRow>()
}

export async function touchGroup(db: D1Database, groupId: number, nowIso: string): Promise<void> {
  await db
    .prepare(`UPDATE groups SET last_active_at = ?2 WHERE id = ?1`)
    .bind(groupId, nowIso)
    .run()
}

export async function renameGroup(
  db: D1Database,
  groupId: number,
  name: string,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(`UPDATE groups SET name = ?2, last_active_at = ?3 WHERE id = ?1`)
    .bind(groupId, name, nowIso)
    .run()
}

/** Change the passphrase AND bump pass_version (invalidates outstanding sessions). */
export async function changePassphrase(
  db: D1Database,
  groupId: number,
  pass: PassRecord,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE groups
         SET pass_hash = ?2, pass_salt = ?3, pass_iters = ?4,
             pass_version = pass_version + 1, last_active_at = ?5
       WHERE id = ?1`,
    )
    .bind(groupId, pass.hash, pass.salt, pass.iters, nowIso)
    .run()
}

/** Delete a group and all its members. */
export async function deleteGroup(db: D1Database, groupId: number): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM members WHERE group_id = ?1`).bind(groupId),
    db.prepare(`DELETE FROM groups WHERE id = ?1`).bind(groupId),
  ])
}

// ---- members ----------------------------------------------------------------

export async function countMembers(db: D1Database, groupId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM members WHERE group_id = ?1`)
    .bind(groupId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function insertMember(db: D1Database, m: NewMember): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO members
         (group_id, member_hash, uid, given_name, family_name, fn, nickname,
          phones, org, title, url, note, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       RETURNING id`,
    )
    .bind(
      m.groupId,
      m.memberHash,
      m.uid,
      m.givenName,
      m.familyName,
      m.fn,
      m.nickname,
      m.phonesJson,
      m.org,
      m.title,
      m.url,
      m.note,
      m.nowIso,
    )
    .first<{ id: number }>()
  if (!row) throw new Error('insertMember: no id returned')
  return row.id
}

export function getMemberByHash(db: D1Database, memberHash: string): Promise<MemberRow | null> {
  return db.prepare(`SELECT * FROM members WHERE member_hash = ?1`).bind(memberHash).first<MemberRow>()
}

export async function updateMember(
  db: D1Database,
  memberId: number,
  u: MemberUpdate,
): Promise<void> {
  await db
    .prepare(
      `UPDATE members
         SET given_name = ?2, family_name = ?3, fn = ?4, nickname = ?5,
             phones = ?6, org = ?7, title = ?8, url = ?9, note = ?10, updated_at = ?11
       WHERE id = ?1`,
    )
    .bind(
      memberId,
      u.givenName,
      u.familyName,
      u.fn,
      u.nickname,
      u.phonesJson,
      u.org,
      u.title,
      u.url,
      u.note,
      u.nowIso,
    )
    .run()
}

export async function deleteMember(db: D1Database, memberId: number): Promise<void> {
  await db.prepare(`DELETE FROM members WHERE id = ?1`).bind(memberId).run()
}

/** Admin removal: delete only if the member actually belongs to the group. */
export async function deleteMemberInGroup(
  db: D1Database,
  groupId: number,
  memberId: number,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM members WHERE id = ?1 AND group_id = ?2`)
    .bind(memberId, groupId)
    .run()
  return (res.meta.changes ?? 0) > 0
}

/** List members, optionally only those updated after `sinceIso` (delta pull). */
export function listMembers(
  db: D1Database,
  groupId: number,
  sinceIso: string | null,
): Promise<{ results: MemberRow[] }> {
  return db
    .prepare(
      `SELECT * FROM members
         WHERE group_id = ?1 AND (?2 IS NULL OR updated_at > ?2)
         ORDER BY updated_at ASC, id ASC`,
    )
    .bind(groupId, sinceIso)
    .all<MemberRow>()
}

// ---- purge (cron, PLAN §9) --------------------------------------------------

/** Delete groups whose last_active_at is older than cutoff, and their members. */
export async function purgeIdleGroups(db: D1Database, cutoffIso: string): Promise<number> {
  const stale = await db
    .prepare(`SELECT id FROM groups WHERE last_active_at < ?1`)
    .bind(cutoffIso)
    .all<{ id: number }>()
  const ids = stale.results.map((r) => r.id)
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ')
  await db.batch([
    db.prepare(`DELETE FROM members WHERE group_id IN (${placeholders})`).bind(...ids),
    db.prepare(`DELETE FROM groups WHERE id IN (${placeholders})`).bind(...ids),
  ])
  return ids.length
}

/** Delete rate-limit rows whose window has fully ended before `nowIso`. */
export async function purgeExpiredRateLimits(db: D1Database, nowIso: string): Promise<number> {
  const res = await db.prepare(`DELETE FROM rate_limits WHERE window_end < ?1`).bind(nowIso).run()
  return res.meta.changes ?? 0
}
