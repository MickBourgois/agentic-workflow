import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../workflow/orchestrator/config.mjs'
import { FIXED_ROUTES } from '../workflow/config/defaults.mjs'
import {
  createDeliveryState,
  deliveryCheckpoint,
  routeFor,
  transitionDeliveryState,
} from '../workflow/orchestrator/delivery-state.mjs'

test('project validation profiles require explicit opt-in and reject unknown modes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-validation-mode-'))
  const config = join(root, 'agent-workflow.config.json')
  const local = join(root, '.agent-workflow.local.json')
  try {
    assert.equal((await loadConfig(root)).delivery.validationMode, 'full')
    await writeFile(local, JSON.stringify({ delivery: { validationMode: 'project' } }))
    await assert.rejects(loadConfig(root), /explicitly enabled in project configuration/)
    await unlink(local)
    await writeFile(config, JSON.stringify({ delivery: { validationMode: 'project' } }))
    assert.equal((await loadConfig(root)).delivery.validationMode, 'project')
    await writeFile(config, JSON.stringify({ delivery: { validationMode: 'unexpected' } }))
    await assert.rejects(loadConfig(root), /Invalid delivery.validationMode/)
  } finally {
    await unlink(config)
    await rmdir(root)
  }
})

function implemented(state, commit = 'abc123') {
  return transitionDeliveryState(
    transitionDeliveryState(state, 'start_implementation'),
    'implementation_complete',
    { commit, validation: { full_check: 'passed' } },
  )
}

function receipt(head, status = 'approved', slot = 'single') {
  return { reviewed_head: head, status, reviewer_slot: slot }
}

test('simple routes to Luna low with one Luna high reviewer', () => {
  assert.deepEqual(routeFor('simple'), {
    implementation: { model: 'gpt-6-luna', reasoning: 'low' },
    reviewers: [{ model: 'gpt-6-luna', reasoning: 'high' }],
  })
})

test('standard routes to Luna high with one Sol 6.1 medium reviewer', () => {
  assert.deepEqual(routeFor('standard'), {
    implementation: { model: 'gpt-6-luna', reasoning: 'high' },
    reviewers: [{ model: 'gpt-6.1-sol', reasoning: 'medium' }],
  })
})

test('fixed roles keep Sol 6.1 for orchestration and shipping', () => {
  assert.deepEqual(FIXED_ROUTES, {
    orchestrator: { model: 'gpt-6.1-sol', reasoning: 'medium' },
    backlogSelector: { model: 'gpt-6-luna', reasoning: 'low' },
    shipper: { model: 'gpt-6.1-sol', reasoning: 'medium' },
  })
})

test('complex uses Sol high when score or risk dimension reaches the high-effort threshold', () => {
  assert.equal(routeFor('complex', { score: 14 }).implementation.reasoning, 'medium')
  assert.equal(routeFor('complex', { score: 15 }).implementation.reasoning, 'high')
  assert.equal(routeFor('complex', { score: 12, dimensions: { testDifficulty: 2 } }).implementation.reasoning, 'high')
})

test('critical requires two independent exact-head review slots', () => {
  let state = createDeliveryState({ card: 'PROJ-201', complexity: 'critical' })
  assert.deepEqual(state.route.implementation, { model: 'gpt-6.1-sol', reasoning: 'high' })
  assert.deepEqual(state.route.reviewers, [
    { model: 'gpt-6.1-sol', reasoning: 'high' },
    { model: 'gpt-6-sol', reasoning: 'high' },
  ])
  state = implemented(state, 'critical-head')
  assert.throws(() => transitionDeliveryState(state, 'review_approved', {
    receipts: [receipt('critical-head', 'approved', 'A')],
  }), /expected 2 review receipt/)
  state = transitionDeliveryState(state, 'review_approved', {
    receipts: [
      receipt('critical-head', 'approved', 'A'),
      receipt('critical-head', 'approved', 'B'),
    ],
  })
  assert.equal(state.state, 'APPROVED')
})

