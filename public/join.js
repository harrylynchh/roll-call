import { $, el, api, toast, store, groupState, friendlyError, fmtDate } from '/lib.js'

const joinToken = location.pathname.split('/').filter(Boolean).pop() || ''
const root = $('#app-root')
let meta = null
let state = groupState.get(joinToken)

init()

async function init() {
  if (!joinToken) return renderNotFound()
  try {
    meta = await api(`/api/groups/${encodeURIComponent(joinToken)}`)
  } catch {
    return renderNotFound()
  }
  document.title = `${meta.name} · Roll Call`
  render()
}

function refreshState() {
  state = groupState.get(joinToken)
}

function render() {
  refreshState()
  if (!state.session) return renderUnlock()
  if (!state.memberToken) return renderForm({ mode: 'add' })
  return renderMember()
}

function header(extra) {
  return el('div', {}, [
    el('h1', { class: 'page-title' }, [meta.name]),
    el('p', { class: 'page-sub' }, [extra]),
  ])
}

// --- not found ----------------------------------------------------------------
function renderNotFound() {
  root.replaceChildren(
    el('div', { class: 'card center stack' }, [
      el('h1', { class: 'page-title' }, ['Group not found']),
      el('p', { class: 'muted' }, ['This link is invalid or the group was deleted.']),
      el('a', { class: 'btn btn--ghost', href: '/' }, ['Go home']),
    ]),
  )
}

// --- unlock -------------------------------------------------------------------
function renderUnlock() {
  const input = el('input', {
    class: 'input',
    id: 'pass',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    placeholder: 'group passphrase',
    'aria-label': 'Passphrase',
  })
  const btn = el('button', { class: 'btn btn--primary btn--full', type: 'submit' }, ['Unlock'])
  const form = el('form', { class: 'card stack' }, [
    el('h2', { class: 'section-title' }, ['🔒 Enter the passphrase']),
    el('p', { class: 'muted' }, [`Ask whoever shared “${meta.name}” for the group passphrase.`]),
    el('div', { class: 'field' }, [input]),
    btn,
  ])
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const passphrase = input.value
    if (!passphrase.trim()) return toast('Enter the passphrase.', 'err')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span>&nbsp;Checking…'
    try {
      const { session } = await api(`/api/groups/${encodeURIComponent(joinToken)}/unlock`, {
        method: 'POST',
        body: { passphrase },
      })
      groupState.patch(joinToken, { session })
      render()
    } catch (err) {
      toast(friendlyError(err), 'err')
      btn.disabled = false
      btn.textContent = 'Unlock'
      input.select()
    }
  })
  root.replaceChildren(header(`${meta.memberCount} ${plural(meta.memberCount, 'person')} so far`), form)
  input.focus()
}

