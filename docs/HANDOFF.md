# HANDOFF.md — Current State & Next Steps

> Living baton between sessions. Update at the **end** of every session. The
> next session reads `PLAN.md` (design) + `CLAUDE.md` (rules) + this file and
> assumes nothing else. Keep "Next up" ordered and honest.

_Last updated: 2026-06-07 by build-session-1 (foundation + infra provisioned + landing page deployed)_

## Status

**Phase: full app built (backend + frontend); deploy + e2e remain.** Backend
security modules + all API routes (75 unit tests) AND the create/join/admin
**frontend pages** are done and verified end-to-end against local D1 (screenshots
reviewed). CI/CD workflows added. Remaining: confirm the live deploy, automate D1
integration tests, and e2e on a real iPhone.

> **Git workflow changed (CLAUDE.md):** no direct pushes to `main` — branch +
> PR. `main` auto-deploys via GitHub Actions once the two CF secrets are added.

## Live infra (provisioned 2026-06-07)

- **GitHub:** https://github.com/harrylynchh/roll-call (branch `main`).
- **Pages project:** `roll-call` → **https://roll-call-77h.pages.dev** (landing
  page live; `_headers` CSP/HSTS verified applied).
- **D1:** `roll-call-db` id `9f5bbd75-454d-4441-a7f8-b195eac03709` — schema
  applied **local + remote**. Same id wired into both wrangler.toml files.
- **Secrets set:** `SERVER_SECRET` on the Pages project (production). Local
  `.dev.vars` has its own dev `SERVER_SECRET` + Turnstile **test** keys.
- **Cron Worker:** `roll-call-cron` deployed, bound to the same D1,
  schedule `0 4 * * *` (daily purge).

- **Turnstile:** ✅ widget created; real **site key** wired into
  `wrangler.toml [vars]`, **secret** set as a Pages secret. Local dev keeps the
  Turnstile **test** keys in `.dev.vars` (always pass; no localhost hostname
  needed). If you want the real widget on localhost, add `localhost` to the
  widget hostnames and swap `.dev.vars`.

### ⚠️ Still needs the human
- **GitHub Actions secrets for auto-deploy** (Settings → Secrets and variables →
  Actions): `CLOUDFLARE_API_TOKEN` (Pages:Edit + Workers Scripts:Edit) and
  `CLOUDFLARE_ACCOUNT_ID`. Until these exist, `deploy.yml` will fail on merge to
  `main`. (Manual `npm run deploy` still works in the meantime.)
- Confirm the **D1 binding** `DB → roll-call-db` shows on the Pages project
  (dashboard → Pages → roll-call → Settings → Functions) now that Functions are
  deployed.
- Optional: add `roll-call-77h.pages.dev` to the **Turnstile widget** hostnames
  (the create page renders the widget in production).

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

## Done in build-session-2 (API + infra + landing)

- ✅ **Cloudflare provisioned & landing page deployed** (see "Live infra").
- ✅ **Mobile-first landing page** (`public/`: index.html, styles.css, app.js,
  `_headers` tight CSP) — live + verified.
- ✅ **Full `/api`** (`src/api.ts` via `functions/api/[[route]].ts`): config,
  create, metadata, unlock, add-member, vcard (delta + reciprocity), member
  edit/delete, admin (list/rename/change-passphrase/remove/delete). Security-
  headers + `no-store` middleware; generic-404 posture; thin handlers over the
  tested modules.
- ✅ `src/turnstile.ts`, `src/validation.ts` (+ unit tests). 75 unit tests green.
- ✅ `dev.sh` — applies local schema + launches `wrangler pages dev`.
- ✅ Whole flow **smoke-tested against local D1** (create→unlock→add→reciprocity
  →vcard→admin; scope-isolation 404s; no-session 401).

## Done in build-session-3 (frontend + CI/CD)

- ✅ **Create page** (`public/create.html` + `create.js`): name + passphrase +
  Turnstile (sitekey from `/api/config`) → `POST /api/groups` → result with QR
  (self-hosted `vendor/qrcode.min.js`), copy buttons, "save your admin link".
- ✅ **Join/roster page** (`public/join.html` served at `/g/*`, `join.js`):
  metadata → unlock → add-self (Contact Picker where supported → manual) → store
  session+member token in `localStorage` → "Add everyone" / delta pull (blob
  download) → edit/remove self. "Open in Safari" hint.
- ✅ **Admin page** (`public/admin.html` at `/a/*`, `admin.js`): rename, member
  list + remove, change passphrase (warns), delete group.
- ✅ Shared `lib.js`, extended `styles.css` (forms/cards/toasts), `_redirects`
  (token routes → `/join` `/admin` clean URLs), `_headers` CSP widened for
  Turnstile. Landing CTA now links to `/create`.
- ✅ `.github/workflows/ci.yml` (typecheck+test on PRs) and `deploy.yml`
  (auto-deploy Pages + cron Worker on push to `main`).
