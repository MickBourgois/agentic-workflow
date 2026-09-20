#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  'workflow', 'scripts', 'tests', 'docs', '.github',
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json',
  'install.sh', 'update.sh',
]
const forbidden = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'known token prefix', pattern: /(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})/ },
  { name: 'hard-coded credential', pattern: /(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'<>$\s]{8,}["']/i },
  { name: 'personal absolute path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: 'source product coupling', pattern: /ScrybeCast|Scrybecast|MickBourgois|Podcast Brand Brain|SCR-/i, managedOnly: true },
]

async function files(path) {
  const absolute = resolve(root, path)
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null)
  if (!entries) return [absolute]
  const output = []
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const child = resolve(absolute, entry.name)
    if (entry.isDirectory()) output.push(...await files(relative(root, child)))
    else if (entry.isFile()) output.push(child)
  }
  return output
}

const findings = []
for (const path of roots) {
  for (const file of await files(path)) {
    const relativePath = relative(root, file)
    if (relativePath === 'scripts/scan-secrets.mjs') continue
    const text = await readFile(file, 'utf8')
    for (const rule of forbidden) {
      const managedSurface = relativePath.startsWith('workflow/')
        || relativePath.startsWith('docs/')
        || relativePath.startsWith('.github/')
        || ['README.md', 'AGENTS.md', 'CLAUDE.md', 'install.sh', 'update.sh'].includes(relativePath)
      if (rule.managedOnly && !managedSurface) continue
      if (rule.pattern.test(text)) findings.push(`${relativePath}: ${rule.name}`)
    }
  }
}

if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Secret and coupling scan passed\n')
}
