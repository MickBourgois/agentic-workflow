import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { buildSite } from './build.mjs'

const { output, context } = await buildSite()
const root = resolve(output)
const port = Number(process.env.PORT ?? 4173)
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' }

createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (context.basePath && !pathname.startsWith(`${context.basePath}/`)) { response.writeHead(404); response.end(); return }
    const local = pathname.slice(context.basePath.length)
    let target = resolve(root, `.${local}`)
    if (target !== root && !target.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return }
    const info = await stat(target).catch(() => null)
    if (info?.isDirectory()) {
      if (!pathname.endsWith('/')) { response.writeHead(308, { Location: `${pathname}/` }); response.end(); return }
      target = resolve(target, 'index.html')
    }
    const content = await readFile(target).catch(() => null)
    response.writeHead(content ? 200 : 404, { 'Content-Type': content ? (types[extname(target)] ?? 'application/octet-stream') : types['.html'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : (content ?? await readFile(resolve(root, '404.html'))))
  } catch {
    response.writeHead(400)
    response.end('Bad request')
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Website ready: http://127.0.0.1:${port}${context.basePath}/\nRe-run after editing source files to rebuild.\n`))