- ✅ Verified all three pages render against local D1 (screenshots reviewed).
- ✅ **Admin re-share** of the join link: `migrations/0002_join_enc.sql` adds
  `join_enc` = AES-256-GCM(join token) keyed by the admin token (`joinlink.ts`,
  +5 tests). Create encrypts it; admin `GET` decrypts with the admin token and
  returns the join link; admin page shows it (QR + copy). DB-dump guarantee
  preserved (key not in DB) — invariant refined in CLAUDE.md/PLAN §5,§8.
- ✅ Switched D1 setup to **`wrangler d1 migrations apply`** (tracked, idempotent)
  — `db:local`/`db:remote`/`dev.sh` updated; both DBs migrated (local + remote).

## Next up (ordered) — deploy verify → tests → e2e

1. **Confirm the live deploy** (production already deployed this session): on
   `roll-call-77h.pages.dev`, walk create → join → add → pull; `wrangler pages
   deployment tail` to confirm no token/passphrase in logs; confirm D1 binding.
2. **D1 integration tests** with `@cloudflare/vitest-pool-workers` (Miniflare D1)
   covering the routes — the current route check is a manual curl smoke test.
3. **E2E on a real iPhone** (Safari): unlock, manual add, import full + delta;
   confirm the `.vcf` opens the contacts sheet (and the in-app-webview caveat).
4. Final security pass vs the CLAUDE.md checklist.

## Known gotchas / reminders

- **Architecture (decided):** app = **Pages Functions**; cron = **separate
  Worker** (`worker-cron/`) — Pages Functions can't run scheduled handlers. Both
  bind the SAME D1; put the identical `database_id` in both wrangler.toml files.
  (Alternative for a future simplification: collapse to one "Worker + static
  assets" deployable, which supports fetch + scheduled + assets in one — would
  diverge from PLAN's "Pages" wording, so left as a noted option, not done.)
- **API auth conventions (for the frontend):** join token in the URL path;
  **session** via header `X-Session-Token` (from `/unlock`); **member token** via
  header `X-Member-Token` for vcard reciprocity, or URL path for `/members/:t`
  self edit/delete; admin token in the URL path. The create response returns the
  raw join+admin tokens **once** — the join link CANNOT be reconstructed later
  (only hashes are stored), so the create UI must surface/save both links.
- **Local dev:** `./dev.sh` (applies local migrations + `wrangler pages dev` on
  :8788). Smoke test: `curl -s localhost:8788/api/config`.
- **iOS multi-vCard import:** a *downloaded* multi-contact `.vcf` opens in Quick
  Look and shows only the FIRST card (no "Add All"). Fix (`join.js`): on iOS, POST
  `/api/.../vcard-ticket` (session+member auth) → navigate to the returned
  short-lived `?t=<ticket>` URL, which serves `text/vcard` **inline** so Safari
  opens the native "Add All Contacts" import. Desktop/Android keep the blob
  download. Ticket = HMAC-signed, ~2 min, single-purpose (`session.ts`); reciprocity
  is checked at issue time, so the navigated URL carries no long-lived token.
- **Migrations are NOT run by CI** — `deploy.yml` ships code only. After adding a
  migration, apply it manually: `npm run db:remote` (and `db:local`). Both DBs are
  on `0002` now. Add a `d1 migrations apply --remote` step to CI later if wanted
  (needs the API token to also have D1:Edit).
- **Pages `_redirects` for token routes:** destinations MUST be the extensionless
  clean URLs (`/join`, `/admin`), NOT `*.html` (clean-URL 308 strips the ext and
  drops the token) and NOT `/g/index.html` (clean-URL strip → `/g/` re-matches
  `/g/*` → "infinite loop", rule dropped). Lesson learned the hard way.
- **Vendored third-party script:** `public/vendor/qrcode.min.js`
  (`qrcode-generator`, self-hosted so CSP `script-src 'self'` covers it; no
  external request). The only third-party script besides Turnstile.
- **Frontend uses no inline styles/scripts** so the CSP needs no `'unsafe-inline'`
  (animation delays/colors are CSS classes; dynamic styling uses CSSOM, not the
  `style` attribute). Keep it that way.
- **Functions not deployed yet:** only the static landing page is live; run
  `npm run deploy` to ship the `/api` (after the CSP/Turnstile `_headers` edit).
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
  ✅ set in prod (Pages secret) + local `.dev.vars`.
- `TURNSTILE_SECRET` — server-side Turnstile verification. ⛔ pending widget.
- Turnstile site key (public) for the frontend. ⛔ pending widget
  (`wrangler.toml [vars] TURNSTILE_SITEKEY` still placeholder; test key in `.dev.vars`).
- D1 `roll-call-db` created + bound as `DB`. ✅ schema applied local + remote.

## Open questions for the human

(none pending — fill in if blocked)
