# CLAUDE.md — Working Instructions

Group contact-exchange app: link-based vCard sharing for small group chats.
Cloudflare Pages + Functions + D1, all free tier. No accounts, no SMS,
phone-only. Optional per-group passphrase on top of the unguessable link.

## Read these first, every session

1. **`PLAN.md`** — design/architecture, source of truth for *what* and *why*.
   Don't contradict it without updating it.
2. **`HANDOFF.md`** — current build state + ordered next steps. **Start here.**

## End of every session

Update **`HANDOFF.md`**: what changed, what works, what's next, new decisions/
gotchas. It's the baton — assume the next session has *no memory* of this one
beyond these three files and the code. If a decision changes the design, update
`PLAN.md` too and keep them in sync.

## Git workflow (REQUIRED — never regress)

- **Never push to `main`.** No direct commits or pushes to `main`, ever.
- **Branch for every change** (`feat/…`, `fix/…`, `docs/…`), push the *branch*,
  and **open a PR** for Harry to review/merge (`gh pr create`). Keep PRs focused.
- `main` is the **deploy branch**: merging to `main` auto-deploys via GitHub
  Actions (Cloudflare Pages + the cron Worker). Don't deploy `main` by hand once
  CI is in place; let the merge do it.
- Cloudflare deploys of a *branch* (previews) are fine for testing; production
  deploys come from `main` via CI.

## Security invariants (non-negotiable — never regress these)

- **Tokens:** ≥128 bits CSPRNG, base64url. Never sequential/guessable client-
  visible IDs.
- **Store only `SHA-256(token)`** in D1. Raw tokens live only in URLs — with ONE
  deliberate exception: the join token is ALSO stored **encrypted (AES-256-GCM)
  under a key derived from the admin token** (`groups.join_enc`, see
  `joinlink.ts`) so the admin can re-share the join link. The decryption key is
  the admin token, which is **never** in the DB (only its hash), so a dump still
  yields no working links. Never store a token in plaintext, nor encrypted under
  a key that lives in the DB (e.g. `SERVER_SECRET` alone — that would regress the
  dump guarantee).
- **Passphrase:** PBKDF2-HMAC-SHA256 via WebCrypto, **per-group random salt**,
  iteration count stored per group, **constant-time compare**. Never store/log/
  echo the plaintext. It travels only in the `/unlock` POST body. Tune
  iterations to fit the **10ms CPU/req** free budget (measure; ~100k start).
- **Session tokens:** HMAC-SHA256(SERVER_SECRET, `groupId|expiry|passVersion`),
  verified statelessly. Bumping `pass_version` invalidates all sessions.
- **Never log** a token, session token, or passphrase. Log path *shapes*.
- **Never store a raw IP.** Use `SHA-256(ip + SERVER_SECRET + yyyymmdd)`.
- **Generic 404** for missing *and* malformed tokens — no enumeration oracle.
- **Every write endpoint is rate-limited** (PLAN §7); member cap enforced
  server-side, never trusted from the client. `/unlock` attempts tightly
  limited (online brute-force defense).
- **Three token scopes** (join / admin / member) + session. A join token never
  grants admin or another member's rights. Check scope every call.
- **Reciprocity:** the vCard endpoint serves the roster only to someone who has
  added their own entry. Enforce server-side.
- Set `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, locked
  CSP on all responses.
- Validate/normalize phone to E.164, bound all string lengths, and escape vCard
  special chars (`,;\` + newlines) before render.

## Hard "do nots"

- **No KV for rate-limit counters** (1K writes/day ceiling). Counters → D1.
- **No Twilio / SMS / phone verification.** Numbers are self-asserted.
- **No email collection.** Phone-only.
- **No auth system / accounts / sessions-as-login.** Capability URLs +
  shared passphrase only.
- **Don't assume the Contact Picker works on iOS.** It's flag-gated in Safari.
  Contact import is progressive enhancement: picker where detected → manual
  entry (PLAN §11). Manual entry must always work. No .vcf upload (dropped).
- **No scaling infra** (queues, DO sharding, caches) — out of scope.
- **No new third-party scripts** beyond Turnstile without noting it in HANDOFF.

## Commands

```bash
npm install
npx wrangler dev                       # local dev
npx wrangler d1 migrations apply roll-call-db --local      # apply migrations (--remote for prod)
npx wrangler pages deploy ./dist       # deploy frontend + functions
npx wrangler tail                      # live logs (confirm NO token/passphrase appears!)
```

Secrets via `wrangler secret put` (or git-ignored `.dev.vars` locally):
`SERVER_SECRET` (IP-hash salt + session HMAC key), `TURNSTILE_SECRET`. Never
commit secrets.

## Code conventions

- TypeScript. Hono router on Pages Functions (assumed, optional).
- Module per concern: `tokens.ts`, `passphrase.ts`, `session.ts`,
  `ratelimit.ts`, `vcard.ts`, `db.ts`, `routes/*`. Thin handlers.
- Security-critical pure helpers (token gen, KDF, HMAC, e164, vcard build,
  rate-limit check) MUST have unit tests.
- Parameterized D1 statements only (`.bind()`); never interpolate SQL.
- Generic typed JSON errors `{ error }`; keep auth-related bodies vague.

## Testing expectations

Before marking work done, verify at minimum:
- Tokens unguessable + URL-safe; lookup by hash.
- Join token cannot hit admin/member-edit routes (scope isolation).
- Wrong passphrase rejected; correct one issues a session; changing the
  passphrase invalidates old sessions; `/unlock` rate limit actually blocks.
- Rate limits reject over-limit requests (not just count).
- Reciprocity: pull blocked until self added.
- vCard with full field set parses + imports on a real iPhone (open in Safari).
- Contact import degrades correctly: picker absent → manual entry.
- Generic 404 for random-bad and well-formed-unknown tokens alike.
- Self-delete and admin-delete remove rows.
