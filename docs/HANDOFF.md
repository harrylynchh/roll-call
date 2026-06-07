# HANDOFF.md — Current State & Next Steps

> Living baton between sessions. Update at the **end** of every session. The
> next session reads `PLAN.md` (design) + `CLAUDE.md` (rules) + this file and
> assumes nothing else. Keep "Next up" ordered and honest.

_Last updated: 2026-06-07 by build-session-1 (scaffold + core modules)_

## Status

**Phase: scaffold + core security modules landing.** See "Next up" for the live
cursor. Backend foundation (config, schema, crypto/security helpers + unit
tests) is being built this session; API routes and frontend follow.

## Decisions locked

- Stack: Cloudflare Pages + Functions + D1 + Turnstile + Cron. (PLAN §3)
- Capability-URL auth, three token scopes, hashed tokens in DB. (PLAN §2, §4)
- **Optional per-group passphrase** layered on the link: PBKDF2 hash + per-group
  salt, HMAC session token, tight `/unlock` rate limit. (PLAN §8)
- **Reciprocity required** before pulling roster. (PLAN §8)
- **Retention: 90 days** idle → purge. (PLAN §9)
- **Phone-only**, no email; collect full vCard 3.0 field set otherwise. (PLAN §10)
- Contact import = **progressive enhancement** (picker where detected → manual);
  Contact Picker NOT reliable on iOS. No .vcf upload (dropped). (PLAN §11)
- Counters in D1, never KV. (PLAN §3, §7)

## Decisions resolved (PLAN §15) — locked 2026-06-07

- [x] **vCard fields:** all fields available in the form, but **only Name + ≥1
      phone are required**; nickname/org/title/url/note are optional.
- [x] **Passphrase: ALWAYS REQUIRED per group.** (Diverges from the PLAN's
      original "optional" default — creation rejects a missing/empty passphrase.
      The no-passphrase session path described in PLAN §6/§8 is therefore
      unreachable via the API and not built.)
- [x] **Phones per member: up to 2** (1 required, 2nd optional). Stored as JSON
      array `[{type,number}]`.
- [x] **Domain: `*.pages.dev`** subdomain (no custom domain for now). Turnstile
      allowed-hostnames + CSP target the assigned `*.pages.dev` host.

## Done this session (build-session-1)

- ✅ Scaffold: `package.json` (Hono 4 + wrangler 4 + vitest 4, **0 npm vulns**),
  `tsconfig`, `vitest.config`, `.gitignore`, `.dev.vars.example`, `README.md`.
- ✅ `wrangler.toml` (Pages + D1 binding `DB`) and `worker-cron/wrangler.toml`
  (separate cron Worker, same D1). Placeholders for `database_id` + sitekey.
- ✅ `migrations/0001_init.sql` from PLAN §5 (FK cascade + indexes added).
- ✅ Core modules in `src/`, ALL with unit tests (66 tests, all green;
  `npm test`): `crypto`, `tokens`, `passphrase`, `session`, `e164`, `vcard`,
  `ratelimit` (pure + D1 counter), `db` (parameterized helpers), `types`.
- ✅ `worker-cron/index.ts` — daily purge handler (idle groups + rate-limits).
- ✅ `docs/INFRA.md` — the manual Cloudflare setup checklist.
- ✅ **Adversarial multi-agent security review** vs CLAUDE.md invariants:
  **0 confirmed bugs** (5 dimensions × verify pass). 11 test-gaps it surfaced
  are now all closed with regression tests (vCard field-by-field injection,
  rate-limit window/per-group isolation, session passphrase-change cutover,
  constant-time edge bytes, E.164 ceiling, etc.).
- `tsc --noEmit` clean; `git init` done (NOT committed — commit when you want).

## Next up (ordered) — API routes → frontend → deploy

1. **Hono app skeleton** in `functions/api/[[route]].ts` using
   `hono/cloudflare-pages` (`handle(app)`, `app.basePath('/api')`). Add the
   security headers middleware (CSP w/ Turnstile origin, `Referrer-Policy:
   no-referrer`, `nosniff`, HSTS) and a `GET /api/config` → `{turnstileSiteKey}`.
