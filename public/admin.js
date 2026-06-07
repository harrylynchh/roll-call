import { $, el, api, toast, friendlyError, fmtDate } from '/lib.js'

const adminToken = location.pathname.split('/').filter(Boolean).pop() || ''
const apiBase = `/api/admin/${encodeURIComponent(adminToken)}`
const root = $('#app-root')
let data = null

init()

async function init() {
  if (!adminToken) return renderNotFound()
  try {
    data = await api(apiBase)
  } catch {
    return renderNotFound()
  }
  document.title = `Manage · ${data.name}`
  render()
}

async function reload() {
  data = await api(apiBase)
  render()
}

function renderNotFound() {
  root.replaceChildren(
    el('div', { class: 'card center stack' }, [
      el('h1', { class: 'page-title' }, ['Not found']),
      el('p', { class: 'muted' }, ['This admin link is invalid or the group was deleted.']),
      el('a', { class: 'btn btn--ghost', href: '/' }, ['Go home']),
    ]),
  )
}

function render() {
  root.replaceChildren(
    el('div', {}, [
      el('h1', { class: 'page-title' }, ['Manage group']),
      el('p', { class: 'page-sub' }, [`Created ${fmtDate(data.createdAt)}`]),
    ]),
    renameCard(),
    membersCard(),
    passphraseCard(),
    dangerCard(),
  )
}

// --- rename -------------------------------------------------------------------
function renameCard() {
  const input = el('input', { class: 'input', id: 'gname', value: data.name, maxlength: 80, 'aria-label': 'Group name' })
  const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, ['Save'])
  const form = el('form', { class: 'card stack' }, [
    el('span', { class: 'label' }, ['Group name']),
    el('div', { class: 'linkrow' }, [input, btn]),
  ])
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = input.value.trim()
    if (!name) return toast('Name cannot be empty.', 'err')
    await guard(btn, 'Save', async () => {
      await api(apiBase, { method: 'PATCH', body: { name } })
      data.name = name
      document.title = `Manage · ${name}`
      toast('Renamed.', 'ok')
    })
  })
  return form
}

// --- members ------------------------------------------------------------------
function membersCard() {
  const list = data.members.length
    ? el(
        'ul',
        { class: 'mlist' },
        data.members.map((m) => memberItem(m)),
      )
    : el('p', { class: 'muted' }, ['No one has joined yet.'])
  return el('div', { class: 'card' }, [
    el('div', { class: 'metarow' }, [
      el('h2', { class: 'section-title', style: false }, ['Members']),
      el('span', { class: 'count-pill' }, [`${data.members.length}`]),
    ]),
    list,
  ])
}

function memberItem(m) {
  const phones = (m.phones || []).map((p) => p.number).join(' · ')
  const removeBtn = el('button', { class: 'btn btn--danger btn--sm', type: 'button' }, ['Remove'])
  removeBtn.addEventListener('click', async () => {
    if (!confirm(`Remove ${m.fn} from the group?`)) return
    await guard(removeBtn, 'Remove', async () => {
      await api(`${apiBase}/members/${m.id}`, { method: 'DELETE' })
      toast(`Removed ${m.fn}.`, 'ok')
      await reload()
    })
  })
  return el('li', {}, [
    el('div', {}, [el('div', { class: 'm-name' }, [m.fn]), el('div', { class: 'm-phone' }, [phones])]),
    removeBtn,
  ])
}

// --- change passphrase --------------------------------------------------------
function passphraseCard() {
  const input = el('input', {
    class: 'input',
    id: 'newpass',
    type: 'text',
    autocomplete: 'off',
    maxlength: 200,
    placeholder: 'new passphrase',
    'aria-label': 'New passphrase',
  })
  const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, ['Change'])
  const form = el('form', { class: 'card stack' }, [
    el('span', { class: 'label' }, ['Change passphrase']),
    el('div', { class: 'linkrow' }, [input, btn]),
    el('p', { class: 'hint' }, ['Heads up: this signs everyone out — they’ll need the new passphrase to pull the roster again.']),
  ])
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const passphrase = input.value
    if (!passphrase.trim()) return toast('Enter a new passphrase.', 'err')
    if (!confirm('Change the passphrase? Everyone will be signed out.')) return
    await guard(btn, 'Change', async () => {
      await api(apiBase, { method: 'PATCH', body: { passphrase } })
      input.value = ''
      toast('Passphrase changed.', 'ok')
    })
  })
  return form
}

// --- danger -------------------------------------------------------------------
function dangerCard() {
  const btn = el('button', { class: 'btn btn--danger btn--full', type: 'button' }, ['Delete this group'])
  btn.addEventListener('click', async () => {
    if (!confirm(`Permanently delete “${data.name}” and all ${data.members.length} member(s)? This cannot be undone.`)) return
    await guard(btn, 'Delete this group', async () => {
      await api(apiBase, { method: 'DELETE' })
      root.replaceChildren(
        el('div', { class: 'card center stack' }, [
          el('h1', { class: 'page-title' }, ['Group deleted']),
          el('p', { class: 'muted' }, ['Everything has been removed.']),
          el('a', { class: 'btn btn--ghost', href: '/' }, ['Go home']),
        ]),
      )
    })
  })
  return el('div', { class: 'card stack' }, [
    el('span', { class: 'label' }, ['Danger zone']),
    btn,
  ])
}

// --- helper -------------------------------------------------------------------
async function guard(btn, label, fn) {
  btn.disabled = true
  const html = btn.innerHTML
  btn.innerHTML = '<span class="spinner"></span>'
  try {
    await fn()
  } catch (err) {
    toast(friendlyError(err), 'err')
  } finally {
    btn.disabled = false
    if (btn.isConnected) btn.innerHTML = html
  }
}
