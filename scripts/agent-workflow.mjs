#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = '.agent-workflow/manifest.json'
const MANIFEST_FORMAT = 1
const GITIGNORE_START = '# >>> agentic-workflow managed ignores >>>'
const GITIGNORE_END = '# <<< agentic-workflow managed ignores <<<'
const GITIGNORE_BLOCK = `${GITIGNORE_START}\n.agent-workflow.local.json\n.delivery/\n.agent-workflow/conflicts/\n.agent-workflow/backups/\n${GITIGNORE_END}`

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

function slash(path) {
  return path.split(sep).join('/')
}

async function listFiles(root) {
  const output = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) output.push(absolute)
      else throw new Error(`Unsupported source entry: ${absolute}`)
    }
  }
  await visit(root)
  return output.sort()
}

async function buildPayload() {
  const mappings = [
    ['workflow/skills', '.agents/skills'],
    ['workflow/agents/codex', '.codex/agents'],
    ['workflow/commands/claude', '.claude/commands'],
    ['workflow/contracts', '.agent-workflow/contracts'],
    ['workflow/orchestrator', '.agent-workflow/bin'],
    ['workflow/schemas', '.agent-workflow/schemas'],
  ]
  const payload = new Map()
  for (const [sourceDirectory, targetDirectory] of mappings) {
    const absoluteSource = resolve(SOURCE_ROOT, sourceDirectory)
    for (const source of await listFiles(absoluteSource)) {
      const target = slash(`${targetDirectory}/${relative(absoluteSource, source)}`)
      payload.set(target, await readFile(source))
    }
  }
  payload.set('.agent-workflow/config/defaults.mjs', await readFile(resolve(SOURCE_ROOT, 'workflow/config/defaults.mjs')))
  payload.set('.agent-workflow/config.schema.json', await readFile(resolve(SOURCE_ROOT, 'workflow/config/config.schema.json')))
  payload.set('.agent-workflow/examples/agent-workflow.local.json', await readFile(resolve(SOURCE_ROOT, 'workflow/templates/agent-workflow.local.example.json')))
  payload.set('.agent-workflow/VERSION', await readFile(resolve(SOURCE_ROOT, 'VERSION')))
  return payload
}