// --- add / edit form ----------------------------------------------------------
function renderForm({ mode }) {
  const mine = state.mine || {}
  const f = (id, label, opts = {}) => {
    const input = el('input', {
      class: 'input',
      id,
      value: opts.value || '',
      maxlength: opts.maxlength,
      type: opts.type || 'text',
      inputmode: opts.inputmode,
      autocomplete: opts.autocomplete || 'off',
      placeholder: opts.placeholder || '',
    })
    return { input, field: el('div', { class: 'field' }, [labelEl(id, label, opts.optional), input]) }
  }

  const given = f('given', 'First name', { value: mine.givenName, maxlength: 40, autocomplete: 'given-name', placeholder: 'Ada' })
  const family = f('family', 'Last name', { value: mine.familyName, maxlength: 40, optional: true, autocomplete: 'family-name', placeholder: 'Lovelace' })
  const phone1 = f('phone1', 'Mobile number', { value: (mine.phones && mine.phones[0]) || '', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '(555) 123-4567' })
  const phone2 = f('phone2', 'Second number', { value: (mine.phones && mine.phones[1]) || '', type: 'tel', inputmode: 'tel', optional: true, placeholder: 'optional' })
  const nickname = f('nickname', 'Nickname', { value: mine.nickname, maxlength: 40, optional: true })
  const org = f('org', 'Company / team', { value: mine.org, maxlength: 80, optional: true })
  const title = f('title', 'Role / title', { value: mine.title, maxlength: 80, optional: true })
  const url = f('url', 'Website', { value: mine.url, maxlength: 200, type: 'url', optional: true, placeholder: 'https://' })
  const note = el('textarea', { class: 'input', id: 'note', maxlength: 500, rows: 2, placeholder: 'optional' }, [mine.note || ''])

  const more = el('details', { class: 'disclosure' }, [
    el('summary', {}, ['More details (optional)']),
    el('div', { class: 'stack' }, [
      nickname.field,
      org.field,
      title.field,
      url.field,
      el('div', { class: 'field' }, [labelEl('note', 'Note', true), note]),
    ]),
  ])
  if (mine.nickname || mine.org || mine.title || mine.url || mine.note) more.open = true

  const submitLabel = mode === 'edit' ? 'Save changes' : 'Add me to the group'
  const btn = el('button', { class: 'btn btn--primary btn--full', type: 'submit' }, [submitLabel])

  const form = el('form', { class: 'card stack', novalidate: true }, [
    el('h2', { class: 'section-title' }, [mode === 'edit' ? 'Edit your info' : 'Add yourself']),
    el('p', { class: 'muted' }, ['Your name and number — that’s all the group needs.']),
    contactPickerButton([given.input, family.input, phone1.input, phone2.input]),
    el('div', { class: 'row2' }, [given.field, family.field]),
    phone1.field,
    phone2.field,
    more,
    btn,
  ])

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const phones = [phone1.input.value, phone2.input.value].map((s) => s.trim()).filter(Boolean)
    if (!given.input.value.trim() && !family.input.value.trim())
      return toast('Add your name.', 'err')
    if (phones.length === 0) return toast('Add at least one phone number.', 'err')

    const payload = {
      givenName: given.input.value,
      familyName: family.input.value,
      phones,
      nickname: nickname.input.value,
      org: org.input.value,
      title: title.input.value,
      url: url.input.value,
      note: note.value,
    }
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span>&nbsp;Saving…'
    try {
      if (mode === 'edit') {
        await api(`/api/members/${encodeURIComponent(state.memberToken)}`, { method: 'PATCH', body: payload })
        groupState.patch(joinToken, { mine: payload })
        toast('Updated!', 'ok')
      } else {
        const { memberToken } = await api(`/api/groups/${encodeURIComponent(joinToken)}/members`, {
          method: 'POST',
          headers: { 'X-Session-Token': state.session },
          body: payload,
        })
        groupState.patch(joinToken, { memberToken, mine: payload })
        meta.memberCount += 1
        toast("You're in! 🎉", 'ok')
      }
      render()
    } catch (err) {
      if (err.status === 401) {
        groupState.patch(joinToken, { session: null })
        toast('Session expired — re-enter the passphrase.', 'err')
        return render()
      }
      toast(friendlyError(err), 'err')
      btn.disabled = false
      btn.textContent = submitLabel
    }
  })

  const back =
    mode === 'edit'
      ? el('button', { class: 'btn btn--ghost btn--full', type: 'button', onclick: () => renderMember() }, ['Cancel'])
      : null
  root.replaceChildren(header(`${meta.memberCount} ${plural(meta.memberCount, 'person')} so far`), form, back)
  given.input.focus()
}

function contactPickerButton(inputs) {
  const supported = 'contacts' in navigator && 'ContactsManager' in window
  if (!supported) return el('p', { class: 'hint' }, ['Tip: fill this in once — it takes a few seconds.'])
  const [given, family, phone1, phone2] = inputs
  return el(
    'button',
    {
      class: 'btn btn--ghost btn--full',
      type: 'button',
      onclick: async () => {
        try {
          const sel = await navigator.contacts.select(['name', 'tel'], { multiple: false })
          const c = sel && sel[0]
          if (!c) return
          const name = (c.name && c.name[0]) || ''
          const parts = name.trim().split(/\s+/)
          given.value = parts.shift() || name
          family.value = parts.join(' ')
          if (c.tel && c.tel[0]) phone1.value = c.tel[0]
          if (c.tel && c.tel[1]) phone2.value = c.tel[1]
        } catch {
          /* user cancelled */
        }
      },
    },
    ['📇  Use a contact'],
  )
}

