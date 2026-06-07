# Roll Call

Link-based **group contact exchange** for small group chats. An organizer creates
a group (protected by a passphrase), shares the link into the GC, each member
opens it, enters the passphrase, submits their own phone contact, and anyone in
the group can download a single `.vcf` that imports the whole roster at once —
or pull just the people added since they last synced.

Phone-only. No accounts, no SMS, no email. All on the Cloudflare free tier.

> **Design & rules live in `docs/`** — read those first:
> - [`docs/PLAN.md`](docs/PLAN.md) — architecture & security model (source of truth)
> - [`docs/CLAUDE.md`](docs/CLAUDE.md) — working rules & security invariants
> - [`docs/HANDOFF.md`](docs/HANDOFF.md) — current build state & next steps
> - [`docs/INFRA.md`](docs/INFRA.md) — **one-time Cloudflare setup you run by hand**

## Architecture

- **Cloudflare Pages** — static frontend (`public/`).
- **Pages Functions** — the `/api` (`functions/`), a Hono app.
- **D1** (SQLite) — primary store (`migrations/0001_init.sql`).
- **Turnstile** — gates group creation.
- **Cron Worker** — separate Worker (`worker-cron/`) for the daily purge, sharing
  the same D1 (Pages Functions can't run cron).
- **WebCrypto** — token hashing, PBKDF2 passphrase, HMAC sessions. No crypto deps.

Capability-URL auth: independent **join / admin / member** tokens (hashed in D1),
plus an always-required per-group passphrase (PBKDF2) and stateless HMAC session
tokens. Reciprocity: you must add yourself before the roster `.vcf` is served.

## Layout

```
src/            shared TS modules (crypto, tokens, passphrase, session, e164, vcard, ratelimit, db)
src/*.test.ts   vitest unit tests for the pure security helpers
functions/api/  Pages Functions (the /api Hono app)            ← next phase
public/         static frontend (create / join / admin pages)  ← next phase
worker-cron/    standalone daily-purge Worker
migrations/     D1 schema
docs/           PLAN / CLAUDE / HANDOFF / INFRA
```

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars      # fill SERVER_SECRET; Turnstile test keys are prefilled
npm run db:local                    # apply schema to local D1
npm run dev                         # wrangler pages dev (frontend + /api)

npm test                            # vitest (pure security helpers)
npm run typecheck                   # tsc --noEmit
```

First-time Cloudflare setup (accounts, D1, Turnstile, secrets, deploy) is in
**[`docs/INFRA.md`](docs/INFRA.md)**.

## Status

Backend foundation: scaffold, schema, and all core security modules with passing
unit tests. API routes and frontend are the next phase — see `docs/HANDOFF.md`.
