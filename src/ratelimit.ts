// Application rate limiting (PLAN §7). Fixed-window counters in D1 (never KV —
// 1K writes/day ceiling). This is layer 3, behind Turnstile (layer 1) and native
// Cloudflare per-IP rules (layer 2). IPs are stored only as a daily salted hash.
//
// The pure helpers (bucket key, window math, decision) are unit-tested; the D1
// INSERT…ON CONFLICT…RETURNING increment is the only impure part.

import { sha256Hex } from './crypto'

export interface RateRule {
  action: string
  limit: number
  windowMs: number
  /** When true, the counter is scoped per group (the groupId joins the key). */
  perGroup?: boolean
}

export const RULES = {
  // Create group: 5 / day / IP-hash.
  create: { action: 'create', limit: 5, windowMs: 86_400_000 },
  // Passphrase attempts: 5 / 10 min / IP-hash PER GROUP — the online brute-force
  // defense (PLAN §7, §8). Keep tight.
  unlock: { action: 'unlock', limit: 5, windowMs: 600_000, perGroup: true },
  // Add member: 10 / hour / IP-hash.
  addMember: { action: 'add', limit: 10, windowMs: 3_600_000 },
  // vCard pull: 30 / min / IP-hash.
  vcard: { action: 'vcard', limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateRule>

/** Hard cap on members per group (server-enforced, never trusted from client). */
export const MEMBER_CAP = 75

export function windowId(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs)
}

export function windowEndIso(nowMs: number, windowMs: number): string {
  return new Date((windowId(nowMs, windowMs) + 1) * windowMs).toISOString()
}

/** Deterministic counter key for an action/IP/(group)/window. */
export function bucketKey(rule: RateRule, ipHash: string, nowMs: number, groupId?: number): string {
  const w = windowId(nowMs, rule.windowMs)
  const scope = rule.perGroup ? `:${groupId ?? 'na'}` : ''
  return `${rule.action}:${ipHash}${scope}:${w}`
}

/** Allow while count ≤ limit; remaining never negative. */
export function decide(count: number, limit: number): { allowed: boolean; remaining: number } {
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) }
}

/** YYYYMMDD in UTC — the daily rotation component of the IP hash. */
export function utcDateStamp(nowMs: number): string {
  const d = new Date(nowMs)
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  )
}

/** Salted, daily-rotating IP hash. Never store or log a raw IP (CLAUDE.md). */
export function hashIp(ip: string, secret: string, nowMs: number): Promise<string> {
  return sha256Hex(`${ip}|${secret}|${utcDateStamp(nowMs)}`)
}

/**
 * Atomically increment the fixed-window counter and decide. Increments even when
 * over-limit (keeps the bucket "hot" for the window — correct for brute-force
 * defense). Returns {allowed, remaining}.
 */
export async function checkRateLimit(
  db: D1Database,
  rule: RateRule,
  ipHash: string,
  nowMs: number,
  groupId?: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const bucket = bucketKey(rule, ipHash, nowMs, groupId)
  const end = windowEndIso(nowMs, rule.windowMs)
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, count, window_end) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, end)
    .first<{ count: number }>()
  return decide(row?.count ?? 1, rule.limit)
}