// --- member (added) view ------------------------------------------------------
function renderMember() {
  const since = state.lastPulledAt
  const actions = el('div', { class: 'stack' }, [
    el(
      'button',
      { class: 'btn btn--primary btn--full', type: 'button', onclick: () => pullVcard(null) },
      ['⬇︎  Add everyone to my contacts'],
    ),
    since
      ? el(
          'button',
          { class: 'btn btn--ghost btn--full', type: 'button', onclick: () => pullVcard(since) },
          [`Add people added since ${fmtDate(since)}`],
        )
      : null,
  ])

  root.replaceChildren(
    header(`${meta.memberCount} ${plural(meta.memberCount, 'person')} in this group`),
    el('div', { class: 'card stack' }, [
      el('p', { class: 'status-ok' }, [`You’re in${state.mine && state.mine.givenName ? ', ' + state.mine.givenName : ''}`]),
      el('hr', { class: 'divider' }),
      actions,
      el('p', { class: 'note-hint' }, [
        'On iPhone, open this page in ',
        el('strong', {}, ['Safari']),
        ' (not inside Instagram/Messages). After you tap “Add everyone”, we’ll show you the last few taps to add them all.',
      ]),
    ]),
    el('div', { class: 'card stack' }, [
      el('button', { class: 'btn btn--ghost btn--full', type: 'button', onclick: () => renderForm({ mode: 'edit' }) }, ['Edit my info']),
      el('button', { class: 'btn btn--danger btn--full', type: 'button', onclick: removeSelf }, ['Remove me from the group']),
    ]),
  )
}

function pullVcard(since) {
  return isAppleMobile() ? pullVcardApple(since) : downloadVcard(since)
}

// iOS/iPadOS: Safari can't batch-import a multi-vCard, and on many iOS builds the
// Files → Share → Contacts batch path is broken too. The two things that DO work
// everywhere: iCloud.com bulk import, and single-contact import. So fetch the
// roster, split it into cards, and offer both.
async function pullVcardApple(since) {
  const cursor = new Date().toISOString()
  let res
  try {
    res = await fetch(
      `/api/groups/${encodeURIComponent(joinToken)}/vcard${since ? '?since=' + encodeURIComponent(since) : ''}`,
      { headers: { 'X-Session-Token': state.session, 'X-Member-Token': state.memberToken } },
    )
  } catch {
    return toast('Network error — try again.', 'err')
  }
  if (res.status === 401) {
    groupState.patch(joinToken, { session: null })
    toast('Session expired — re-enter the passphrase.', 'err')
    return render()
  }
  if (!res.ok) {
    const d = await res.json().catch(() => null)
    return toast(friendlyError({ message: d && d.error, data: d }), 'err')
  }
  const text = await res.text()
  groupState.patch(joinToken, { lastPulledAt: cursor })
  const cards = splitCards(text)
  if (cards.length === 0) return toast('Nobody new since last time.', 'ok')
  renderIosImport(text, cards)
}

// Split a multi-vCard document into [{fn, card}] and pull the display name from FN.
function splitCards(vcf) {
  const out = []
  const re = /BEGIN:VCARD[\s\S]*?END:VCARD/g
  let m
  while ((m = re.exec(vcf))) {
    const card = m[0]
    const fnLine = card.split(/\r?\n/).find((l) => l.startsWith('FN:'))
    out.push({ fn: fnLine ? unescapeVcf(fnLine.slice(3)) : 'Contact', card })
  }
  return out
}
function unescapeVcf(s) {
  return s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}
function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/vcard;charset=utf-8' }))
  const a = el('a', { href: url, download: `${safeName(name)}.vcf` })
  document.body.append(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1500)
}
function downloadBtn(label, text, name) {
  const b = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, [label])
  b.addEventListener('click', () => downloadText(text, name))
  return b
}
function cardDataUri(card) {
  return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(card.endsWith('\r\n') ? card : card + '\r\n')
}

