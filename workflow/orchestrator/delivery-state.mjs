#!/usr/bin/env node

import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { ROUTES, WORKFLOW_DEFAULTS } from '../config/defaults.mjs'
import { assertCard, loadConfig } from './config.mjs'
import { verifyEvidence } from './delivery-evidence.mjs'

export const DELIVERY_STATE_VERSION = 2
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
  validationMode = WORKFLOW_DEFAULTS.delivery.validationMode,
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
    policy: { maxReworkCycles, maxEscalations, completionCheck, validationMode },
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

function validateBlockingFindings(findings) {
  assert(Array.isArray(findings) && findings.length > 0, 'blocking findings required')
  for (const finding of findings) {
    assert(['P0', 'P1', 'P2'].includes(finding.priority), 'blocking finding priority must be P0-P2; P3 belongs in suggestions')
    assert(['id', 'file', 'requirement', 'evidence', 'required_change'].every((key) =>
      typeof finding[key] === 'string' && finding[key].trim()), 'blocking finding requires a requirement, evidence and bounded correction')
    assert(Number.isInteger(finding.line) && finding.line > 0, 'blocking finding requires a positive line')
  }
}

function validateReviewReceipts(state, receipts, legacy = false) {
  assert(Array.isArray(receipts), 'review receipts must be an array')
  assert(receipts.length === state.route.reviewers.length,
    `expected ${state.route.reviewers.length} review receipt(s), got ${receipts.length}`)
  for (const receipt of receipts) {
    assert(receipt.reviewed_head === state.currentHead, 'review receipt head does not match current head')
    assert(['approved', 'findings'].includes(receipt.status), 'invalid review receipt status')
    assert(legacy || receipt.scope === 'code_and_focused_checks', 'review scope must be code_and_focused_checks')
    if (!legacy) {
      if (receipt.status === 'findings') validateBlockingFindings(receipt.findings)
      else assert(receipt.findings === undefined || (Array.isArray(receipt.findings) && receipt.findings.length === 0),
        'approved review cannot contain blocking findings')
      assert(receipt.suggestions === undefined || (Array.isArray(receipt.suggestions) && receipt.suggestions.every((suggestion) =>
        ['P2', 'P3'].includes(suggestion.priority) && typeof suggestion.suggestion === 'string' && suggestion.suggestion.trim())),
      'suggestions must be nonblocking P2-P3 advice')
    }
  }
  const actual = receipts.map((receipt) => receipt.reviewer_slot).sort()
  const expected = requiredReviewSlots(state).sort()
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `expected review slot(s) ${expected.join(', ')}, got ${actual.join(', ')}`)
}

function validateFocused(validation, head) {
  assert(validation?.head === head, 'focused validation head does not match commit')
  assert(validation.focused === 'passed', 'review requires passing focused validation')
  validateChecks(validation.checks)
}

function validateChecks(checks) {
  assert(Array.isArray(checks) && checks.length > 0 && checks.every((check) =>
    typeof check.command === 'string' && check.command.trim() && check.exitCode === 0),
  'successful recorded focused or gate checks required')
}

function validateGate(state, validation) {
  assert(validation?.kind === 'required_gate' && validation.result === 'passed'
    && validation.head === state.currentHead && validation.base === state.baseSha,
  'passing required gate for exact base/head required')
  assert(typeof validation.profile === 'string' && validation.profile.trim()
    && typeof validation.reason === 'string' && validation.reason.trim(), 'gate profile and reason required')
  assert(state.policy?.validationMode === 'project' || validation.profile === 'full', 'full gate required')
  validateChecks(validation.checks)
  assert(typeof validation.receipt === 'string' && validation.receipt.trim(), 'auditable gate receipt required')
}

function nextActionForState(state) {
  return {
    READY: 'dispatch_implementation',
    IMPLEMENTING: 'wait_for_implementation',
    REVIEWING: 'dispatch_independent_review',
    REWORKING: 'dispatch_rework',
    VALIDATING: 'run_required_gate',
    APPROVED: 'dispatch_shipping',
    SHIPPING: 'wait_for_shipping',
  }[state] ?? 'stop'
}

