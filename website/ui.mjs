export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

const paths = {
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  external: '<path d="M14 4h6v6M20 4 10 14"/><path d="M10 4H4v16h16v-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  code: '<path d="m8 5-7 7 7 7m8-14 7 7-7 7M14 3l-4 18"/>',
  review: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5m-14-11 2 2 4-4"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10c0 7-12 3-12 10"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
  terminal: '<path d="m5 7 5 5-5 5m9 0h6"/>',
  book: '<path d="M12 5v16M2 3c4-1 7 0 10 2 3-2 6-3 10-2v16c-4-1-7 0-10 2-3-2-6-3-10-2V3Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  github: '<path d="M9 19c-5 1-5-2-7-2m14 5v-4a3 3 0 0 0-.8-2.3C18 15.4 21 14 21 9a6 6 0 0 0-1.7-4.2A5 5 0 0 0 19.1 1S17.8.6 15 2.6a14 14 0 0 0-7 0C5.2.6 3.9 1 3.9 1a5 5 0 0 0-.2 3.8A6 6 0 0 0 2 9c0 5 3 6.4 5.8 6.7A3 3 0 0 0 7 18v4"/>',
}

export const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.arrow}</svg>`
export const mark = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 8h10v6h12M5 24h10v-6h12M15 8V4M15 24v4" stroke="currentColor" stroke-width="2"/><circle cx="5" cy="8" r="3" fill="currentColor"/><circle cx="5" cy="24" r="3" fill="currentColor"/><rect x="23" y="11" width="6" height="10" rx="2" fill="currentColor"/></svg>`
export const modelName = (model) => model.replace(/^gpt-[\d.]+-/, '').replace(/^./, (letter) => letter.toUpperCase())
export const routeLabel = (route) => `${modelName(route.model)} <span>/ ${escapeHtml(route.reasoning)}</span>`

export function codeBlock(code, label = 'Terminal') {
  return `<div class="code-block"><div class="code-caption"><span>${escapeHtml(label)}</span><button type="button" class="copy-button" data-copy aria-label="Copier le code">${icon('copy')}<span>Copier</span></button></div><pre><code>${escapeHtml(code)}</code></pre></div>`
}

export function shell({ title, description, content, context, active = '', isHome = false }) {
  const { version, repository, basePath, siteUrl } = context
  const url = (path) => `${basePath}${path}`
  const canonical = siteUrl ? `${siteUrl}${url(isHome ? '/' : `/${active}/`)}` : null
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="theme-color" content="#f8f7f3">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:locale" content="fr_FR"><meta name="twitter:card" content="summary_large_image">
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(`${siteUrl}${url('/assets/social.svg')}`)}">` : ''}
<link rel="icon" href="${url('/assets/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${url('/assets/style.css')}"><script type="module" src="${url('/assets/app.js')}"></script>
</head>
<body class="${isHome ? 'home' : 'documentation'}">
<a class="skip-link" href="#main">Aller au contenu</a>
<header class="site-header"><div class="header-inner">
<a class="brand" href="${url('/')}" aria-label="Agentic Workflow — accueil"><span class="brand-mark">${mark}</span><span>agentic<span class="brand-light">workflow</span><span class="brand-period">.</span></span></a>
<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-navigation" aria-label="Ouvrir la navigation">${icon('menu')}</button>
<nav id="main-navigation" aria-label="Navigation principale"><a href="${url('/#methode')}">La méthode</a><a href="${url('/#skills')}">Les skills</a><a ${active.startsWith('docs') ? 'aria-current="page"' : ''} href="${url('/docs/')}">Documentation</a><a class="nav-github" href="${repository}">${icon('github')}<span>GitHub</span>${icon('external')}</a><a class="button button-small button-dark" href="${url('/docs/installation/')}">Commencer ${icon('arrow')}</a></nav>
</div></header>
${content}
<footer class="site-footer"><div class="footer-top"><a class="brand" href="${url('/')}"><span class="brand-mark">${mark}</span><span>agentic<span class="brand-light">workflow</span><span class="brand-period">.</span></span></a><p>Du code. Une méthode. Des preuves.</p><a href="${repository}">Contribuer sur GitHub ${icon('external')}</a></div><div class="footer-bottom"><span>Open source · Licence MIT · v${escapeHtml(version)}</span><span>Construit pour les développeurs qui tiennent à leur code.</span></div></footer>
<div class="toast" role="status" aria-live="polite"></div>
</body></html>`
}