2. `POST /api/groups` — Turnstile verify (`TURNSTILE_SECRET`) + **required**
   passphrase (`isAcceptablePassphrase`) + create rate-limit + `creator_ip_hash`;
   returns join + admin links. (Generic 404 on bad input; never echo tokens.)
3. `GET /api/groups/:joinToken` (name, member count, `passphraseRequired:true`)
   and `POST /unlock` (verify passphrase + `RULES.unlock` attempt limit → session).
4. `POST /api/groups/:joinToken/members` (session-gated) — validate fields
   (E.164 phones ≤2, length bounds), issue member token, enforce `MEMBER_CAP`.
5. `GET …/vcard?since=` — session + **reciprocity** (caller holds a member token
   for this group) + `RULES.vcard` limit; `buildVCardCollection`, delta by
   `updated_at`; `text/vcard` + `Content-Disposition` (`vcardFilename`).
6. `PATCH/DELETE /api/members/:memberToken` (self edit/delete).
7. Admin: `PATCH /api/admin/:adminToken` (rename, **change** passphrase →
   `changePassphrase` bumps pass_version), `DELETE …/members/:id`, `DELETE …`.
8. Wire `checkRateLimit` into every write route; add integration tests with
   `@cloudflare/vitest-pool-workers` (real Miniflare D1) — see gotcha below.
9. Frontend (`public/`): create `/`, locked join/roster `/g/:t`, admin `/a/:t`,
   QR of join link, contact import (feature-detect picker → manual fallback).
10. E2E on a real iPhone (Safari): unlock, manual add, import full + delta.
11. Final security pass vs CLAUDE.md checklist + `wrangler tail` log scrub check.

## Known gotchas / reminders

- **Architecture (decided):** app = **Pages Functions**; cron = **separate
  Worker** (`worker-cron/`) — Pages Functions can't run scheduled handlers. Both
  bind the SAME D1; put the identical `database_id` in both wrangler.toml files.
  (Alternative for a future simplification: collapse to one "Worker + static
  assets" deployable, which supports fetch + scheduled + assets in one — would
  diverge from PLAN's "Pages" wording, so left as a noted option, not done.)
- **PBKDF2 iterations untuned:** `DEFAULT_PBKDF2_ITERS = 100_000` is a starting
  point. MUST measure against the 10ms CPU/req budget on real Workers
  (`wrangler tail`) and tune. Link entropy + tight `/unlock` limit mean extreme
  hardening isn't required.
- **E.164 is dependency-free & pragmatic** (`src/e164.ts`), not full
  libphonenumber: US-default for bare national numbers, `+` required for other
  countries, 8–15 digit E.164 shape. Fine for self-asserted numbers; swap in a
  lib later if international support needs to be stricter.
- **D1 integration tests not set up yet.** Pure helpers use plain vitest (Node
  WebCrypto). For `db.ts` + `checkRateLimit` against real D1, add
  `@cloudflare/vitest-pool-workers` (Miniflare) in the routes phase.
- **D1 FK cascade isn't reliable per-request** — `db.ts` deletes members before
  groups explicitly (don't rely on `ON DELETE CASCADE`).
- **Tooling note:** the Edit tool mangled raw non-ASCII (accented) chars in test
  files this session — keep test source pure ASCII (build unicode via
  `String.fromCharCode`), as done in `passphrase.test.ts`.
- KV is unusable for counters (1K writes/day) — use D1.
- In-app webviews (Messages/IG) may not trigger the iOS contacts sheet — surface
  an "open in Safari" hint on the join page.
- Contact Picker API is flag-gated on iOS Safari — never rely on it; manual
  entry is the iPhone path and universal fallback.
- Manual vCard import is additive; UID/REV reduces but won't eliminate dupes.
- `wrangler tail` after deploy: confirm no token/session/passphrase in logs.

## Environment / secrets needed

- `SERVER_SECRET` — salt for IP hashing + HMAC key for session tokens.
- `TURNSTILE_SECRET` — server-side Turnstile verification.
- Turnstile site key (public) for the frontend.
- D1 database created and bound as `DB` in `wrangler.toml`.

## Open questions for the human

(none pending — fill in if blocked)
