#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXED_ROUTES } from '../config/defaults.mjs'
import { assertCard, loadConfig } from './config.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO = resolve(SCRIPT_DIR, '..', '..')

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export async function buildCardCommand({ card, repoRoot = DEFAULT_REPO, outputFile, codexBin = process.env.CODEX_BIN ?? 'codex' }) {
  const config = await loadConfig(repoRoot)
  assertCard(card, config.tracker.cardPattern)
  const schema = resolve(SCRIPT_DIR, '..', 'schemas', 'card-result.schema.json')
  const route = FIXED_ROUTES.orchestrator
  const prompt = [
    `Invoke the repo-local /start-card skill for ${card}.`,
    'This top-level process owns exactly this card and must reach DONE, NEEDS_HUMAN, or FAILED.',
    'Use fresh custom-agent contexts for implementation, review, rework, and shipping as the skill specifies.',
    'Do not select, queue, or start another card.',
    'Return only the JSON object required by the provided output schema.',
  ].join('\n')
  return {
    command: codexBin,
    args: [
      'exec', '--model', route.model,
      '-c', `model_reasoning_effort="${route.reasoning}"`,
      '--sandbox', 'workspace-write', '--approve-for-me',
      '--output-schema', schema, '--output-last-message', outputFile,
      '--cd', repoRoot, prompt,
    ],
  }
}

function spawnAndPipe(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

export async function runCard({ card, repoRoot = DEFAULT_REPO, dryRun = false, spawnProcess = spawnAndPipe }) {
  const config = await loadConfig(repoRoot)
  assertCard(card, config.tracker.cardPattern)
  const runDir = resolve(repoRoot, '.delivery', 'runs', `${timestamp()}-${card.toLowerCase()}`)
  const outputFile = resolve(runDir, 'result.json')
  const command = await buildCardCommand({ card, repoRoot, outputFile })
  if (dryRun) return { card, runDir, outputFile, command, result: null }
  await mkdir(runDir, { recursive: true })
  await spawnProcess(command.command, command.args, { cwd: repoRoot })
  const result = JSON.parse(await readFile(outputFile, 'utf8'))
  if (result.card !== card) throw new Error(`Card runner returned ${result.card}, expected ${card}`)
  return { card, runDir, outputFile, command, result }
}

function parseArgs(args) {
  return { card: args.find((arg) => !arg.startsWith('--')), dryRun: args.includes('--dry-run') }
}

async function main() {
  const { card, dryRun } = parseArgs(process.argv.slice(2))
  const outcome = await runCard({ card, dryRun })
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`)
  if (outcome.result && outcome.result.status !== 'done') process.exitCode = 2
}

const isDirectRun = process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
