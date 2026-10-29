#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { ROUTES, WORKFLOW_DEFAULTS } from '../config/defaults.mjs'
import { assertCard, loadConfig } from './config.mjs'

export const DELIVERY_STATE_VERSION = 1
export const TERMINAL_STATES = new Set(['DONE', 'NEEDS_HUMAN', 'FAILED'])

function copy(value) {
  return structuredClone(value)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function isHighEffortComplex({ score = 0, highEffort = false, dimensions = {} } = {}) {
  return highEffort
    || score >= 15
    || ['ambiguity', 'testDifficulty', 'regressionRisk'].some((key) => Number(dimensions[key] ?? 0) >= 2)
}

export function routeFor(complexity, evidence = {}) {
  assert(Object.hasOwn(ROUTES, complexity), `Unknown complexity: ${complexity}`)
  const route = copy(ROUTES[complexity])
  if (complexity === 'complex' && isHighEffortComplex(evidence)) {
    route.implementation.reasoning = 'high'
  }
  return route
}

export function escalateImplementationRoute(route) {
  const current = route.implementation
  if (current.model === 'gpt-6.1-sol' && current.reasoning === 'high') return null
  const escalated = copy(route)
  escalated.implementation = { model: 'gpt-6.1-sol', reasoning: 'high' }
  return escalated
}

export function createDeliveryState({
  card,
  cardPattern = WORKFLOW_DEFAULTS.tracker.cardPattern,
  complexity,
  score = 0,
  highEffort = false,
  dimensions = {},
  baseSha = null,
  branch = null,
  worktree = null,
  maxReworkCycles = WORKFLOW_DEFAULTS.delivery.maxReworkCycles,
  maxEscalations = WORKFLOW_DEFAULTS.delivery.maxEscalations,
  completionCheck = null,
}) {
  assertCard(card, cardPattern)
  const now = new Date().toISOString()
  return {
    version: DELIVERY_STATE_VERSION,
    card,
    state: 'READY',
    complexity,
    score,
    dimensions,
    highEffort: isHighEffortComplex({ score, highEffort, dimensions }),
    route: routeFor(complexity, { score, highEffort, dimensions }),
    policy: { maxReworkCycles, maxEscalations, completionCheck },
    baseSha,
    currentHead: null,
    branch,
    worktree,
    pr: null,
    reworkCycles: 0,
    escalationCount: 0,
    failureFingerprints: {},
    reviewReceipts: [],
    lastAction: 'dispatch_implementation',
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, from: null, event: 'init', to: 'READY' }],
  }
}

function requireState(state, expected, event) {
  assert(state.state === expected, `${event} requires ${expected}, got ${state.state}`)
}

function requiredReviewSlots(state) {
  return state.route.reviewers.length === 2 ? ['A', 'B'] : ['single']
}

function validateReviewReceipts(state, receipts) {
  assert(Array.isArray(receipts), 'review receipts must be an array')
  assert(receipts.length === state.route.reviewers.length,
    `expected ${state.route.reviewers.length} review receipt(s), got ${receipts.length}`)
  for (const receipt of receipts) {
    assert(receipt.reviewed_head === state.currentHead, 'review receipt head does not match current head')
    assert(['approved', 'findings'].includes(receipt.status), 'invalid review receipt status')
  }
  const actual = receipts.map((receipt) => receipt.reviewer_slot).sort()
  const expected = requiredReviewSlots(state).sort()
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `expected review slot(s) ${expected.join(', ')}, got ${actual.join(', ')}`)
}

function nextActionForState(state) {
  return {
    READY: 'dispatch_implementation',
    IMPLEMENTING: 'wait_for_implementation',
    REVIEWING: 'dispatch_independent_review',
    REWORKING: 'dispatch_rework',
    APPROVED: 'dispatch_shipping',
    SHIPPING: 'wait_for_shipping',
  }[state] ?? 'stop'
}

