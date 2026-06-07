#!/usr/bin/env bash
# Roll Call — local dev launcher.
# Applies the local D1 schema, then starts `wrangler pages dev`, which serves the
# static frontend (public/) + the /api Pages Functions (functions/), wired to a
# LOCAL D1 database and the secrets in .dev.vars. Stop with Ctrl-C.
#
#   ./dev.sh            # http://localhost:8788
#   PORT=3000 ./dev.sh  # custom port
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8788}"

echo "▶ Roll Call — local dev"

# 1. toolchain + deps
if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found — install Node 20+." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "• Installing dependencies…"
  npm install
fi

# 2. local secrets (gitignored)
if [ ! -f .dev.vars ]; then
  cp .dev.vars.example .dev.vars
  echo "• Created .dev.vars from example."
  echo "  ↳ set a real SERVER_SECRET:  openssl rand -base64 48"
  echo "    (Turnstile TEST keys are prefilled — they always pass locally.)"
fi

# 3. local D1 schema (wrangler migrations — tracked + idempotent)
echo "• Applying migrations to local D1…"
if npx wrangler d1 migrations apply roll-call-db --local >/dev/null 2>&1; then
  echo "  ↳ schema ready (local state in .wrangler/)"
else
  echo "  ↳ ⚠ migrations failed — continuing; retry with 'npm run db:local'"
fi

# 4. launch (frontend + /api + local D1 + .dev.vars)
echo "• Starting http://localhost:${PORT}   (Ctrl-C to stop)"
echo "  smoke test:  curl -s http://localhost:${PORT}/api/config"
echo
exec npx wrangler pages dev --port "${PORT}"
