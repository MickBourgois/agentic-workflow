import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDeliveryState,
  routeFor,
  transitionDeliveryState,
} from '../workflow/orchestrator/delivery-state.mjs'

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

test('simple routes to Sol medium with one Sol medium reviewer', () => {
  assert.deepEqual(routeFor('simple'), {
    implementation: { model: 'gpt-6-sol', reasoning: 'medium' },
    reviewers: [{ model: 'gpt-6-sol', reasoning: 'medium' }],
  })
})

test('standard routes to Sol high with one Sol high reviewer', () => {
  assert.deepEqual(routeFor('standard'), {
    implementation: { model: 'gpt-6-sol', reasoning: 'high' },
    reviewers: [{ model: 'gpt-6-sol', reasoning: 'high' }],
  })
})

test('complex uses Sol high when score or risk dimension reaches the high-effort threshold', () => {
  assert.equal(routeFor('complex', { score: 14 }).implementation.reasoning, 'medium')
  assert.equal(routeFor('complex', { score: 15 }).implementation.reasoning, 'high')
  assert.equal(routeFor('complex', { score: 12, dimensions: { testDifficulty: 2 } }).implementation.reasoning, 'high')
})

test('critical requires two independent exact-head review slots', () => {
  let state = createDeliveryState({ card: 'PROJ-201', complexity: 'critical' })
  assert.deepEqual(state.route.implementation, { model: 'gpt-6-astra', reasoning: 'high' })
  assert.deepEqual(state.route.reviewers, [
    { model: 'gpt-6-astra', reasoning: 'high' },
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
  state = transitionDeliveryState(state, 'rework_complete', { commit: 'head1' })
  assert.deepEqual(state.reviewReceipts, [])
  state = transitionDeliveryState(state, 'review_findings', {
    receipts: [receipt('head1', 'findings')], findings: [{ id: 'RVW-002' }],
  })
  assert.equal(state.state, 'NEEDS_HUMAN')
  assert.equal(state.reason, 'rework_limit_reached')
})

test('a repeated blocker escalates once and then becomes human work', () => {
  let state = createDeliveryState({ card: 'PROJ-203', complexity: 'simple' })
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
  state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
  assert.deepEqual(state.route.implementation, { model: 'gpt-6-sol', reasoning: 'high' })
  state = transitionDeliveryState(state, 'phase_failure', { fingerprint: 'same-failure' })
  assert.equal(state.state, 'NEEDS_HUMAN')
})