export function transitionDeliveryState(current, event, payload = {}) {
  assert(!TERMINAL_STATES.has(current.state), `terminal state ${current.state} cannot transition`)
  const state = copy(current)
  const from = state.state
  const maxReworkCycles = state.policy?.maxReworkCycles ?? WORKFLOW_DEFAULTS.delivery.maxReworkCycles
  const maxEscalations = state.policy?.maxEscalations ?? WORKFLOW_DEFAULTS.delivery.maxEscalations

  switch (event) {
    case 'start_implementation':
      requireState(state, 'READY', event)
      state.state = 'IMPLEMENTING'
      break
    case 'implementation_complete':
      requireState(state, 'IMPLEMENTING', event)
      assert(payload.commit, 'implementation_complete requires commit')
      state.currentHead = payload.commit
      state.validation = payload.validation ?? null
      state.state = 'REVIEWING'
      break
    case 'review_approved':
      requireState(state, 'REVIEWING', event)
      validateReviewReceipts(state, payload.receipts)
      assert(payload.receipts.every((receipt) => receipt.status === 'approved'), 'all reviews must approve')
      state.reviewReceipts = payload.receipts
      state.state = 'APPROVED'
      break
    case 'review_findings':
      requireState(state, 'REVIEWING', event)
      validateReviewReceipts(state, payload.receipts)
      assert(payload.receipts.some((receipt) => receipt.status === 'findings'), 'findings receipt required')
      assert(Array.isArray(payload.findings) && payload.findings.length > 0, 'actionable findings required')
      state.reviewReceipts = payload.receipts
      state.findings = payload.findings
      if (state.reworkCycles >= maxReworkCycles) {
        state.state = 'NEEDS_HUMAN'
        state.reason = 'rework_limit_reached'
      } else {
        state.state = 'REWORKING'
      }
      break
    case 'rework_complete':
      requireState(state, 'REWORKING', event)
      assert(payload.commit, 'rework_complete requires commit')
      assert(payload.commit !== state.currentHead, 'rework must produce a new commit')
      state.previousHead = state.currentHead
      state.currentHead = payload.commit
      state.validation = payload.validation ?? state.validation ?? null
      state.reworkCycles += 1
      state.reviewReceipts = []
      state.findings = []
      state.state = 'REVIEWING'
      break
    case 'start_shipping':
      requireState(state, 'APPROVED', event)
      state.state = 'SHIPPING'
      break
    case 'shipped':
      requireState(state, 'SHIPPING', event)
      assert(payload.mergeCommit, 'shipped requires mergeCommit')
      assert(payload.pr, 'shipped requires pr')
      if (state.policy?.completionCheck) {
        const proof = payload.completion
        assert(proof?.result === 'passed' && proof.head === state.currentHead
          && proof.base === state.baseSha && proof.mergeCommit === payload.mergeCommit,
        'shipped requires matching project completion proof')
        for (const key of ['runtime', 'ci', 'tracker', 'cleanup', 'smoke', 'deployment']) {
          if (proof[key] !== undefined) state[key] = copy(proof[key])
        }
        state.completion = copy(proof)
      }
      state.mergeCommit = payload.mergeCommit
      state.pr = payload.pr
      state.deployment = payload.completion?.deployment ?? payload.deployment ?? null
      state.state = 'DONE'
      break
    case 'phase_failure': { // bounded, evidence-driven retry
      assert(payload.fingerprint, 'phase_failure requires a normalized fingerprint')
      const count = (state.failureFingerprints[payload.fingerprint] ?? 0) + 1
      state.failureFingerprints[payload.fingerprint] = count
      if (count >= 3 || (count >= 2 && state.escalationCount >= maxEscalations)) {
        state.state = 'NEEDS_HUMAN'
        state.reason = `repeated_failure:${payload.fingerprint}`
      } else if (count === 2) {
        const escalated = escalateImplementationRoute(state.route)
        if (!escalated) {
          state.state = 'NEEDS_HUMAN'
          state.reason = `no_further_escalation:${payload.fingerprint}`
        } else {
          state.route = escalated
          state.escalationCount += 1
        }
      }
      break
    }
    case 'needs_human':
      state.state = 'NEEDS_HUMAN'
      state.reason = payload.reason ?? 'human_decision_required'
      break
    case 'failed':
      state.state = 'FAILED'
      state.reason = payload.reason ?? 'unrecoverable_failure'
      break
    default:
      throw new Error(`Unknown delivery event: ${event}`)
  }

  const now = new Date().toISOString()
  state.updatedAt = now
  state.lastAction = nextActionForState(state.state)
  state.history.push({ at: now, from, event, to: state.state })
  return state
}

export function statePath(repoRoot, card) {
  return resolve(repoRoot, '.delivery', 'state', `${card.toUpperCase()}.json`)
}

export async function readDeliveryState(repoRoot, card) {
  return JSON.parse(await readFile(statePath(repoRoot, card), 'utf8'))
}

export async function writeDeliveryState(repoRoot, state) {
  const target = statePath(repoRoot, state.card)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, target)
  const checkpoint = resolve(repoRoot, '.delivery', 'checkpoints', `${state.card}.md`)
  await mkdir(dirname(checkpoint), { recursive: true })
  await writeFile(`${checkpoint}.tmp`, deliveryCheckpoint(state), { mode: 0o600 })
  await rename(`${checkpoint}.tmp`, checkpoint)
  return target
}

