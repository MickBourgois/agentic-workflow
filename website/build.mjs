import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXED_ROUTES, ROUTES, WORKFLOW_DEFAULTS } from '../workflow/config/defaults.mjs'
import { homePage } from './home.mjs'
import { docNavigation, docsPage } from './docs.mjs'
import { escapeHtml, shell } from './ui.mjs'

export const websiteRoot = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(websiteRoot, '..')

export function normalizeBasePath(value = '') {
  if (!value || value === '/') return ''
  const normalized = `/${value.replace(/^\/+|\/+$/g, '')}`
  if (!/^\/[a-zA-Z0-9_/-]+$/.test(normalized) || normalized.includes('//')) throw new Error('SITE_BASE_PATH must contain only safe URL path segments')
  return normalized
}

export async function buildSite({ output = join(websiteRoot, 'dist'), basePath = process.env.SITE_BASE_PATH ?? '', siteUrl = process.env.SITE_URL ?? '' } = {}) {
  const base = normalizeBasePath(basePath)
  if (siteUrl && (!/^https?:\/\//.test(siteUrl) || new URL(siteUrl).origin !== siteUrl)) throw new Error('SITE_URL must be an HTTP(S) origin without a trailing slash')
  const context = {
    version: (await readFile(join(repositoryRoot, 'VERSION'), 'utf8')).trim(),
    repository: 'https://github.com/MickBourgois/agentic-workflow',
    basePath: base, siteUrl, routes: ROUTES, fixed: FIXED_ROUTES, defaults: WORKFLOW_DEFAULTS,
  }
  await mkdir(output, { recursive: true })
  await cp(join(websiteRoot, 'assets'), join(output, 'assets'), { recursive: true })
  await writeFile(join(output, 'index.html'), homePage(context))
  const routes = ['/']
  for (const entry of docNavigation) {
    const route = `/docs/${entry.slug ? `${entry.slug}/` : ''}`
    const target = join(output, route)
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'index.html'), docsPage(entry.slug, context))
    routes.push(route)
  }
  await writeFile(join(output, '404.html'), shell({ title: 'Page introuvable — Agentic Workflow', description: 'Retrouvez la présentation et la documentation du workflow.', content: `<main id="main" class="not-found page-width"><div class="eyebrow">404 — HORS PARCOURS</div><h1>Reprenons<br><em>le fil.</em></h1><p>Cette page n’existe pas. Le guide vous attend.</p><a class="button button-accent" href="${base}/docs/">Ouvrir la documentation →</a></main>`, context, active: '404' }))
  await writeFile(join(output, 'robots.txt'), `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}${base}/sitemap.xml\n` : ''}`)
  if (siteUrl) await writeFile(join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${escapeHtml(siteUrl + base + route)}</loc></url>`).join('')}</urlset>`)
  return { output, routes, context }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite()
  process.stdout.write(`Built ${result.routes.length} pages in ${result.output}\n`)
}
