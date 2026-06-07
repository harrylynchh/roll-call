// Daily purge Worker (PLAN §9). Runs on the Cron Trigger in wrangler.toml. Pages
// Functions cannot run scheduled handlers, so this lives as a separate Worker
// bound to the SAME D1 database. It deletes groups idle > 90 days (and their
// members) and purges expired rate_limit rows. Logs counts only — never PII.

import { purgeIdleGroups, purgeExpiredRateLimits } from '../src/db'

interface Env {
  DB: D1Database
}

/** Groups untouched for this many days are purged (PLAN §9). */
const IDLE_DAYS = 90
const DAY_MS = 86_400_000

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPurge(env))
  },
}

async function runPurge(env: Env): Promise<void> {
  const now = Date.now()
  const cutoffIso = new Date(now - IDLE_DAYS * DAY_MS).toISOString()
  const nowIso = new Date(now).toISOString()

  const groupsRemoved = await purgeIdleGroups(env.DB, cutoffIso)
  const rateLimitsRemoved = await purgeExpiredRateLimits(env.DB, nowIso)

  // Shapes/counts only — no tokens, no PII.
  console.log(
    `purge: removed ${groupsRemoved} idle group(s) (idle > ${IDLE_DAYS}d), ` +
      `${rateLimitsRemoved} expired rate-limit row(s)`,
  )
}
