// Shared types: the Worker environment bindings and the D1 row shapes.

export interface Env {
  /** D1 database binding (wrangler.toml [[d1_databases]] binding = "DB"). */
  DB: D1Database
  /** Long random secret: salts IP hashes + signs session-token HMACs. (secret) */
  SERVER_SECRET: string
  /** Cloudflare Turnstile server-side verification secret. (secret) */
  TURNSTILE_SECRET: string
  /** Cloudflare Turnstile public site key, surfaced to the frontend. (public var) */
  TURNSTILE_SITEKEY: string
}

export interface GroupRow {
  id: number
  join_hash: string
  admin_hash: string
  name: string
  pass_hash: string | null
  pass_salt: string | null
  pass_iters: number | null
  pass_version: number
  created_at: string
  last_active_at: string
  creator_ip_hash: string | null
}

export interface MemberRow {
  id: number
  group_id: number
  member_hash: string
  uid: string
  given_name: string | null
  family_name: string | null
  fn: string
  nickname: string | null
  phones: string // JSON array string: [{"type":"CELL","number":"+1..."}]
  org: string | null
  title: string | null
  url: string | null
  note: string | null
  created_at: string
  updated_at: string
}
