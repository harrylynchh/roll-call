// Cloudflare Turnstile server-side verification (PLAN §7, layer 1). Gates group
// creation against headless bots. The TEST secret used in local dev always
// returns success. Never logs the token.

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface SiteverifyResponse {
  success: boolean
}

/** Verify a Turnstile token. Returns false on any failure (no exceptions). */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!secret || !token) return false
  const body = new URLSearchParams()
  body.set('secret', secret)
  body.set('response', token)
  if (remoteIp) body.set('remoteip', remoteIp)

  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) return false
    const data = (await res.json()) as SiteverifyResponse
    return data.success === true
  } catch {
    return false
  }
}
