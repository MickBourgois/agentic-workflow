#!/usr/bin/env node

import { closeSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { assertCard, loadConfig } from './config.mjs'
import { assertReviewReady, readDeliveryState, routeFor, validateReviewReceipt } from './delivery-state.mjs'
import { runOwnedProcess } from './owned-process.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function boundedReworkContext(state, slot) {
  const previous = state.previousReview
  if (!['simple', 'standard'].includes(state.complexity) || !previous || previous.base !== state.baseSha
    || !previous.head || previous.head === state.baseSha) return null
  try {
    const receipt = previous.receipts.find((item) => item.reviewer_slot === slot)
    validateReviewReceipt({ currentHead: previous.head }, receipt)
    if (receipt.reviewed_base && receipt.reviewed_base !== state.baseSha) return null
    const ancestry = execFileSync('git', ['rev-list', '--parents', '-n', '1', state.currentHead],
      { cwd: state.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (ancestry === `${state.currentHead} ${previous.head}`) {
      return { head: previous.head, status: receipt.status, findings: receipt.findings ?? [] }
    }
  } catch {
    // Missing or invalid prior context requires a fresh review of the whole card.
  }
  return null
}

export async function runReview({ repoRoot, card, slot, timeoutMs = 1_800_000,
  codexBin = process.env.CODEX_BIN ?? 'codex', signal }) {
  repoRoot = realpathSync(repoRoot)
  const config = await loadConfig(repoRoot)
  assertCard(card, config.tracker.cardPattern)
  const state = await readDeliveryState(repoRoot, card)
  assertReviewReady(state)
  const slots = state.route.reviewers.length === 2 ? ['A', 'B'] : ['single']
  assert(slots.includes(slot), 'reviewer slot does not match card routing')
  assert(JSON.stringify(state.route.reviewers) === JSON.stringify(routeFor(state.complexity, state).reviewers),
    'review routing does not match installed engine')
  const route = state.route.reviewers[slots.indexOf(slot)]
  const parent = resolve(repoRoot, '.delivery', 'reviews', card)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const runDir = await mkdtemp(resolve(parent, `${slot}-`))
  const resultFile = resolve(runDir, 'result.json')
  const rework = boundedReworkContext(state, slot)
  const args = ['--no-daemon', 'exec', '--model', route.model, '-c', `model_reasoning_effort="${route.reasoning}"`,
    '--disable', 'multi_agent', '--sandbox', 'read-only', '--json',
    '--output-schema', resolve(SCRIPT_DIR, '..', 'schemas', 'review-result.schema.json'),
    '--output-last-message', resultFile, '--cd', state.worktree, '-']
  const prompt = [
    `Perform the repo-local /code-review yourself for ${card}. You are reviewer slot ${slot}.`,
    `Repository/worktree: ${state.worktree}`,
    `Frozen base: ${state.baseSha}; reviewed head: ${state.currentHead}.`,
    `Your route is ${route.model}/${route.reasoning}.`,
    'Read the card, project instructions, delivery contract and /code-review skill directly.',
    rework
      ? `Prior receipt for your slot only. Use it to scope the correction under /code-review: ${JSON.stringify(rework)}`
      : 'Use a complete diff review of the card. Read only code, tests and objective validation evidence.',
    'Review directly in this fresh context. Delegation is disabled; return your own review, not a wait or handoff.',
    'Implementation transcripts and other reviewers\' receipts are outside your review input.',
    'Use safe owned-process diagnostics from the delivery contract.',
    'Return only the schema-shaped exact-card/base/head/slot receipt. Do not edit, commit, ship or advance delivery state.',
  ].join('\n')
  const out = openSync(resolve(runDir, 'stdout.log'), 'wx', 0o600)
  const err = openSync(resolve(runDir, 'stderr.log'), 'wx', 0o600)
  let execution
  try {
    execution = await runOwnedProcess({ command: codexBin, args, cwd: state.worktree,
      stdio: ['pipe', out, err], input: prompt, signal, timeoutMs,
      onStatus: (status) => writeFileSync(resolve(runDir, 'process.json'), JSON.stringify({
        card, slot, model: route.model, reasoning: route.reasoning, ...status,
      }), { mode: 0o600 }) })
  } finally { closeSync(out); closeSync(err) }
  assert(execution.status === 0 && !execution.error && !execution.timedOut && !execution.aborted,
    `review process failed; inspect private process.json in ${runDir}`)
  const events = (await readFile(resolve(runDir, 'stdout.log'), 'utf8')).split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return null }
  })
  assert(events.some((event) => event?.type === 'item.completed' && event.item?.type === 'command_execution'
    && event.item.exit_code === 0), 'review produced no successful inspection command; inspect private events')
  let receipt
  try { receipt = JSON.parse(await readFile(resultFile, 'utf8')) }
  catch { throw new Error(`missing or invalid review result in ${runDir}`) }
  assert(receipt.card === card && receipt.reviewed_base === state.baseSha
    && receipt.reviewer_slot === slot, 'review result identity mismatch')
  assert(Array.isArray(receipt.findings) && Array.isArray(receipt.suggestions), 'complete structured review required')
  validateReviewReceipt(state, receipt)
  // Claimed coverage is checked by the orchestrator against the private events.
  assert(Array.isArray(receipt.inspected_files) && receipt.inspected_files.length > 0
    && receipt.inspected_files.every((file) => typeof file === 'string' && file.trim()), 'review must name inspected files')
  const current = await readDeliveryState(repoRoot, card)
  assert(current.baseSha === state.baseSha && current.currentHead === state.currentHead
    && JSON.stringify(current.route) === JSON.stringify(state.route), 'delivery changed during review')
  assertReviewReady(current)
  const receiptFile = resolve(runDir, 'receipt.json')
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { card, slot, runDir, receipt: receiptFile }
}

async function main() {
  const flags = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    assert(process.argv[index].startsWith('--') && process.argv[index + 1], 'expected --flag value')
    flags[process.argv[index].slice(2)] = process.argv[index + 1]
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  try {
    const result = await runReview({ repoRoot: flags.repo ?? process.cwd(), card: flags.card,
      slot: flags.slot, timeoutMs: Number(flags['timeout-ms'] ?? 1_800_000), signal: controller.signal })
    process.stdout.write(JSON.stringify(result) + '\n')
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
}

const isDirectRun = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