export function transitionDeliveryState(current, event, payload = {}) {
  assert([1, DELIVERY_STATE_VERSION].includes(current.version), 'unsupported delivery state version; needs human reconciliation')
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
      validateFocused(payload.validation, payload.commit)
      state.version = DELIVERY_STATE_VERSION
      state.currentHead = payload.commit
      state.validation = payload.validation ?? null
      delete state.focusedValidation
      state.state = 'REVIEWING'
      break
    case 'reviews_approved':
      requireState(state, 'REVIEWING', event)
      validateReviewReceipts(state, payload.receipts)
      validateFocused(state.validation, state.currentHead)
      assert(payload.receipts.every((receipt) => receipt.status === 'approved'), 'all reviews must approve')
      state.reviewReceipts = payload.receipts
      state.focusedValidation = state.validation
      state.version = DELIVERY_STATE_VERSION
      state.state = 'VALIDATING'
      break
    case 'review_approved':
      requireState(state, 'VALIDATING', event)
      validateReviewReceipts(state, state.reviewReceipts)
      assert(state.reviewReceipts.every((receipt) => receipt.status === 'approved'), 'all reviews must approve')
      validateGate(state, payload.validation)
      state.validation = payload.validation
      state.state = 'APPROVED'
      break
    case 'review_findings': {
      requireState(state, 'REVIEWING', event)
      validateReviewReceipts(state, payload.receipts)
      validateFocused(state.validation, state.currentHead)
      assert(payload.receipts.some((receipt) => receipt.status === 'findings'), 'findings receipt required')
      validateBlockingFindings(payload.findings)
      const findingKey = (finding) => JSON.stringify([finding.file, finding.line, finding.requirement])
      const expectedFindings = new Set(payload.receipts.flatMap((receipt) => receipt.findings ?? []).map(findingKey))
      const actualFindings = new Set(payload.findings.map(findingKey))
      assert(actualFindings.size === payload.findings.length && actualFindings.size === expectedFindings.size
        && [...actualFindings].every((key) => expectedFindings.has(key)), 'confirmed findings must cover all reviewed blockers exactly once')
      state.reviewReceipts = payload.receipts
      state.findings = payload.findings
      if (state.reworkCycles >= maxReworkCycles) {
        state.state = 'NEEDS_HUMAN'
        state.reason = 'rework_limit_reached'
      } else {
        state.state = 'REWORKING'
      }
      break
    }
    case 'rework_complete':
      requireState(state, 'REWORKING', event)
      assert(payload.commit, 'rework_complete requires commit')
      assert(payload.commit !== state.currentHead, 'rework must produce a new commit')
      validateFocused(payload.validation, payload.commit)
      state.version = DELIVERY_STATE_VERSION
      state.previousReview = { base: state.baseSha, head: state.currentHead, receipts: state.reviewReceipts, findings: state.findings }
      state.previousHead = state.currentHead
      state.currentHead = payload.commit
      state.validation = payload.validation ?? null
      delete state.focusedValidation
      state.reworkCycles += 1
      state.reviewReceipts = []
      state.findings = []
      state.state = 'REVIEWING'
      break
    case 'validation_refreshed':
      assert(['APPROVED', 'SHIPPING'].includes(state.state), 'validation_refreshed requires APPROVED or SHIPPING')
      validateReviewReceipts(state, state.reviewReceipts, state.version === 1)
      assert(state.reviewReceipts.every((receipt) => receipt.status === 'approved'), 'all reviews must approve')
      validateGate(state, payload.validation)
      state.validation = payload.validation
      break
    case 'start_shipping':
      requireState(state, 'APPROVED', event)
      validateReviewReceipts(state, state.reviewReceipts, state.version === 1)
      assert(state.reviewReceipts.every((receipt) => receipt.status === 'approved'), 'all reviews must approve')
      validateGate(state, payload.validation ?? state.validation)
      state.validation = payload.validation ?? state.validation
      state.state = 'SHIPPING'
      break
    case 'shipped':
      requireState(state, 'SHIPPING', event)
      validateReviewReceipts(state, state.reviewReceipts, state.version === 1)
      assert(state.reviewReceipts.every((receipt) => receipt.status === 'approved'), 'all reviews must approve')
      validateGate(state, state.validation)
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

export async function writeDeliveryState(repoRoot, state, { exclusive = false } = {}) {
  const target = statePath(repoRoot, state.card)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  const content = `${JSON.stringify(state, null, 2)}\n`
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
  try {
    if (exclusive) await link(temporary, target)
    else await rename(temporary, target)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  const checkpoint = resolve(repoRoot, '.delivery', 'checkpoints', `${state.card}.md`)
  await mkdir(dirname(checkpoint), { recursive: true })
  await writeFile(`${checkpoint}.tmp`, deliveryCheckpoint(state), { mode: 0o600 })
  await rename(`${checkpoint}.tmp`, checkpoint)
  return target
}

export function deliverySummary(state) {
  const summary = {}
  for (const key of ['card', 'state', 'branch', 'worktree', 'baseSha', 'currentHead', 'reworkCycles', 'lastAction', 'pr', 'mergeCommit', 'updatedAt', 'evidenceArchive']) {
    if (state[key] !== undefined) summary[key] = state[key]
  }
  const fields = {
    ci: ['runId', 'head', 'status', 'conclusion', 'url'],
    runtime: ['restoreRequired', 'vmState', 'actualMemoryGiB', 'restorationProof', 'foregroundSession'],
    cleanup: ['worktreeRemoved', 'metadataPruned', 'archive', 'manifestSha256'],
    tracker: ['status', 'checkpointId', 'completedAt'],
    validation: ['kind', 'receipt', 'binding', 'base', 'head', 'result', 'profile'],
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
  const checkpoint = { version: state.version, ...deliverySummary(state), reviewReceipts: ['REWORKING', 'REVIEWING', 'VALIDATING'].includes(state.state) ? [] : state.reviewReceipts,
    validation: state.validation, focusedValidation: state.focusedValidation, escalationCount: state.escalationCount }
  return '<!-- delivery-checkpoint:v1 -->\n\n```json\n' + JSON.stringify(checkpoint, null, 2) + '\n```\n'
}

function checkDeliveryWorktree(state) {
  assert(typeof state.worktree === 'string', 'missing delivery worktree')
  const cwd = realpathSync(state.worktree)
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()
  assert(git(['rev-parse', '--verify', 'HEAD']) === state.currentHead, 'unexpected worktree head')
  assert(git(['status', '--porcelain=v1', '--untracked-files=normal']) === '', 'dirty validation worktree')
  assert(git(['ls-files', '-v', '-z']).split('\0').filter(Boolean).every((entry) => entry.startsWith('H ')), 'hidden index flags refused')
  git(['merge-base', '--is-ancestor', state.baseSha, state.currentHead])
  return { cwd, git }
}

function checkPreparedWorktree(repoRoot, state) {
  assert(state.baseSha && state.branch && state.worktree, 'base, branch and prepared worktree required')
  const { cwd, git } = checkDeliveryWorktree({ ...state, currentHead: state.baseSha })
  assert(realpathSync(git(['rev-parse', '--show-toplevel'])) === cwd, 'worktree must be a repository root')
  assert(git(['symbolic-ref', '--short', 'HEAD']) === state.branch, 'unexpected worktree branch')
  const common = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir']))
  const owner = realpathSync(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim())
  assert(common === owner, 'worktree belongs to a different repository')
  assert(realpathSync(git(['rev-parse', '--absolute-git-dir'])) !== common, 'linked delivery worktree required')
}

function checkRecordedEvidence(state, validation, kind, archive) {
  if (!state.policy.evidenceRequired) return
  validateChecks(validation?.checks)
  for (const check of validation.checks) {
    assert(typeof check.receipt === 'string' && check.receipt, 'raw evidence receipt required for every check')
    const original = resolve(state.worktree, check.receipt)
    const receipt = archive ? resolve(archive, basename(dirname(original)), 'receipt.json') : original
    const proof = verifyEvidence({ receipt, card: state.card, base: state.baseSha, head: state.currentHead, kind })
    assert(proof.command === check.command && proof.exitCode === check.exitCode, 'evidence command/result mismatch')
    const hash = createHash('sha256').update(readFileSync(receipt)).digest('hex')
    assert(!check.receiptSha256 || check.receiptSha256 === hash, 'evidence receipt changed')
    if (archive) assert(check.receiptSha256, 'original evidence hash required before archival')
    else check.receiptSha256 = hash
  }
  for (const artifact of validation.artifacts ?? []) {
    assert(typeof artifact.receipt === 'string', 'artifact receipt required')
    const original = resolve(state.worktree, artifact.receipt)
    const receipt = archive ? resolve(archive, basename(dirname(original)), 'receipt.json') : original
    const proof = JSON.parse(readFileSync(receipt, 'utf8'))
    assert(!['focused', 'gate'].includes(proof.kind), 'supplementary artifacts cannot replace command checks')
    verifyEvidence({ receipt, card: state.card, base: state.baseSha, head: proof.head, kind: proof.kind })
    const hash = createHash('sha256').update(readFileSync(receipt)).digest('hex')
    assert(!artifact.receiptSha256 || artifact.receiptSha256 === hash, 'artifact receipt changed')
    if (archive) assert(artifact.receiptSha256, 'original artifact hash required before archival')
    else artifact.receiptSha256 = hash
  }
}

export function checkProjectValidation(state, config, requestedBinding = state.validation?.binding) {
  try {
    assert(typeof config.commands.validationProof === 'string', 'missing validation verifier')
    const { cwd, git } = checkDeliveryWorktree(state)
    const script = realpathSync(resolve(cwd, config.commands.validationProof)), scriptPath = relative(cwd, script)
    assert(scriptPath && !scriptPath.startsWith('..') && !isAbsolute(scriptPath), 'invalid validation verifier path')
    git(['ls-files', '--error-unmatch', '--', scriptPath])
    const args = [script, 'verify', '--card', state.card, '--base', state.baseSha, '--head', state.currentHead]
    if (requestedBinding) args.push('--binding', requestedBinding)
    const output = execFileSync(process.execPath, args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
    })
    const verdict = JSON.parse(output)
    assert(verdict.result === 'passed' && verdict.card === state.card && verdict.head === state.currentHead, 'invalid validation verdict')
    const localPath = (path) => {
      assert(typeof path === 'string' && path.length > 0, 'missing evidence path')
      const file = realpathSync(resolve(cwd, path)), part = relative(cwd, file)
      assert(part && !part.startsWith('..') && !isAbsolute(part), 'invalid evidence path')
      return file
    }
    const raw = readFileSync(localPath(verdict.binding)), binding = JSON.parse(raw)
    const digest = (value) => createHash('sha256').update(value).digest('hex')
    assert(binding.result === 'passed' && binding.card === state.card && binding.base === state.baseSha && binding.head === state.currentHead, 'invalid binding')
    const receipt = readFileSync(localPath(binding.receipt))
    assert(digest(receipt) === binding.receiptSha256, 'invalid receipt hash')
    return { result: 'passed', head: state.currentHead, base: state.baseSha, binding: verdict.binding,
      bindingSha256: digest(raw), receipt: binding.receipt, receiptSha256: binding.receiptSha256 }
  } catch {
    throw new Error('PROJECT_VALIDATION_CHECK_FAILED')
  }
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
    assertCard(flags.card, config.tracker.cardPattern)
    assert(!existsSync(statePath(repoRoot, flags.card))
      && !existsSync(resolve(repoRoot, '.delivery/checkpoints', `${flags.card.toUpperCase()}.md`)), 'existing state/checkpoint must be reconciled, never reinitialized')
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
      validationMode: config.delivery.validationMode,
    })
    checkPreparedWorktree(repoRoot, state)
    state.worktree = realpathSync(state.worktree)
    state.policy.evidenceRequired = true
    await writeDeliveryState(repoRoot, state, { exclusive: true })
    process.stdout.write(`${JSON.stringify(state)}\n`)
    return
  }
  if (command === 'show' || command === 'summary') {
    const state = await readDeliveryState(repoRoot, flags.card)
    process.stdout.write(`${JSON.stringify(command === 'summary' ? deliverySummary(state) : state, null, 2)}\n`)
    return
  }
  if (command === 'review-ready') {
    const state = await readDeliveryState(repoRoot, flags.card)
    assert([1, DELIVERY_STATE_VERSION].includes(state.version), 'unsupported delivery state version; needs human reconciliation')
    requireState(state, 'REVIEWING', command)
    validateFocused(state.validation, state.currentHead)
    checkDeliveryWorktree(state)
    checkRecordedEvidence(state, state.validation, 'focused')
    process.stdout.write(`${JSON.stringify({ card: state.card, head: state.currentHead, scope: 'code_and_focused_checks' })}\n`)
    return
  }
  if (command === 'event') {
    const current = await readDeliveryState(repoRoot, flags.card)
    if (flags.event === 'start_implementation') checkPreparedWorktree(repoRoot, current)
    let payload
    try {
      assert(!(flags.payload && flags['payload-file']), 'ambiguous payload')
      payload = flags['payload-file']
        ? JSON.parse(await readFile(resolve(repoRoot, flags['payload-file']), 'utf8'))
        : flags.payload ? JSON.parse(flags.payload) : {}
    } catch { throw new Error('INVALID_DELIVERY_PAYLOAD') }
    if (['implementation_complete', 'rework_complete'].includes(flags.event)) {
      current.worktree = realpathSync(current.worktree)
      const pending = { ...current, currentHead: payload.commit }
      checkDeliveryWorktree(pending)
      checkRecordedEvidence(pending, payload.validation, 'focused')
    }
    if (['review_findings', 'reviews_approved', 'review_approved', 'start_shipping', 'validation_refreshed'].includes(flags.event)) {
      checkDeliveryWorktree(current)
      current.worktree = realpathSync(current.worktree)
    }
    if (['review_findings', 'reviews_approved'].includes(flags.event)) checkRecordedEvidence(current, current.validation, 'focused')
    if (['review_approved', 'start_shipping', 'validation_refreshed'].includes(flags.event)) {
      if (flags.event === 'review_approved') requireState(current, 'VALIDATING', flags.event)
      current.policy.validationMode = config.delivery.validationMode
      checkRecordedEvidence(current, payload.validation ?? current.validation, 'gate')
      if (config.commands.validationProof) {
        const verified = checkProjectValidation(current, config, payload.validation?.binding ?? current.validation?.binding)
        if (flags.event === 'start_shipping') {
          assert(current.validation?.bindingSha256 === verified.bindingSha256
            && current.validation?.receiptSha256 === verified.receiptSha256, 'validation evidence changed; refresh required')
        }
        payload.validation = { ...(payload.validation ?? current.validation), ...verified }
      }
    }
    if (flags.event === 'shipped' && config.commands.completionCheck) {
      current.policy.completionCheck = config.commands.completionCheck
      payload.completion = checkProjectCompletion(repoRoot, current, payload, config)
    }
    if (flags.event === 'shipped' && current.policy.evidenceRequired) {
      assert(typeof payload.evidenceArchive === 'string' && payload.evidenceArchive, 'durable evidence archive required before DONE')
      payload.evidenceArchive = realpathSync(resolve(repoRoot, payload.evidenceArchive))
      const archiveLocation = relative(resolve(current.worktree), payload.evidenceArchive)
      assert(archiveLocation === '..' || archiveLocation.startsWith(`..${sep}`) || isAbsolute(archiveLocation), 'evidence archive must survive worktree removal')
      checkRecordedEvidence(current, current.focusedValidation, 'focused', payload.evidenceArchive)
      checkRecordedEvidence(current, current.validation, 'gate', payload.evidenceArchive)
    }
    const next = transitionDeliveryState(current, flags.event, payload)
    if (payload.evidenceArchive) next.evidenceArchive = payload.evidenceArchive
    await writeDeliveryState(repoRoot, next)
    process.stdout.write(`${JSON.stringify(next)}\n`)
    return
  }
  throw new Error('Usage: delivery-state.mjs <init|show|summary|review-ready|event> --card PROJ-123 ...')
}

const isDirectRun = process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
