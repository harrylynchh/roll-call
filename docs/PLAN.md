# PLAN.md — Group Contact Exchange

> Source of truth for **design and architecture**. For *current build state and
> what to do next*, see `HANDOFF.md`. For *how to work in this repo*, see
> `CLAUDE.md`.

---

## 1. What we're building

A link-based contact exchange for small group chats. An organizer creates a
"group" (optionally protected by a **passphrase**), shares a link into their GC,
each member opens it, enters the passphrase if set, submits their own contact
details, and anyone in the group can download a single vCard (`.vcf`) that
imports the whole roster at once. Members can also "pull" just the people added
since they last synced.

**Explicit non-goals (do not build):**
- No SMS / Twilio / phone verification.
- No user accounts, passwords, or OAuth. (The group passphrase is a shared
  secret, not a per-user login — see §8.)
- No email collection. **Phone-only** contact method.
- No scaling infrastructure. Target load is a couple of 30–50 person groups.
- No reading of anyone's actual iMessage/address book — a webpage can't, and
  we don't try.

## 2. Core model

Three capability tokens **plus** an optional group passphrase. Possession of a
token authorizes the action; the passphrase (if set) is a second gate on
joining/viewing that defends against a leaked join link.

| Token | Who has it | Grants |
|---|---|---|
| **Join token** | Everyone (pasted in the GC) | Reach the group page; with passphrase + reciprocity, add self / view roster |
| **Admin token** | Creator only (never shared in GC) | Rename, set/change passphrase, remove members, delete group |
| **Member token** | Each member (their own) | Edit or delete *their own* entry |

Plus a derived **session token** issued after a correct passphrase (§8) so the
passphrase is entered once, not per action.

Tokens are independent — a join token must never grant admin or another
member's rights.

## 3. Tech stack (all Cloudflare free tier)

- **Cloudflare Pages** — static frontend (unmetered bandwidth).
- **Pages Functions / Workers** — API. 100K req/day free; ~10ms CPU/req.
- **D1** (SQLite) — primary store. 5GB / 5M row-reads / 100K row-writes per day.
- **Cloudflare Turnstile** — free CAPTCHA-alternative, gates group creation.
- **Workers Cron Triggers** — free; daily purge job (§9).
- **WebCrypto** (`crypto.subtle`) — built into Workers; used for token hashing,
  passphrase KDF (PBKDF2), and HMAC session tokens. No external crypto deps.

**Stack gotchas for future sessions:**
- Do **not** use **KV** for rate-limit counters (1K writes/day free ceiling).
  Counters go in D1, or use native Rate Limiting rules.
- The passphrase KDF runs inside the **10ms CPU/req** free budget. Tune PBKDF2
  iterations to stay under it (§8) — measure with `wrangler tail`.

