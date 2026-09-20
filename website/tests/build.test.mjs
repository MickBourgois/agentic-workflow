import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildSite, normalizeBasePath, repositoryRoot } from '../build.mjs'
import { ROUTES } from '../../workflow/config/defaults.mjs'

test('builds eight static pages with valid local links and anchors at root and under a project path', async () => {
  for (const basePath of ['', '/agentic-workflow']) {
    const output = await mkdtemp(join(tmpdir(), 'workflow-website-build-'))
    const { routes } = await buildSite({ output, basePath, siteUrl: 'https://example.com' })
    assert.equal(routes.length, 8)
    for (const route of routes) {
      const html = await readFile(join(output, route, 'index.html'), 'utf8')
      assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, route)
      assert.match(html, /<html lang="fr">/)
      assert.match(html, /<meta name="description"/)
      for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (/^https?:\/\//.test(href)) continue
        const url = new URL(href.replaceAll('&amp;', '&'), `https://example.com${basePath}${route}`)
        assert.ok(url.pathname.startsWith(`${basePath}/`), `Path escapes deployment base: ${href}`)
        let target = join(output, url.pathname.slice(basePath.length))
        if (url.pathname.endsWith('/')) target = join(target, 'index.html')
        await access(target)
        if (url.hash && target.endsWith('.html')) {
          const targetHtml = await readFile(target, 'utf8')
          assert.ok(targetHtml.includes(`id="${url.hash.slice(1)}"`), `Missing anchor ${href} from ${route}`)
        }
      }
    }
    const sitemap = await readFile(join(output, 'sitemap.xml'), 'utf8')
    assert.equal([...sitemap.matchAll(/<loc>/g)].length, routes.length)
    assert.ok(sitemap.includes(`https://example.com${basePath}/docs/installation/`))
  }
})

test('website reflects the canonical version, routed models, and critical review count', async () => {
  const output = await mkdtemp(join(tmpdir(), 'workflow-website-routes-'))
  await buildSite({ output })
  const html = await readFile(join(output, 'index.html'), 'utf8')
  const version = (await readFile(join(repositoryRoot, 'VERSION'), 'utf8')).trim()
  assert.ok(html.includes(`v${version}`))
  for (const [level, route] of Object.entries(ROUTES)) {
    const panel = html.split(`<div id="panel-${level}"`)[1].split('<div id="panel-')[0]
    assert.ok(panel.includes(route.implementation.model), `${level}: implementation model missing`)
    for (const reviewer of route.reviewers) assert.ok(panel.includes(reviewer.model))
  }
  assert.ok(html.includes('Deux approbations indépendantes requises'))
})

test('base-path validation rejects unsafe interpolation', () => {
  assert.equal(normalizeBasePath('agentic-workflow/'), '/agentic-workflow')
  assert.equal(normalizeBasePath('/'), '')
  assert.throws(() => normalizeBasePath('/a/../b'))
  assert.throws(() => normalizeBasePath('/"><script>'))
})
