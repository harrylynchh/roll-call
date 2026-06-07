# INFRA.md — One-time Cloudflare setup (manual)

Everything here is account-bound or interactive, so **you** run it. Steps marked
🤝 I can drive for you in this session once you've done step 1 (just approve the
commands, or run them yourself with a leading `!`). Steps marked 🧑 are
browser/dashboard or interactive-auth steps only you can do.

All of this is **Cloudflare free tier** — no card required for the pieces we use.

---

## 0. Prerequisites (already present on this machine)
- Node 24, npm 11, wrangler 4.98 ✓
- A **Cloudflare account** (free) — create at dash.cloudflare.com if you don't have one. 🧑

## 1. Authenticate wrangler 🧑 (interactive — you must run)
```bash
npx wrangler login        # opens a browser OAuth flow
npx wrangler whoami       # confirm the account/email
```
Tip: in this chat you can run it inline with `! npx wrangler login` so I see the result.

## 2. Create the D1 database 🤝
```bash
npx wrangler d1 create roll-call-db
```
Copy the printed `database_id` into the **same placeholder in BOTH files** (identical id):
- `wrangler.toml` → `[[d1_databases]] database_id`
- `worker-cron/wrangler.toml` → `[[d1_databases]] database_id`

## 3. Apply the schema 🤝
```bash
npm run db:local     # local dev DB (.wrangler/)
npm run db:remote    # production D1
```

## 4. Create a Turnstile widget 🧑 (dashboard)
Dashboard → **Turnstile** → *Add site*:
- **Hostnames:** `localhost` for now; add your real `*.pages.dev` host after step 6.
- **Widget mode:** Managed.
- Copy the **Site key** (public) and **Secret key**.

Put the **Site key** into:
- `wrangler.toml` → `[vars] TURNSTILE_SITEKEY` (replace the placeholder), and
- the Pages project's production env var (set on first deploy / dashboard).

The **Secret key** is set as a secret in step 6 (never commit it).

> For **local dev** you don't need real keys — `.dev.vars.example` ships
> Cloudflare's official Turnstile **test keys** (always pass).

## 5. Generate SERVER_SECRET 🤝
```bash
openssl rand -base64 48
```
- **Local:** `cp .dev.vars.example .dev.vars`, paste the value into `SERVER_SECRET`.
- **Production:** set as a secret in step 6.

`SERVER_SECRET` salts IP hashes **and** signs session HMACs. Rotating it logs
everyone out and changes IP-hash buckets — fine, but do it deliberately.

## 6. Set production secrets 🤝 (after the Pages project exists — step 7)
```bash
npx wrangler pages secret put SERVER_SECRET      # paste openssl value
npx wrangler pages secret put TURNSTILE_SECRET   # paste Turnstile secret key
```

## 7. Create the Pages project + first deploy 🤝
```bash
npm run deploy        # wrangler pages deploy public  → creates project "roll-call"
```
- Note the assigned **`https://roll-call.pages.dev`** (or similar) URL.
- Add that hostname to the Turnstile widget (step 4). 🧑
- Confirm the **D1 binding** `DB → roll-call-db` is attached to the Pages project
  (dashboard → Pages → roll-call → Settings → Functions → D1 bindings). 🧑

> Note: the `/api` routes and frontend pages don't exist yet (next build phase),
> so the first deploy serves an empty site. You can defer steps 6–8 until the app
> code lands, but creating the DB (2–3) and Turnstile widget (4) now is useful.

## 8. Deploy the cron purge Worker 🤝
```bash
npm run cron:deploy   # wrangler deploy --config worker-cron/wrangler.toml
```
- Verify the daily trigger: dashboard → Workers → **roll-call-cron** → Triggers.
- Test it locally any time: `npm run cron:dev` then trigger a scheduled run.

## 9. Sanity: no secrets in logs 🧑
```bash
npm run tail          # live logs; exercise the app and confirm NO token,
                      # session token, or passphrase ever appears
```

---

## What I (Claude) can run for you now vs. later
- **Now, blocked on step 1:** I can't do `wrangler login` (interactive browser
  OAuth). Run it yourself (`! npx wrangler login`), then say "go" and I'll drive
  steps 2, 3, 5, 6, 7, 8 — pausing for the two dashboard-only bits (Turnstile
  widget, D1-binding confirmation).
- **Anytime:** local-only flow needs no Cloudflare account —
  `cp .dev.vars.example .dev.vars`, `npm run db:local`, `npm test`. (Full
  `npm run dev` becomes useful once the `/api` routes land.)

## Free-tier ceilings (we stay far under — PLAN §13)
- Workers/Pages Functions: 100K req/day, ~10ms CPU/req (tune PBKDF2 to fit).
- D1: 5 GB, 5M row-reads/day, 100K row-writes/day.
- Turnstile, Cron Triggers: free.
- Rate-limit counters in **D1, never KV** (KV is 1K writes/day).

## Deferred
- **Custom domain** — running on `*.pages.dev` for now (locked decision). To add
  later: attach the domain in Pages → Custom domains, then add it to the
  Turnstile widget hostnames and the CSP allow-list.
