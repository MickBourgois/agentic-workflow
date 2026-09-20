#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXED_ROUTES } from '../config/defaults.mjs'
import { assertCard, loadConfig } from './config.mjs'
import { runCard } from './run-card.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO = resolve(SCRIPT_DIR, '..', '..')

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function spawnAndPipe(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code ?? signal}`)))
  })
}

export async function buildSelectorCommand({ repoRoot, outputFile, seen = [], query = '', codexBin = process.env.CODEX_BIN ?? 'codex' }) {
  const config = await loadConfig(repoRoot)
  if (!config.tracker.team) throw new Error('Set tracker.team in agent-workflow.config.json before running the backlog loop')
  const schema = resolve(SCRIPT_DIR, '..', 'schemas', 'backlog-selection.schema.json')
  const route = FIXED_ROUTES.backlogSelector
  const prompt = [
    `Act only as the outer Linear backlog selector for team ${config.tracker.team}. Do not modify Linear, Git, or files.`,
    `Select at most one card in status ${config.tracker.statuses.ready}.`,
    `Require labels ${config.tracker.labels.readyForAgent} and ${config.tracker.labels.hardened}, zero open native blockers,`,
    'and exactly one valid <!-- delivery-routing:v1 --> comment.',
    'Never select a parent or umbrella issue when an executable hardened child exists.',
    `Exclude cards already handled by this loop: ${seen.length ? seen.join(', ') : 'none'}.`,
    query ? `Additional user filter: ${query}` : '',
    'Return selected with one card, empty when none is eligible, or needs_human for contradictory state.',
    'Return only the JSON object required by the output schema.',
  ].filter(Boolean).join('\n')
  return {
    command: codexBin,
    args: [
      'exec', '--ephemeral', '--model', route.model,
      '-c', `model_reasoning_effort="${route.reasoning}"`,
      '--sandbox', 'read-only', '--approve-for-me',
      '--output-schema', schema, '--output-last-message', outputFile,
      '--cd', repoRoot, prompt,
    ],
  }
}

export async function selectNextCard({ repoRoot, runDir, seen, query = '', spawnProcess = spawnAndPipe, iteration }) {
  const outputFile = resolve(runDir, `selection-${iteration}.json`)
  const command = await buildSelectorCommand({ repoRoot, outputFile, seen, query })
  await spawnProcess(command.command, command.args, { cwd: repoRoot })
  return JSON.parse(await readFile(outputFile, 'utf8'))
}

export async function runBacklogLoop({
  repoRoot = DEFAULT_REPO,
  maxCards = 10,
  query = '',
  choose = selectNextCard,
  deliver = runCard,
  dryRun = false,
}) {
  if (!Number.isInteger(maxCards) || maxCards < 1) throw new Error('maxCards must be a positive integer')
  const config = await loadConfig(repoRoot)
  const runDir = resolve(repoRoot, '.delivery', 'backlog-runs', timestamp())
  const seen = []
  const results = []
  if (dryRun) {
    const selector = await buildSelectorCommand({ repoRoot, outputFile: resolve(runDir, 'selection-1.json'), seen, query })
    return { status: 'dry_run', reason: 'No selector or card session launched', seen, results, runDir, selector }
  }
  await mkdir(runDir, { recursive: true })
  for (let iteration = 1; iteration <= maxCards; iteration += 1) {
    const selection = await choose({ repoRoot, runDir, seen: [...seen], query, iteration })
    if (selection.status === 'empty') return { status: 'complete', reason: selection.reason, seen, results, runDir }
    if (selection.status === 'needs_human') return { status: 'needs_human', reason: selection.reason, seen, results, runDir }
    if (selection.status !== 'selected') throw new Error(`Invalid selector result: ${JSON.stringify(selection)}`)
    assertCard(selection.card, config.tracker.cardPattern)
    if (seen.includes(selection.card)) throw new Error(`Selector repeated ${selection.card}`)
    seen.push(selection.card)
    const delivery = await deliver({ card: selection.card, repoRoot })
    results.push(delivery)
    if (delivery.result.status !== 'done') return { status: delivery.result.status, reason: delivery.result.summary, seen, results, runDir }
  }
  return { status: 'needs_human', reason: `Safety limit of ${maxCards} cards reached`, seen, results, runDir }
}

function parseArgs(args) {
  let maxCards = 10
  let query = ''
  let dryRun = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--max-cards') maxCards = Number(args[++index])
    else if (args[index] === '--query') query = args[++index]
    else if (args[index] === '--dry-run') dryRun = true
    else throw new Error(`Unknown argument: ${args[index]}`)
  }
  return { maxCards, query, dryRun }
}

async function main() {
  const outcome = await runBacklogLoop(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`)
  if (!['complete', 'dry_run'].includes(outcome.status)) process.exitCode = 2
}

const isDirectRun = process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