Framework suggestion: [Hono](https://hono.dev) on Pages Functions. Optional.

## 4. Tokens & link format

- Generate with a CSPRNG: 16 bytes from `crypto.getRandomValues`, base64url
  (~22 chars). `crypto.randomUUID()` (122 bits) is acceptable. **Never** use
  sequential/guessable IDs anywhere a client can see them.
- Admin token: 32 bytes.
- **Store only `SHA-256(token)`** in the DB; look up by `token_hash` (indexed).
  A DB dump then yields no working links.
- Links:
  - Create: `https://<host>/`
  - Join/roster: `https://<host>/g/<joinToken>`
  - Admin: `https://<host>/a/<adminToken>`
- The **passphrase is never in any URL** — it's entered on the page and POSTed
  over HTTPS (§8). Tokens are the only secrets in URLs.
- "Easily creatable and shareable": create returns the join link + copy button
  + QR of the **link** (never the vCard — multi-contact vCards overflow QR).

## 5. Data model (D1)

```sql
CREATE TABLE groups (
  id              INTEGER PRIMARY KEY,        -- internal only, never exposed
  join_hash       TEXT NOT NULL UNIQUE,       -- SHA-256(join token)
  admin_hash      TEXT NOT NULL UNIQUE,       -- SHA-256(admin token)
  name            TEXT NOT NULL,
  pass_hash       TEXT,                       -- PBKDF2 hash, NULL if no passphrase
  pass_salt       TEXT,                       -- per-group random salt (base64)
  pass_iters      INTEGER,                    -- PBKDF2 iteration count used
  pass_version    INTEGER NOT NULL DEFAULT 1, -- bump to invalidate sessions
  created_at      TEXT NOT NULL,              -- ISO8601 UTC
  last_active_at  TEXT NOT NULL,              -- bumped on any write; drives TTL
  creator_ip_hash TEXT,                       -- salted hash, abuse triage only
  join_enc        TEXT                        -- AES-GCM(join token) keyed by the admin token (migration 0002); admin re-share
);

CREATE TABLE members (
  id           INTEGER PRIMARY KEY,
  group_id     INTEGER NOT NULL REFERENCES groups(id),
  member_hash  TEXT NOT NULL UNIQUE,          -- SHA-256(member token)
  uid          TEXT NOT NULL,                 -- stable vCard UID (random)
  -- vCard fields (phone-only on contact methods; see §10):
  given_name   TEXT,
  family_name  TEXT,
  fn           TEXT NOT NULL,                 -- formatted/display name (required by vCard)
  nickname     TEXT,
  phones       TEXT NOT NULL,                 -- JSON array: [{type:"CELL",number:"+1..."}]
  org          TEXT,
  title         TEXT,
  url          TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL                  -- drives delta pulls + vCard REV
);
CREATE INDEX idx_members_group ON members(group_id, updated_at);

CREATE TABLE rate_limits (
  bucket      TEXT PRIMARY KEY,               -- e.g. "create:<iphash>:<yyyymmdd>"
  count       INTEGER NOT NULL,
  window_end  TEXT NOT NULL                   -- purgeable by cron
);
```

## 6. API endpoints

All write endpoints are rate-limited (§7) and return generic `404` for any
unknown/malformed token (no enumeration oracle). Passphrase-gated endpoints
require a valid session token (§8) when the group has a passphrase set.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/groups` | Turnstile | Create (name + optional passphrase); returns join + admin links |
| `GET`  | `/api/groups/:joinToken` | join | Public metadata: name, member count, `passphraseRequired` bool |
| `POST` | `/api/groups/:joinToken/unlock` | join | Verify passphrase → returns session token |
| `POST` | `/api/groups/:joinToken/members` | join + session | Add self; returns member token |
| `GET`  | `/api/groups/:joinToken/vcard?since=<iso>` | join + session + reciprocity | vCard of members updated after `since`; omit `since` for all |
| `PATCH`| `/api/members/:memberToken` | member | Edit own entry |
| `DELETE`| `/api/members/:memberToken` | member | Self-remove |
| `PATCH`| `/api/admin/:adminToken` | admin | Rename / set / change / clear passphrase |
| `DELETE`| `/api/admin/:adminToken/members/:id` | admin | Remove a member |
| `DELETE`| `/api/admin/:adminToken` | admin | Delete group + members |

If a group has **no** passphrase, `/unlock` is a no-op and a session token is
issued on first page load; reciprocity (§8) still applies to pulls.

## 7. Rate limiting

Layered, cheapest filter first:

1. **Turnstile** on `POST /api/groups` — stops headless bot creation.
2. **Native Cloudflare Rate Limiting rules** — coarse per-IP ceiling on all
   `/api/*` (e.g. 60 req/min/IP).
3. **Application counters in D1** — precise per-action limits:
   - Create group: **5 / day / IP-hash**.
   - **Passphrase attempts (`/unlock`): 5 / 10 min / IP-hash per group**, then
     back off. This is the online-brute-force defense — keep it tight.
   - Add member: **10 / hour / IP-hash**; hard **cap of 75 members/group**.
   - vCard pull: **30 / min / IP-hash**.

   Fixed-window counter keyed `"<action>:<iphash>:<window>"`; reject when over;
   windows purged by cron. IP source is `CF-Connecting-IP`, stored only as
   `SHA-256(ip + SERVER_SECRET + yyyymmdd)`.

## 8. Security model (primary emphasis)

Auth-less by design — the URL is the primary credential; the optional
passphrase is a shared secret that survives link leakage. Threats & mitigations:

- **Token guessing / enumeration.** 128+ bits CSPRNG; per-IP limits; identical
  generic `404` for missing vs malformed tokens.
- **DB compromise.** Store token *hashes* and the passphrase *KDF hash* only —
  a dump yields no working links and no plaintext passphrase. PII (names/
  numbers) is still exposed in a dump → keep data small and short-lived (§9).
  *Exception (admin re-share):* the join token is also stored **encrypted under a
  key derived from the admin token** (`join_enc`, `joinlink.ts`). The key is the
  admin token, which is never in the DB (only its hash), so a dump still yields
  no working links. Decrypted only when a valid admin token is presented (admin
  page) — strictly less power than the admin already holds.
- **Passphrase handling.**
  - Hash with **PBKDF2-HMAC-SHA256** via WebCrypto, **per-group random salt**,
    iteration count stored per group. **Constant-time compare** the result.
  - **Never** store, log, or echo the plaintext passphrase; it travels only in
    the `/unlock` POST body over HTTPS.
  - **CPU budget:** PBKDF2 must finish within the 10ms free-tier CPU limit. The
    passphrase is *backed by* the 128-bit join link and a tight attempt limit,
    so it doesn't need extreme KDF hardening — pick the highest iteration count
    that comfortably fits the budget (start ~100k, measure, tune).
  - On success, issue a **session token**: `base64url(HMAC-SHA256(SERVER_SECRET,
    "<groupId>|<expiry>|<pass_version>"))` + the payload, ~24h expiry. Verified
    statelessly on each gated request. Bumping `pass_version` (admin changes the
    passphrase) invalidates all outstanding sessions.
- **Token/passphrase leakage via Referer / logs / history.** `Referrer-Policy:
  no-referrer` on every page; **scrub tokens & session tokens from logs**
  (log path *shape*, never values). Optional: carry join token in the URL
  fragment so it never reaches server logs (defer).
- **Roster harvesting (the real privacy risk).** A leaked link otherwise exposes
  every phone number. **Two defenses, both on:** (1) passphrase gate where set;
  (2) **reciprocity** — you must add your own entry before the vCard endpoint
  serves you the roster (enforced via a valid member token, stored client-side
  after join). Plus the pull rate limit.
- **Garbage / impersonation submissions.** Numbers are unverified by design
  (no SMS). Limit damage with the member cap, per-IP submit limit, admin
  removal, and E.164 normalization/validation.
- **Transport & headers.** HTTPS only + HSTS; `Content-Security-Policy` (self +
  Turnstile origin), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`.
- **Input limits.** Bound every field length (name 80, note 500, etc.); validate
  phone to E.164; sanitize before vCard render (escape `,;\n` per vCard rules).

## 9. Privacy & data lifecycle

- **Data minimization:** name + phone(s) + a few optional vCard fields (§10).
  No email. No photos/addresses unless explicitly added later.
- **Self-service deletion:** each member gets a member link to edit/remove
  themselves; admin can remove anyone or delete the group.
- **TTL / auto-purge:** daily Workers Cron deletes groups idle > **90 days**
  (locked) and their members; purges expired `rate_limits` rows.
- **No analytics / third-party trackers** beyond Turnstile.

## 10. vCard fields, builder & delta pull

**Format:** vCard **3.0** (broadest iOS/Android compatibility), multiple cards
concatenated. The "contract" — fields we collect/emit (phone-only on contact
methods, email intentionally excluded):

| vCard field | Source | Req? |
|---|---|---|
| `VERSION:3.0` | constant | — |
| `FN` | display name (derived from given+family if blank) | **required** |
| `N` | `family;given;;;` structured name | required |
| `NICKNAME` | nickname | optional |
| `TEL;TYPE=CELL` (repeatable) | phones[] | **≥1 required** |
| `ORG` | org (useful for intern team/company) | optional |
| `TITLE` | role/title | optional |
| `URL` | url | optional |
| `NOTE` | note | optional |
| `UID` | member.uid (stable) | system-set |
| `REV` | updated_at (ISO) | system-set |

`UID`/`REV` give the OS a chance to update rather than duplicate on re-import
(imperfect — manual import is additive). Escape `,`, `;`, `\`, newlines per
vCard 3.0; fold long lines if needed.

**Response headers:** `Content-Type: text/vcard; charset=utf-8`,
`Content-Disposition: attachment; filename="<group>.vcf"`.

**Delta pull:** client stores `last_pulled_at` per group in `localStorage`;
pull calls `…/vcard?since=<cursor>` → only `updated_at > since` → import → bump
cursor. Using `updated_at` re-delivers people who changed their number.

**Delivery note (no SMS):** nothing is transmitted; the client downloads the
`.vcf`. **iOS reality (researched, high-confidence):** Safari/Quick Look CANNOT
batch-import a multi-contact `.vcf` — it only ever shows the first card and has
no "Add All". The "Add All N Contacts" batch importer lives in Contacts.app and
is reachable ONLY via the iOS Share Sheet. So on iOS we serve the file as an
`attachment` (lands in Files) and guide the user: **Files → tap the file → Share
→ Contacts → "Add All N Contacts"**, with **iCloud.com → Import vCard** as a
guaranteed fallback. (Android/desktop import all from the download directly.)
`inline`/navigation does NOT help — it's what triggers the single-card Quick Look.
Still warn users to open in Safari/Chrome, not an in-app webview.

## 11. Contact import (filling the form) — progressive enhancement

Two paths; manual entry is the universal fallback:

1. **Contact Picker API** (`navigator.contacts.select(['name','tel'], …)`):
   feature-detect with `('contacts' in navigator && 'ContactsManager' in
   window)`. Works by default on **Android Chrome**. On **iOS Safari it's behind
   an experimental flag** → effectively unavailable; do not rely on it. Show a
   "Use a contact" button only when detected.
2. **Manual entry:** short form (given/family name + cell), so this stays quick.
   This is the path on iPhone and the universal fallback everywhere.

No `.vcf` file upload — dropped as unneeded. Never assume a contact can be
pulled automatically; design the form to be fast to fill by hand and treat the
picker as an accelerator only.

## 12. Frontend flow (static, Pages)

- `/` — create: name + optional passphrase + Turnstile → join link, admin link,
  copy buttons, QR of join link.
- `/g/<joinToken>` — locked if passphrase set: prompt → `/unlock` → session.
  Then join (Use-a-contact where supported / manual), "Add everyone", "Add new
  since last time", member count.
- `/a/<adminToken>` — admin: rename, set/change/clear passphrase, member list
  with remove, delete group.

## 13. Capacity sanity check

Two 50-person groups ≈ 100 rows / a few hundred writes vs 100K D1 writes/day and
100K Worker req/day. Legitimate use never approaches a free limit; the §7 limits
exist to cap abuse.

## 14. Decisions (resolved)

- Reciprocity required before pulling roster — **yes**.
- Retention — **90 days** idle, then purge.
- **Phone-only**, no email.
- Optional passphrase per group, layered on top of the unguessable link.

## 15. Open decisions — RESOLVED 2026-06-07 (see HANDOFF.md)

1. **Optional vCard fields** → **all fields collectable, but only Name + ≥1 phone
   required**; nickname/org/title/url/note optional.
2. **Passphrase required or optional per group?** → **ALWAYS REQUIRED.** Overrides
   the original "optional" default. `POST /api/groups` rejects a missing/empty
   passphrase; every group has `pass_hash`/`pass_salt`/`pass_iters` set. The
   "no passphrase ⇒ /unlock no-op, session on first load" path in §6/§8 is
   consequently dead code and not implemented. (Schema columns stay nullable per
   §5 so the decision can be relaxed later without a migration.)
3. **Multiple phones per member** → **up to 2** (1 required, 1 optional).
4. **Domain** → **`*.pages.dev`** (custom domain deferred).

## 16. Future (out of scope now)

- CardDAV subscription for true dupe-free auto-sync (large lift).
- Optional self-verification of numbers.
