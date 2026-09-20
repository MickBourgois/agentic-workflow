const menuButton = document.querySelector('.menu-toggle')
const menu = document.querySelector('#main-navigation')

function closeMenu() {
  if (!menuButton || !menu) return
  menuButton.setAttribute('aria-expanded', 'false')
  menuButton.setAttribute('aria-label', 'Ouvrir la navigation')
  delete menu.dataset.open
}

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true'
  menuButton.setAttribute('aria-expanded', String(open))
  menuButton.setAttribute('aria-label', open ? 'Fermer la navigation' : 'Ouvrir la navigation')
  menu.dataset.open = String(open)
})
menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu))
document.addEventListener('keydown', function onEscape(event) {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    closeMenu()
    menuButton.focus()
  }
})

const riskTabs = [...document.querySelectorAll('[data-risk]')]
function selectRisk(tab, focus = false) {
  for (const item of riskTabs) {
    const active = item === tab
    item.setAttribute('aria-selected', String(active))
    item.tabIndex = active ? 0 : -1
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active
  }
  if (focus) tab.focus()
}
riskTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectRisk(tab))
  tab.addEventListener('keydown', (event) => {
    const indices = { ArrowRight: (index + 1) % riskTabs.length, ArrowLeft: (index + riskTabs.length - 1) % riskTabs.length, Home: 0, End: riskTabs.length - 1 }
    if (Object.hasOwn(indices, event.key)) {
      event.preventDefault()
      selectRisk(riskTabs[indices[event.key]], true)
    }
  })
})

let toastTimer
function notify(message) {
  const toast = document.querySelector('.toast')
  if (!toast) return
  clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add('visible')
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200)
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const code = button.closest('.code-block')?.querySelector('code')
    if (!code) return
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(code.textContent)
      notify('Commande copiée. À vous de jouer.')
    } catch {
      const range = document.createRange()
      range.selectNodeContents(code)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      notify('Copie indisponible. Le code est sélectionné : utilisez ⌘C ou Ctrl+C.')
    }
  })
})
