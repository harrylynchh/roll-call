// Landing-page behavior. Minimal by design.
// The "Create a group" button is a placeholder until POST /api/groups exists
// (next build phase) — for now it reveals a friendly "coming soon" note.
(function () {
  'use strict'
  var cta = document.getElementById('create-cta')
  var soon = document.getElementById('soon')
  if (!cta || !soon) return

  cta.addEventListener('click', function () {
    soon.hidden = false
    soon.setAttribute('role', 'status')
    cta.setAttribute('aria-expanded', 'true')
    soon.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
})()