test('rework invalidates receipts and stops after the configured cycle limit', () => {
  let state = createDeliveryState({ card: 'PROJ-202', complexity: 'standard', maxReworkCycles: 1 })
  state = implemented(state, 'head0')
  state = transitionDeliveryState(state, 'review_findings', {
    receipts: [receipt('head0', 'findings')], findings: [{ id: 'RVW-001' }],
  })
  assert.throws(() => transitionDeliveryState(state, 'rework_complete', { commit: 'head1' }), /validation head/)
  assert.throws(() => transitionDeliveryState(state, 'rework_complete', { commit: 'head1', validation: { binding: 'stale', focused: 'passed' } }), /validation head/)
  assert.throws(() => transitionDeliveryState(state, 'rework_complete', { commit: 'head1', validation: { head: 'head1', focused: 'passed' } }), /recorded focused/)
  assert.throws(() => transitionDeliveryState(state, 'rework_complete', { commit: 'head1', validation: { head: 'head1', focused: 'passed', checks: [{ command: 'test', exitCode: 1 }] } }), /recorded focused/)
  const previousReceipts = state.reviewReceipts
  state = transitionDeliveryState(state, 'rework_complete', { commit: 'head1', validation: { head: 'head1', focused: 'passed', checks: [{ command: 'test', exitCode: 0 }] } })
  assert.deepEqual(state.previousReview.receipts, previousReceipts)
  assert.deepEqual(state.previousReview.findings, [{ id: 'RVW-001' }])
  assert.doesNotMatch(deliveryCheckpoint(state), /RVW-001/)
  assert.throws(() => transitionDeliveryState(state, 'review_approved', { receipts: previousReceipts }), /head/)
  assert.deepEqual(state.reviewReceipts, [])
  state = transitionDeliveryState(state, 'review_findings', {
    receipts: [receipt('head1', 'findings')], findings: [{ id: 'RVW-002' }],
  })
  assert.equal(state.state, 'NEEDS_HUMAN')
  assert.equal(state.reason, 'rework_limit_reached')
})

test('critical rework keeps slot receipts out of the shared checkpoint', () => {
  let state = implemented(createDeliveryState({ card: 'PROJ-205', complexity: 'critical' }), 'old')
  const receipts = [receipt('old', 'findings', 'A'), receipt('old', 'approved', 'B')]
  receipts[0].findings = [{ id: 'PRIVATE-A' }]
  receipts[1].findings = [{ id: 'PRIVATE-B' }]
  state = transitionDeliveryState(state, 'review_findings', { receipts, findings: [{ id: 'PRIVATE-A' }] })
  assert.doesNotMatch(deliveryCheckpoint(state), /PRIVATE-[AB]/)
  state = transitionDeliveryState(state, 'rework_complete', { commit: 'new', validation: { head: 'new', focused: 'passed', checks: [{ command: 'test', exitCode: 0 }] } })
  assert.deepEqual(state.previousReview.receipts, receipts)
  assert.doesNotMatch(deliveryCheckpoint(state), /PRIVATE-[AB]/)
  assert.throws(() => transitionDeliveryState(state, 'review_approved', { receipts }), /head/)
})

test('a repeated blocker escalates once and then becomes human work', () => {
  let state = createDeliveryState({ card: 'PROJ-203', complexity: 'simple' })
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
  state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
  assert.deepEqual(state.route.implementation, { model: 'gpt-6.1-sol', reasoning: 'high' })
  state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
  assert.equal(state.state, 'NEEDS_HUMAN')
})

test('standard Luna and complex Sol medium escalate to Sol 6.1 high', () => {
  for (const complexity of ['standard', 'complex']) {
    let state = createDeliveryState({ card: 'PROJ-204', complexity })
    state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
    state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
    assert.deepEqual(state.route.implementation, { model: 'gpt-6.1-sol', reasoning: 'high' })
  }
})
