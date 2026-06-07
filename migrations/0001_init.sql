-- Roll Call — initial schema (PLAN §5).
-- Apply locally:  npm run db:local      (wrangler d1 execute … --local)
-- Apply remote:   npm run db:remote     (… --remote)
--
-- NOTE on passphrase columns: the locked decision (HANDOFF) is "passphrase ALWAYS
-- required", so in practice pass_hash/pass_salt/pass_iters are always populated.
-- They remain NULLable here (matching PLAN §5) so the decision can be relaxed
-- later without a migration; the API enforces non-empty at creation time.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id              INTEGER PRIMARY KEY,        -- internal only, never exposed
  join_hash       TEXT NOT NULL UNIQUE,       -- SHA-256(join token), hex
  admin_hash      TEXT NOT NULL UNIQUE,       -- SHA-256(admin token), hex
  name            TEXT NOT NULL,
  pass_hash       TEXT,                       -- PBKDF2 derived bits, base64; NULL only if no passphrase
  pass_salt       TEXT,                       -- per-group random salt, base64
  pass_iters      INTEGER,                    -- PBKDF2 iteration count used
  pass_version    INTEGER NOT NULL DEFAULT 1, -- bump to invalidate outstanding sessions
  created_at      TEXT NOT NULL,              -- ISO8601 UTC
  last_active_at  TEXT NOT NULL,              -- bumped on any write; drives TTL purge
  creator_ip_hash TEXT                        -- salted hash, abuse triage only
);

CREATE TABLE IF NOT EXISTS members (
  id           INTEGER PRIMARY KEY,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_hash  TEXT NOT NULL UNIQUE,          -- SHA-256(member token), hex
  uid          TEXT NOT NULL,                 -- stable vCard UID (random)
  -- vCard fields (phone-only on contact methods; see PLAN §10):
  given_name   TEXT,
  family_name  TEXT,
  fn           TEXT NOT NULL,                 -- formatted/display name (vCard FN, required)
  nickname     TEXT,
  phones       TEXT NOT NULL,                 -- JSON array: [{"type":"CELL","number":"+1..."}]
  org          TEXT,
  title        TEXT,
  url          TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL                  -- drives delta pulls + vCard REV
);
CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id, updated_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT PRIMARY KEY,               -- "<action>:<iphash>[:<groupId>]:<window>"
  count       INTEGER NOT NULL,
  window_end  TEXT NOT NULL                   -- ISO8601 UTC; purgeable by cron
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_end);
