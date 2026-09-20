import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { WORKFLOW_DEFAULTS } from '../config/defaults.mjs'

function clone(value) {
  return structuredClone(value)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function deepMerge(base, override) {
  if (!isPlainObject(override)) return clone(override)
  const result = isPlainObject(base) ? clone(base) : {}
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) ? deepMerge(result[key], value) : clone(value)
  }
  return result
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`Cannot read ${path}: ${error.message}`)
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function git(repoRoot, args) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export function detectBaseBranch(repoRoot, remote = 'origin') {
  const remoteHead = git(repoRoot, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])
  if (remoteHead.startsWith(`${remote}/`)) return remoteHead.slice(remote.length + 1)
  for (const candidate of ['main', 'master']) {
    if (git(repoRoot, ['show-ref', '--verify', '--hash', `refs/heads/${candidate}`])) return candidate
  }
  return git(repoRoot, ['branch', '--show-current']) || 'main'
}

export async function detectPackageCommands(repoRoot) {
  const packageJsonPath = resolve(repoRoot, 'package.json')
  if (!(await exists(packageJsonPath))) return { install: null, fullCheck: null }

  const packageJson = await readJsonIfPresent(packageJsonPath)
  let manager = 'npm'
  if (await exists(resolve(repoRoot, 'pnpm-lock.yaml'))) manager = 'pnpm'
  else if (await exists(resolve(repoRoot, 'yarn.lock'))) manager = 'yarn'
  else if (await exists(resolve(repoRoot, 'bun.lockb')) || await exists(resolve(repoRoot, 'bun.lock'))) manager = 'bun'

  const install = {
    npm: await exists(resolve(repoRoot, 'package-lock.json')) ? 'npm ci' : 'npm install',
    pnpm: 'pnpm install --frozen-lockfile',
    yarn: 'yarn install --immutable',
    bun: 'bun install --frozen-lockfile',
  }[manager]

  const scripts = packageJson.scripts ?? {}
  const fullCheckName = ['check', 'verify', 'ci', 'test'].find((name) => scripts[name])
  if (!fullCheckName) return { install, fullCheck: null }
  const fullCheck = manager === 'yarn' ? `yarn ${fullCheckName}` : `${manager} run ${fullCheckName}`
  return { install, fullCheck }
}

export async function loadConfig(repoRoot) {
  const root = resolve(repoRoot)
  const project = await readJsonIfPresent(resolve(root, 'agent-workflow.config.json'))
  const local = await readJsonIfPresent(resolve(root, '.agent-workflow.local.json'))
  const config = deepMerge(deepMerge(WORKFLOW_DEFAULTS, project), local)

  if (config.tracker.provider !== 'linear') {
    throw new Error(`Unsupported tracker provider: ${config.tracker.provider}. Version 0.1 supports Linear.`)
  }
  try {
    new RegExp(config.tracker.cardPattern)
  } catch (error) {
    throw new Error(`Invalid tracker.cardPattern: ${error.message}`)
  }

  const detected = await detectPackageCommands(root)
  if (config.git.baseBranch === 'auto') config.git.baseBranch = detectBaseBranch(root, config.git.remote)
  if (config.commands.install === 'auto') config.commands.install = detected.install
  if (config.commands.fullCheck === 'auto') config.commands.fullCheck = detected.fullCheck
  return config
}

export function assertCard(card, cardPattern) {
  if (!new RegExp(cardPattern).test(card ?? '')) {
    throw new Error(`Card identifier does not match ${cardPattern}: ${card ?? '<missing>'}`)
  }
}