function assertTargetProject(target) {
  const top = execFileSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (realpathSync(top) !== realpathSync(target)) {
    throw new Error(`Target must be a Git repository root: ${target}`)
  }
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-agentic-workflow`
  await writeFile(temporary, content)
  await rename(temporary, path)
}

async function writeIncoming(targetRoot, runId, relativePath, content) {
  const path = resolve(targetRoot, '.agent-workflow', 'conflicts', runId, relativePath)
  await writeAtomic(path, content)
  return slash(relative(targetRoot, path))
}

async function updateGitignore(targetRoot) {
  const path = resolve(targetRoot, '.gitignore')
  const current = await exists(path) ? await readFile(path, 'utf8') : ''
  const pattern = new RegExp(`${GITIGNORE_START.replaceAll('>', '\\>')}[\\s\\S]*?${GITIGNORE_END.replaceAll('<', '\\<')}`, 'm')
  let next
  if (pattern.test(current)) next = current.replace(pattern, GITIGNORE_BLOCK)
  else next = `${current.replace(/\s*$/, '')}${current.trim() ? '\n\n' : ''}${GITIGNORE_BLOCK}\n`
  if (next !== current) await writeAtomic(path, next)
  return next !== current
}

async function ensureProjectConfig(targetRoot) {
  const target = resolve(targetRoot, 'agent-workflow.config.json')
  if (await exists(target)) return 'preserved'
  const template = await readFile(resolve(SOURCE_ROOT, 'workflow/templates/agent-workflow.config.json'))
  await writeAtomic(target, template)
  return 'created'
}

async function installOrUpdate(mode, targetRoot) {
  const target = resolve(targetRoot)
  if (!(await exists(target)) || !(await stat(target)).isDirectory()) throw new Error(`Target directory does not exist: ${target}`)
  assertTargetProject(target)
  const version = (await readFile(resolve(SOURCE_ROOT, 'VERSION'), 'utf8')).trim()
  const payload = await buildPayload()
  const oldManifest = await readJson(resolve(target, MANIFEST_PATH), { files: {} })
  if (mode === 'update' && !oldManifest.installedVersion) {
    throw new Error(`No installed workflow manifest at ${resolve(target, MANIFEST_PATH)}; run install first`)
  }

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const summary = { mode, version, target, created: [], updated: [], unchanged: [], conflicts: [], backedUp: [] }
  const nextFiles = {}

  for (const [relativePath, desiredContent] of payload) {
    const destination = resolve(target, relativePath)
    const desiredSha = sha256(desiredContent)
    const previous = oldManifest.files?.[relativePath]
    if (!(await exists(destination))) {
      await writeAtomic(destination, desiredContent)
      nextFiles[relativePath] = { managedSha256: desiredSha, sourceSha256: desiredSha, status: 'managed' }
      summary.created.push(relativePath)
      continue
    }

    const currentContent = await readFile(destination)
    const currentSha = sha256(currentContent)
    if (currentSha === desiredSha) {
      nextFiles[relativePath] = { managedSha256: desiredSha, sourceSha256: desiredSha, status: 'managed' }
      summary.unchanged.push(relativePath)
      continue
    }

    if (previous?.managedSha256 && currentSha === previous.managedSha256) {
      await writeAtomic(destination, desiredContent)
      nextFiles[relativePath] = { managedSha256: desiredSha, sourceSha256: desiredSha, status: 'managed' }
      summary.updated.push(relativePath)
      continue
    }

    const incoming = await writeIncoming(target, runId, relativePath, desiredContent)
    nextFiles[relativePath] = {
      managedSha256: previous?.managedSha256 ?? null,
      sourceSha256: desiredSha,
      status: 'conflict',
      incoming,
    }
    summary.conflicts.push({ path: relativePath, incoming })
  }

  for (const [relativePath, previous] of Object.entries(oldManifest.files ?? {})) {
    if (payload.has(relativePath)) continue
    const destination = resolve(target, relativePath)
    if (!(await exists(destination))) continue
    const currentSha = sha256(await readFile(destination))
    if (previous.managedSha256 && currentSha === previous.managedSha256) {
      const backup = resolve(target, '.agent-workflow', 'backups', runId, relativePath)
      await mkdir(dirname(backup), { recursive: true })
      await rename(destination, backup)
      summary.backedUp.push({ path: relativePath, backup: slash(relative(target, backup)) })
    } else {
      nextFiles[relativePath] = { ...previous, status: 'orphan-modified' }
      summary.conflicts.push({ path: relativePath, reason: 'obsolete managed file was modified; preserved in place' })
    }
  }

  const config = await ensureProjectConfig(target)
  const gitignoreUpdated = await updateGitignore(target)
  const manifest = {
    format: MANIFEST_FORMAT,
    installedVersion: version,
    installedAt: new Date().toISOString(),
    projectConfig: { path: 'agent-workflow.config.json', ownership: 'project', status: config },
    localConfig: { path: '.agent-workflow.local.json', ownership: 'machine', gitignored: true },
    conflicts: summary.conflicts,
    files: nextFiles,
  }
  await writeAtomic(resolve(target, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`)
  summary.projectConfig = config
  summary.gitignoreUpdated = gitignoreUpdated
  return summary
}

function printSummary(summary) {
  process.stdout.write(`agentic-workflow ${summary.version}: ${summary.mode} -> ${summary.target}\n`)
  process.stdout.write(`created ${summary.created.length}, updated ${summary.updated.length}, unchanged ${summary.unchanged.length}, backed up ${summary.backedUp.length}, conflicts ${summary.conflicts.length}\n`)
  process.stdout.write(`project config: ${summary.projectConfig}; .gitignore: ${summary.gitignoreUpdated ? 'updated' : 'unchanged'}\n`)
  for (const item of summary.conflicts) {
    process.stdout.write(`CONFLICT ${item.path}${item.incoming ? ` (incoming: ${item.incoming})` : ` (${item.reason})`}\n`)
  }
}

export { buildPayload, installOrUpdate }

async function main() {
  const [command, target = '.'] = process.argv.slice(2)
  if (!['install', 'update'].includes(command)) throw new Error('Usage: agent-workflow.mjs <install|update> [target-repo]')
  const summary = await installOrUpdate(command, target)
  printSummary(summary)
  if (summary.conflicts.length) process.exitCode = 2
}

const isDirectRun = process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
