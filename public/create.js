import { $, el, api, toast, copy, friendlyError } from '/lib.js'

const form = $('#create-form')
const submitBtn = $('#submit')
const result = $('#result')
let turnstileToken = ''
let widgetId = null

// --- Turnstile (sitekey from /api/config so test vs prod just works) ---------
;(async () => {
  try {
    const { turnstileSiteKey } = await api('/api/config')
    await whenReady(() => window.turnstile, 8000)
    widgetId = window.turnstile.render('#ts-widget', {
      sitekey: turnstileSiteKey,
      callback: (t) => (turnstileToken = t),
      'error-callback': () => (turnstileToken = ''),
      'expired-callback': () => (turnstileToken = ''),
    })
  } catch {
    $('#ts-widget').append(el('p', { class: 'hint' }, ['Bot check failed to load — reload the page.']))
  }
})()

function whenReady(test, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    ;(function poll() {
      if (test()) return resolve()
      if (Date.now() - t0 > timeout) return reject(new Error('timeout'))
      setTimeout(poll, 80)
    })()
  })
}

// --- submit -------------------------------------------------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('#name').value.trim()
  const passphrase = $('#pass').value
  if (!name) return toast('Give your group a name.', 'err')
  if (!passphrase.trim()) return toast('Set a passphrase.', 'err')
  if (!turnstileToken) return toast('Please complete the bot check.', 'err')

  setLoading(true)
  try {
    const data = await api('/api/groups', {
      method: 'POST',
      body: { name, passphrase, turnstileToken },
    })
    showResult(data, passphrase)
  } catch (err) {
    toast(friendlyError(err), 'err')
    if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId)
    turnstileToken = ''
    setLoading(false)
  }
})

function setLoading(on) {
  submitBtn.disabled = on
  submitBtn.innerHTML = on ? '<span class="spinner"></span>&nbsp;Creating…' : 'Create group'
}

// --- result view --------------------------------------------------------------
function showResult(data, passphrase) {
  form.hidden = true
  result.hidden = false
  result.replaceChildren(
    el('h2', { class: 'section-title' }, ['Your group is ready 🎉']),
    el('p', { class: 'muted' }, [`“${data.name}” · passphrase: `, el('strong', {}, [passphrase])]),

    el('div', { class: 'qr', html: qrSvg(data.join.url) }),
    linkBlock('Share this join link', data.join.url, 'join'),
    el('a', { class: 'btn btn--primary btn--full', href: data.join.url }, [
      'Open the group & add yourself →',
    ]),

    el('hr', { class: 'divider' }),
    linkBlock('Your private admin link', data.admin.url, 'admin'),
    el('div', { class: 'callout' }, [
      el('strong', {}, ['Save your admin link now. ']),
      "It's the only way to manage or delete this group, and it can't be recovered.",
    ]),
    el('p', { class: 'note-hint' }, [
      'Paste the ',
      el('strong', {}, ['join link']),
      ' + ',
      el('strong', {}, ['passphrase']),
      ' into your group chat. Keep the admin link to yourself.',
    ]),
  )
  result.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function linkBlock(label, url, kind) {
  return el('div', { class: 'linkbox' }, [
    el('span', { class: 'label' }, [label]),
    el('div', { class: 'linkrow' }, [
      el('code', { title: url }, [url]),
      el(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          'aria-label': `Copy ${kind} link`,
          onclick: async (e) => {
            const ok = await copy(url)
            toast(ok ? 'Copied!' : 'Copy failed — long-press the link.', ok ? 'ok' : 'err')
            if (ok) e.target.textContent = 'Copied'
          },
        },
        ['Copy'],
      ),
    ]),
  ])
}

function qrSvg(text) {
  try {
    const q = window.qrcode(0, 'M')
    q.addData(text)
    q.make()
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  } catch {
    return ''
  }
}
