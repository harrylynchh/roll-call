// Pages Functions catch-all for /api/*. Delegates to the Hono app (src/api.ts),
// which has basePath('/api'). All API logic lives in src/ so it is unit-testable
// and reusable; this file is only the Pages ↔ Hono adapter.
import { handle } from 'hono/cloudflare-pages'
import app from '../../src/api'

export const onRequest = handle(app)