// iOS import screen: iCloud bulk (guaranteed) + add-one-at-a-time (single-contact
// import, which works on every build).
function renderIosImport(fullText, cards) {
  const n = cards.length
  root.replaceChildren(
    header(`${n} ${plural(n, 'person')} to add`),

    el('div', { class: 'card stack' }, [
      el('h2', { class: 'section-title' }, [`Add all ${n} at once`]),
      el('p', { class: 'muted' }, [
        "iPhone Safari can't add multiple contacts in one tap (Apple's limit) — iCloud can, in a few taps:",
      ]),
      el('ol', { class: 'howto' }, [
        el('li', {}, [downloadBtn('Download the .vcf', fullText, meta.name)]),
        el('li', {}, ['Open ', el('strong', {}, ['iCloud.com/contacts']), ' (button below) and sign in.']),
        el('li', {}, ['Click the ', el('strong', {}, ['⚙ gear → Import vCard']), '.']),
        el('li', {}, [`Pick the file you just downloaded — all ${n} sync to your iPhone.`]),
      ]),
      el('a', { class: 'btn btn--primary btn--full', href: 'https://www.icloud.com/contacts', target: '_blank', rel: 'noopener' }, ['Open iCloud.com Contacts ↗']),
    ]),

    el('details', { class: 'card disclosure' }, [
      el('summary', {}, ['Or add them one at a time (no iCloud)']),
      el('div', { class: 'stack' }, [
        el('p', { class: 'muted' }, ['Tap a name → ', el('strong', {}, ['Create New Contact']), ' → back here for the next.']),
        el(
          'ul',
          { class: 'mlist' },
          cards.map((c) =>
            el('li', {}, [
              el('div', { class: 'm-name' }, [c.fn]),
              el('a', { class: 'btn btn--ghost btn--sm', href: cardDataUri(c.card) }, ['Add']),
            ]),
          ),
        ),
      ]),
    ]),

    el('button', { class: 'btn btn--ghost btn--full', type: 'button', onclick: () => renderMember() }, ['← Back to group']),
  )
}

// Desktop / Android: download the .vcf (their import handles multiple contacts).
async function downloadVcard(since) {
  const cursor = new Date().toISOString()
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  let res
  try {
    res = await fetch(`/api/groups/${encodeURIComponent(joinToken)}/vcard${qs}`, {
      headers: { 'X-Session-Token': state.session, 'X-Member-Token': state.memberToken },
    })
  } catch {
    return toast('Network error — try again.', 'err')
  }
  if (res.status === 401) {
    groupState.patch(joinToken, { session: null })
    toast('Session expired — re-enter the passphrase.', 'err')
    return render()
  }
  if (!res.ok) {
    const d = await res.json().catch(() => null)
    return toast(friendlyError({ message: d && d.error, data: d }), 'err')
  }
  const blob = await res.blob()
  if (blob.size === 0) {
    groupState.patch(joinToken, { lastPulledAt: cursor })
    return toast('Nobody new since last time.', 'ok')
  }
  downloadBlob(blob, `${safeName(meta.name)}.vcf`)
  groupState.patch(joinToken, { lastPulledAt: cursor })
  refreshState()
  toast('Downloaded — open the file to import.', 'ok')
  renderMember()
}

function isAppleMobile() {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
}

async function removeSelf() {
  if (!confirm('Remove yourself from this group? Your entry will be deleted.')) return
  try {
    await api(`/api/members/${encodeURIComponent(state.memberToken)}`, { method: 'DELETE' })
  } catch {
    /* even on error, drop local state */
  }
  groupState.patch(joinToken, { memberToken: null, mine: null, lastPulledAt: null })
  meta.memberCount = Math.max(0, meta.memberCount - 1)
  toast('Removed. You can re-add yourself anytime.', 'ok')
  render()
}

// --- helpers ------------------------------------------------------------------
function labelEl(id, text, optional) {
  return el('span', { class: 'label' }, [
    el('label', { for: id }, [text]),
    optional ? el('span', { class: 'opt' }, ['  · optional']) : null,
  ])
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = el('a', { href: url, download: filename, rel: 'noopener' })
  document.body.append(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 6000)
}
function safeName(name) {
  return (name || 'contacts').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'contacts'
}
function plural(n, word) {
  return n === 1 ? word : word + 's'
}