export function deliverySummary(state) {
  const summary = {}
  for (const key of ['card', 'state', 'branch', 'worktree', 'baseSha', 'currentHead', 'reworkCycles', 'lastAction', 'pr', 'mergeCommit', 'updatedAt']) {
    if (state[key] !== undefined) summary[key] = state[key]
  }
  const fields = {
    ci: ['runId', 'head', 'status', 'conclusion', 'url'],
    runtime: ['restoreRequired', 'vmState', 'actualMemoryGiB', 'restorationProof', 'foregroundSession'],
    cleanup: ['worktreeRemoved', 'metadataPruned', 'archive', 'manifestSha256'],
    tracker: ['status', 'checkpointId', 'completedAt'],
    validation: ['receipt', 'binding', 'head', 'result'],
  }
  for (const [key, names] of Object.entries(fields)) {
    if (state[key]) summary[key] = Object.fromEntries(names.filter(name => state[key][name] !== undefined).map(name => [name, state[key][name]]))
  }
  if (state.deployment) summary.deployment = {
    id: state.deployment.id, readyState: state.deployment.readyState,
    commitSha: state.deployment.meta?.githubCommitSha ?? state.deployment.commitSha,
  }
  if (state.pr && typeof state.pr === 'object') summary.pr = { number: state.pr.number, url: state.pr.url }
  return summary
}

export function deliveryCheckpoint(state) {
  const checkpoint = { ...deliverySummary(state), reviewReceipts: state.reviewReceipts,
    validation: state.validation, escalationCount: state.escalationCount }
  return '<!-- delivery-checkpoint:v1 -->\n\n```json\n' + JSON.stringify(checkpoint, null, 2) + '\n```\n'
}

export function checkProjectCompletion(repoRoot, state, payload, config) {
  const script = config.commands.completionCheck
  assert(typeof script === 'string' && script.length > 0, 'completion check not configured')
  try {
    const output = execFileSync(process.execPath, [resolve(repoRoot, script)], {
      cwd: repoRoot, input: JSON.stringify({ state, payload, config }), encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
    })
    const proof = JSON.parse(output)
    assert(proof?.result === 'passed', 'invalid completion proof')
    return proof
  } catch {
    throw new Error('PROJECT_COMPLETION_CHECK_FAILED')
  }
}

function parseFlags(args) {
  const flags = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    assert(key?.startsWith('--'), `Expected flag, got ${key ?? 'nothing'}`)
    flags[key.slice(2)] = args[index + 1]
  }
  return flags
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const flags = parseFlags(args)
  const repoRoot = resolve(flags.repo ?? process.cwd())
  const config = await loadConfig(repoRoot)
  if (command === 'init') {
    const state = createDeliveryState({
      card: flags.card,
      cardPattern: config.tracker.cardPattern,
      complexity: flags.complexity,
      score: Number(flags.score ?? 0),
      highEffort: flags['high-effort'] === 'true',
      dimensions: flags.dimensions ? JSON.parse(flags.dimensions) : {},
      baseSha: flags.base ?? null,
      branch: flags.branch ?? null,
      worktree: flags.worktree ?? null,
      maxReworkCycles: config.delivery.maxReworkCycles,
      maxEscalations: config.delivery.maxEscalations,
      completionCheck: config.commands.completionCheck,
    })
    await writeDeliveryState(repoRoot, state)
    process.stdout.write(`${JSON.stringify(state)}\n`)
    return
  }
  if (command === 'show' || command === 'summary') {
    const state = await readDeliveryState(repoRoot, flags.card)
    process.stdout.write(`${JSON.stringify(command === 'summary' ? deliverySummary(state) : state, null, 2)}\n`)
    return
  }
  if (command === 'event') {
    const current = await readDeliveryState(repoRoot, flags.card)
    let payload
    try {
      assert(!(flags.payload && flags['payload-file']), 'ambiguous payload')
      payload = flags['payload-file']
        ? JSON.parse(await readFile(resolve(repoRoot, flags['payload-file']), 'utf8'))
        : flags.payload ? JSON.parse(flags.payload) : {}
    } catch { throw new Error('INVALID_DELIVERY_PAYLOAD') }
    if (flags.event === 'shipped' && config.commands.completionCheck) {
      current.policy.completionCheck = config.commands.completionCheck
      payload.completion = checkProjectCompletion(repoRoot, current, payload, config)
    }
    const next = transitionDeliveryState(current, flags.event, payload)
    await writeDeliveryState(repoRoot, next)
    process.stdout.write(`${JSON.stringify(next)}\n`)
    return
  }
  throw new Error('Usage: delivery-state.mjs <init|show|summary|event> --card PROJ-123 ...')
}

const isDirectRun = process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
