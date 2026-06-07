// Shared helpers for the app pages (create / join / admin). ES module, no deps.

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

/** Build an element: el('button', {class:'btn', onclick}, ['text', childEl]). */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else if (v === true) node.setAttribute(k, '')
    else if (v !== false && v != null) node.setAttribute(k, v)
  }
  for (const c of [].concat(children)) {
    if (c == null) continue
    node.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
  return node
}

/** Fetch JSON; throws an Error with .status/.data on non-2xx. */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

/** Toast notification (auto-dismiss). kind: '' | 'ok' | 'err'. */
export function toast(msg, kind = '', ms = 3200) {
  let wrap = $('.toast-wrap')
  if (!wrap) {
    wrap = el('div', { class: 'toast-wrap', 'aria-live': 'polite' })
    document.body.append(wrap)
  }
  const t = el('div', { class: `toast${kind ? ' toast--' + kind : ''}` }, [msg])
  wrap.append(t)
  setTimeout(() => t.remove(), ms)
}

/** Copy text to clipboard with a fallback; resolves true/false. */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.style.position = 'fixed' // CSSOM (not a style attribute) — allowed under CSP
    ta.style.opacity = '0'
    ta.value = text
    document.body.append(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

/** Namespaced localStorage JSON store. */
export const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k))
    } catch {
      return null
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* private mode / quota — ignore */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

/** Per-group client state, keyed by join token (session + member token + cursor). */
export const groupState = {
  key: (joinToken) => `rc:g:${joinToken}`,
  get: (joinToken) => store.get(groupState.key(joinToken)) || {},
  patch(joinToken, partial) {
    const next = { ...groupState.get(joinToken), ...partial }
    store.set(groupState.key(joinToken), next)
    return next
  },
  clear: (joinToken) => store.del(groupState.key(joinToken)),
}

/** Map a thrown api() error to a friendly message. */
export function friendlyError(err) {
  const code = err && err.message
  const map = {
    turnstile_failed: 'Bot check failed — please try again.',
    rate_limited: 'Too many requests. Give it a minute and retry.',
    too_many_attempts: 'Too many passphrase attempts. Wait a few minutes.',
    invalid_passphrase: 'That passphrase is not right.',
    reciprocity_required: 'Add yourself first, then you can pull the roster.',
    group_full: 'This group is full.',
    unauthorized: 'Your session expired — re-enter the passphrase.',
    not_found: 'Not found.',
    invalid_request: (err.data && err.data.detail) || 'Please check the form and try again.',
  }
  return map[code] || 'Something went wrong. Please try again.'
}

/** Friendly human readable date. */
export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}
