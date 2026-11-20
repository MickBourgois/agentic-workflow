import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeliveryState, transitionDeliveryState, writeDeliveryState, deliveryCheckpoint } from '../workflow/orchestrator/delivery-state.mjs'

const focused = (head) => ({ head, focused: 'passed', checks: [{ command: 'node --check app.mjs', exitCode: 0 }] })
const receipt = (head, slot = 'single', status = 'approved') => ({ reviewed_head: head, reviewer_slot: slot, status, scope: 'code_and_focused_checks' })
const gate = (head = 'head', base = 'base') => ({ kind: 'required_gate', result: 'passed', head, base, profile: 'full', reason: 'default full policy', checks: [{ command: 'node verify.mjs run', exitCode: 0 }], receipt: '.delivery/receipt.json' })
const finding = (priority = 'P2') => ({ id: 'FIX', priority, file: 'app.mjs', line: 1,
  requirement: 'Reject invalid input', evidence: 'An empty input is accepted', required_change: 'Reject empty input and add a regression test' })

function reviewing(complexity = 'standard') {
  let state = createDeliveryState({ card: 'PROJ-701', complexity, baseSha: 'base' })
  state = transitionDeliveryState(state, 'start_implementation')
  return transitionDeliveryState(state, 'implementation_complete', { commit: 'head', validation: focused('head') })
}

test('initial review needs recorded successful focused checks, never a full gate', () => {
  const state = transitionDeliveryState(createDeliveryState({ card: 'PROJ-701', complexity: 'standard' }), 'start_implementation')
  for (const validation of [undefined, { full_check: 'passed' }, { ...focused('other') },
    { ...focused('head'), focused: 'failed' }, { ...focused('head'), checks: [] },
    { ...focused('head'), checks: [{ command: 'test', exitCode: 1 }] }]) {
    assert.throws(() => transitionDeliveryState(state, 'implementation_complete', { commit: 'head', validation }))
  }
  const next = reviewing()
  assert.equal(next.state, 'REVIEWING')
  assert.equal(next.validation.binding, undefined)
  assert.throws(() => transitionDeliveryState(next, 'reviews_approved', { receipts: [{ ...receipt('head'), scope: undefined }] }), /review scope/)
  const legacy = { ...next, version: 1, validation: { full_check: 'passed' } }
  assert.throws(() => transitionDeliveryState(legacy, 'reviews_approved', { receipts: [receipt('head')] }), /focused validation/)
})

test('findings and rework return to independent review without a gate; approvals precede validation', () => {
  let state = reviewing('critical')
  state = transitionDeliveryState(state, 'review_findings', {
    receipts: [{ ...receipt('head', 'A', 'findings'), findings: [finding()] }, receipt('head', 'B')], findings: [finding()],
  })
  state = transitionDeliveryState(state, 'rework_complete', { commit: 'corrected', validation: focused('corrected') })
  assert.equal(state.state, 'REVIEWING')
  assert.equal(state.validation.kind, undefined)
  assert.deepEqual(state.reviewReceipts, [])
  assert.throws(() => transitionDeliveryState(state, 'reviews_approved', { receipts: [receipt('head', 'A'), receipt('head', 'B')] }), /head/)
  assert.throws(() => transitionDeliveryState(state, 'review_approved', { validation: gate('corrected') }), /requires VALIDATING/)
  assert.throws(() => transitionDeliveryState(state, 'reviews_approved', { receipts: [receipt('corrected', 'A')] }), /expected 2/)
  state = transitionDeliveryState(state, 'reviews_approved', { receipts: [receipt('corrected', 'A'), receipt('corrected', 'B')] })
  assert.equal(state.state, 'VALIDATING')
  assert.equal(state.lastAction, 'run_required_gate')
  assert.doesNotMatch(deliveryCheckpoint(state), /code_and_focused_checks/)
  assert.throws(() => transitionDeliveryState(state, 'start_shipping'), /requires APPROVED/)
  const approved = transitionDeliveryState(state, 'review_approved', { validation: gate('corrected') })
  assert.equal(approved.state, 'APPROVED')
  assert.deepEqual(approved.focusedValidation, focused('corrected'))
})

test('optional suggestions allow approval without consuming a rework cycle', () => {
  const suggestions = [{ priority: 'P3', file: 'app.mjs', line: 1, suggestion: 'Consider a clearer local name' }]
  const receipts = [{ ...receipt('head'), findings: [], suggestions }]
  const state = transitionDeliveryState(reviewing(), 'reviews_approved', { receipts })
  assert.equal(state.state, 'VALIDATING')
  assert.equal(state.reworkCycles, 0)
  assert.deepEqual(state.reviewReceipts[0].suggestions, suggestions)
  assert.equal(transitionDeliveryState(state, 'review_approved', { validation: gate() }).state, 'APPROVED')
  assert.throws(() => transitionDeliveryState(reviewing(), 'review_findings', { receipts, findings: suggestions }))
})

test('reviews cannot approve blockers or use P3, incomplete or unconfirmed findings to force rework', () => {
  assert.throws(() => transitionDeliveryState(reviewing(), 'reviews_approved', {
    receipts: [{ ...receipt('head'), findings: [finding()] }],
  }), /approved review cannot contain blocking findings/)
  for (const invalid of [finding('P3'), finding('unknown'), { ...finding(), evidence: '' },
    { ...finding(), requirement: '' }, { ...finding(), required_change: '' }, { ...finding(), line: 0 }]) {
    assert.throws(() => transitionDeliveryState(reviewing(), 'review_findings', {
      receipts: [{ ...receipt('head', 'single', 'findings'), findings: [invalid] }], findings: [invalid],
    }))
  }
  assert.throws(() => transitionDeliveryState(reviewing(), 'review_findings', {
    receipts: [receipt('head', 'single', 'findings')], findings: [finding()],
  }), /blocking findings required/)
  assert.throws(() => transitionDeliveryState(reviewing(), 'reviews_approved', {
    receipts: [{ ...receipt('head'), suggestions: [{ priority: 'P1', suggestion: 'Fix the security defect' }] }],
  }), /suggestions must be nonblocking/)
})

test('P0-P2 defects block; critical rework includes every independent blocker and deduplicates overlaps', () => {
  for (const priority of ['P0', 'P1', 'P2']) {
    const defect = finding(priority)
    const receipts = [{ ...receipt('head', 'single', 'findings'), findings: [defect] }]
    assert.equal(transitionDeliveryState(reviewing(), 'review_findings', { receipts, findings: [defect] }).state, 'REWORKING')
  }
  const first = finding(), second = { ...finding('P1'), id: 'SECOND', file: 'other.mjs' }
  const receipts = [
    { ...receipt('head', 'A', 'findings'), findings: [first] },
    { ...receipt('head', 'B', 'findings'), findings: [first, second] },
  ]
  for (const findings of [[first], [first, first], [first, { ...second, file: 'unreviewed.mjs' }]]) {
    assert.throws(() => transitionDeliveryState(reviewing('critical'), 'review_findings', { receipts, findings }), /cover all reviewed blockers/)
  }
  assert.equal(transitionDeliveryState(reviewing('critical'), 'review_findings', { receipts, findings: [first, second] }).state, 'REWORKING')
})

test('missing, failed, partial and wrong-pair gates block delivery approval and shipping', () => {
  const state = transitionDeliveryState(reviewing(), 'reviews_approved', { receipts: [receipt('head')] })
  for (const validation of [undefined, focused('head'), { ...gate(), head: 'old' }, { ...gate(), base: 'old' },
    { ...gate(), result: 'failed' }, { ...gate(), profile: 'affected' }, { ...gate(), receipt: '' },
    { ...gate(), checks: [{ command: 'gate', exitCode: 1 }] }]) {
    assert.throws(() => transitionDeliveryState(state, 'review_approved', { validation }))
    const approved = { ...state, state: 'APPROVED', validation }
    assert.throws(() => transitionDeliveryState(approved, 'start_shipping'))
  }
  state.policy.validationMode = 'project'
  assert.equal(transitionDeliveryState(state, 'review_approved', { validation: { ...gate(), profile: 'affected', reason: 'tested project policy' } }).state, 'APPROVED')
})

test('new delivery budget caps older config values and keeps historical limits on resume', () => {
  const makeState = (maxReworkCycles) => createDeliveryState({ card: 'PROJ-701', complexity: 'standard', maxReworkCycles })
  assert.equal(makeState().policy.maxReworkCycles, 1)
  assert.equal(makeState(2).policy.maxReworkCycles, 1)
  assert.equal(makeState(0).policy.maxReworkCycles, 0)
  const secondRound = { ...reviewing(), reworkCycles: 1 }
  const defect = finding()
  const payload = { receipts: [{ ...receipt('head', 'single', 'findings'), findings: [defect] }], findings: [defect] }
  assert.equal(transitionDeliveryState(secondRound, 'review_findings', payload).state, 'NEEDS_HUMAN')
  secondRound.policy.maxReworkCycles = 2
  assert.equal(transitionDeliveryState(secondRound, 'review_findings', payload).state, 'REWORKING')
})

const reworkAuthorization = { reference: 'human-decision-701', reason: 'Authorize one more confirmed correction', additionalCycles: 1 }
const reviewFindings = () => ({ receipts: [receipt('head', 'A'),
  { ...receipt('head', 'B', 'findings'), findings: [finding()] }], findings: [finding()] })

test('explicit human authorization adds exactly one cycle, preserving the automatic limit and durable state', () => {
  const state = { ...reviewing('critical'), reworkCycles: 1, escalationCount: 1,
    failureFingerprints: { prior_failure: 2 }, previousReview: { head: 'prior', receipts: [] } }
  const original = structuredClone(state), payload = { ...reviewFindings(), reworkAuthorization }
  const next = transitionDeliveryState(state, 'review_findings', payload)
  assert.equal(next.state, 'REWORKING')
  for (const field of ['policy', 'route', 'reworkCycles', 'escalationCount', 'failureFingerprints', 'previousReview', 'baseSha', 'currentHead']) {
    assert.deepEqual(next[field], original[field], field)
  }
  assert.deepEqual(state, original, 'transition does not mutate the input')
  assert.deepEqual(next.reviewReceipts, payload.receipts)
  assert.deepEqual(next.findings, payload.findings)
  assert.deepEqual(next.history.slice(0, -1), state.history)
  const authorization = next.reworkAuthorizations[0]
  assert.deepEqual(authorization, { ...reworkAuthorization, previousLimit: 1, newLimit: 2,
    reworkCycles: 1, base: 'base', head: 'head', event: 'review_findings', at: authorization.at })
  assert.ok(Number.isFinite(Date.parse(authorization.at)))
  assert.match(deliveryCheckpoint(next), /lastReworkAuthorization/)
  assert.doesNotMatch(deliveryCheckpoint(next), /code_and_focused_checks/)

  const corrected = transitionDeliveryState(next, 'rework_complete', { commit: 'corrected', validation: focused('corrected') })
  assert.equal(corrected.reworkCycles, 2)
  assert.deepEqual(corrected.reworkAuthorizations, next.reworkAuthorizations)
  assert.deepEqual(corrected.previousReview.receipts, payload.receipts)
  assert.throws(() => transitionDeliveryState(corrected, 'reviews_approved', { receipts: [receipt('corrected', 'A')] }))
  const pending = transitionDeliveryState(corrected, 'reviews_approved', {
    receipts: [receipt('corrected', 'A'), receipt('corrected', 'B')],
  })
  assert.throws(() => transitionDeliveryState(pending, 'start_shipping'))
  pending.policy.validationMode = 'project'
  assert.throws(() => transitionDeliveryState(pending, 'review_approved', {
    validation: { ...gate('corrected'), profile: 'affected' },
  }), /new full gate/)
  assert.equal(transitionDeliveryState(pending, 'review_approved', { validation: gate('corrected') }).state, 'APPROVED')
  const remaining = { receipts: reviewFindings().receipts.map(value => ({ ...value, reviewed_head: 'corrected' })), findings: [finding()] }
  assert.equal(transitionDeliveryState(corrected, 'review_findings', remaining).state, 'NEEDS_HUMAN')
  const extended = transitionDeliveryState(corrected, 'review_findings', { ...remaining, reworkAuthorization })
  assert.equal(extended.reworkCycles, 2)
  assert.equal(extended.policy.maxReworkCycles, 1)
  assert.deepEqual(extended.reworkAuthorizations[0], next.reworkAuthorizations[0])
  assert.equal(extended.reworkAuthorizations[1].previousLimit, 2)
  assert.equal(extended.reworkAuthorizations[1].newLimit, 3)
})

test('additional cycle authorization rejects early, exceeded, malformed and invalid exact-pair findings', () => {
  const state = { ...reviewing('critical'), reworkCycles: 1 }, payload = { ...reviewFindings(), reworkAuthorization }
  for (const authorization of [null, [], {}, { ...reworkAuthorization, reference: '' },
    { ...reworkAuthorization, reason: ' ' }, { ...reworkAuthorization, additionalCycles: 2 },
    { ...reworkAuthorization, additionalCycles: '1' }, { ...reworkAuthorization, additionalCycles: 0 }]) {
    assert.throws(() => transitionDeliveryState(state, 'review_findings', { ...payload, reworkAuthorization: authorization }), /reworkAuthorization/)
  }
  for (const reworkCycles of [0, 2]) {
    assert.throws(() => transitionDeliveryState({ ...state, reworkCycles }, 'review_findings', payload), /current rework limit/)
  }
  for (const changes of [{ receipts: [payload.receipts[0]] },
    { receipts: [payload.receipts[0], { ...payload.receipts[1], reviewer_slot: 'A' }] },
    { receipts: [payload.receipts[0], { ...payload.receipts[1], reviewed_head: 'old' }] },
    { receipts: [payload.receipts[0], { ...payload.receipts[1], reviewed_base: 'old' }] },
    { receipts: [payload.receipts[0], { ...payload.receipts[1], card: 'PROJ-999' }] },
    { receipts: [payload.receipts[0], { ...payload.receipts[1], findings: [] }] },
    { findings: [] }, { findings: [{ ...finding(), file: 'unreviewed.mjs' }] }]) {
    assert.throws(() => transitionDeliveryState(state, 'review_findings', { ...payload, ...changes }))
    assert.equal(state.reworkAuthorizations, undefined)
  }
  const stopped = transitionDeliveryState(state, 'review_findings', reviewFindings())
  assert.equal(stopped.state, 'NEEDS_HUMAN')
  assert.throws(() => transitionDeliveryState(stopped, 'review_findings', payload), /terminal state/)
})

test('human-authorized rework also prevents reviewed-focused gate reuse on standard deliveries', () => {
  const state = { ...reviewing(), reworkCycles: 1 }
  state.policy.evidenceRequired = true
  state.policy.reuseFocusedChecks = true
  const receipts = [{ ...receipt('head', 'single', 'findings'), findings: [finding()] }]
  const rework = transitionDeliveryState(state, 'review_findings', { receipts, findings: [finding()], reworkAuthorization })
  const corrected = transitionDeliveryState(rework, 'rework_complete', { commit: 'corrected', validation: focused('corrected') })
  const pending = transitionDeliveryState(corrected, 'reviews_approved', { receipts: [receipt('corrected')] })
  assert.throws(() => transitionDeliveryState(pending, 'review_approved', { useReviewedFocused: true }), /new full gate/)
})

test('focused gate reuse rejects historical, complex and critical deliveries', () => {
  for (const complexity of ['simple', 'complex', 'critical']) {
    const state = reviewing(complexity)
    state.policy.evidenceRequired = true
    if (complexity !== 'simple') state.policy.reuseFocusedChecks = true
    const receipts = complexity === 'critical' ? [receipt('head', 'A'), receipt('head', 'B')] : [receipt('head')]
    const pending = transitionDeliveryState(state, 'reviews_approved', { receipts })
    assert.throws(() => transitionDeliveryState(pending, 'review_approved', { useReviewedFocused: true }), /not permitted/)
  }
})

// A real tracked project hook: running the gate is separate from verifying it.
const verifier = `import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = process.argv;
const card = args[args.indexOf('--card') + 1], head = args[args.indexOf('--head') + 1], base = args[args.indexOf('--base') + 1];
if (args[2] === 'run') {
  let count = 0; try { count = Number(readFileSync('.delivery/count', 'utf8')) } catch {}
  writeFileSync('.delivery/count', String(count + 1));
  const receipt = JSON.stringify({ result: 'passed', expired: false });
  writeFileSync('.delivery/receipt.json', receipt);
  writeFileSync('.delivery/binding.json', JSON.stringify({ card, head, base, result: 'passed', receipt: '.delivery/receipt.json', receiptSha256: createHash('sha256').update(receipt).digest('hex') }));
} else {
  const receipt = JSON.parse(readFileSync('.delivery/receipt.json'));
  if (receipt.result !== 'passed' || receipt.expired) process.exit(1);
  console.log(JSON.stringify({ result: 'passed', card, head, binding: '.delivery/binding.json' }));
}`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-review-gate-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
  await writeFile(join(root, '.gitignore'), '.delivery/\n')
  await writeFile(join(root, 'verify.mjs'), verifier)
  await writeFile(join(root, 'agent-workflow.config.json'), JSON.stringify({ commands: { validationProof: 'verify.mjs' } }))
  git('add', '.gitignore', 'verify.mjs', 'agent-workflow.config.json'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  await writeFile(join(root, 'app.mjs'), 'export const answer = 42\n')
  execFileSync(process.execPath, ['--check', 'app.mjs'], { cwd: root })
  git('add', 'app.mjs'); git('commit', '-m', 'implementation')
  const head = git('rev-parse', 'HEAD')
  let state = createDeliveryState({ card: 'PROJ-701', complexity: 'standard', baseSha: base, worktree: root })
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'implementation_complete', { commit: head, validation: focused(head) })
  await writeDeliveryState(root, state)
  const cli = async (command, event, payload, ok = true) => {
    await writeFile(join(root, '.delivery/payload.json'), JSON.stringify(payload ?? {}))
    const result = spawnSync(process.execPath, [resolve('workflow/orchestrator/delivery-state.mjs'), command, '--repo', root,
      '--card', state.card, ...(event ? ['--event', event, '--payload-file', '.delivery/payload.json'] : [])], { encoding: 'utf8' })
    assert.equal(result.status === 0, ok, result.stderr)
    return ok ? JSON.parse(result.stdout) : result.stderr
  }
  const runGate = () => execFileSync(process.execPath, ['verify.mjs', 'run', '--card', state.card, '--head', head, '--base', base], { cwd: root })
  return { root, git, base, head, state, cli, runGate }
}

test('CLI reviews before any gate, verifies the approved pair and reuses proof without a second gate', async () => {
  const f = await fixture()
  for (const validation of [undefined, { ...focused(f.head), focused: 'failed' },
    { ...focused(f.head), checks: [{ command: 'test', exitCode: 1 }] }]) {
    await writeDeliveryState(f.root, { ...f.state, validation })
    await f.cli('review-ready', undefined, undefined, false)
  }
  await writeDeliveryState(f.root, f.state)
  assert.equal((await f.cli('review-ready')).scope, 'code_and_focused_checks')
  await assert.rejects(readFile(join(f.root, '.delivery/count')), { code: 'ENOENT' })
  await f.cli('event', 'reviews_approved', { receipts: [receipt(f.head)] })
  const pending = await readFile(join(f.root, '.delivery/state/PROJ-701.json'), 'utf8')
  await f.cli('event', 'review_approved', { validation: gate(f.head, f.base) }, false)
  assert.equal(await readFile(join(f.root, '.delivery/state/PROJ-701.json'), 'utf8'), pending)
  f.runGate()
  const approved = await f.cli('event', 'review_approved', { validation: gate(f.head, f.base) })
  assert.equal(approved.state, 'APPROVED')
  assert.ok(approved.validation.bindingSha256)
  assert.equal((await f.cli('event', 'start_shipping')).state, 'SHIPPING')
  assert.equal(await readFile(join(f.root, '.delivery/count'), 'utf8'), '1')
})

test('CLI rejects expired, failed, tampered, wrong-pair proof and any post-review commit', async () => {
  const f = await fixture()
  await f.cli('event', 'reviews_approved', { receipts: [receipt(f.head)] })
  f.runGate()
  const raw = await readFile(join(f.root, '.delivery/binding.json'), 'utf8')
  for (const field of ['head', 'base']) {
    await writeFile(join(f.root, '.delivery/binding.json'), JSON.stringify({ ...JSON.parse(raw), [field]: 'old' }))
    await f.cli('event', 'review_approved', { validation: gate(f.head, f.base) }, false)
  }
  await writeFile(join(f.root, '.delivery/binding.json'), raw)
  await f.cli('event', 'review_approved', { validation: gate(f.head, f.base) })
  await writeFile(join(f.root, '.delivery/binding.json'), raw + '\n')
  assert.match(await f.cli('event', 'start_shipping', {}, false), /evidence changed/)
  await writeFile(join(f.root, '.delivery/binding.json'), raw)
  for (const receipt of [{ result: 'passed', expired: true }, { result: 'failed' }, { result: 'passed', expired: false, tampered: true }]) {
    await writeFile(join(f.root, '.delivery/receipt.json'), JSON.stringify(receipt))
    await f.cli('event', 'start_shipping', {}, false)
  }
  f.runGate()
  await writeFile(join(f.root, 'app.mjs'), 'export const answer = 43\n')
  await f.cli('event', 'start_shipping', {}, false)
  f.git('add', 'app.mjs'); f.git('commit', '-m', 'unreviewed correction')
  assert.match(await f.cli('event', 'start_shipping', {}, false), /unexpected worktree head/)
})

test('legacy states stay intact and require durable evidence; unknown versions stop', async () => {
  const f = await fixture()
  const legacy = { ...f.state, version: 1, validation: { full_check: 'passed' } }
  await writeDeliveryState(f.root, legacy)
  await f.cli('review-ready', undefined, undefined, false)
  assert.deepEqual(JSON.parse(await readFile(join(f.root, '.delivery/state/PROJ-701.json'), 'utf8')), legacy)
  const receipts = [{ reviewed_head: f.head, status: 'approved', reviewer_slot: 'single' }]
  for (const stage of ['APPROVED', 'SHIPPING']) {
    const old = { ...legacy, state: stage, reviewReceipts: receipts }
    await writeDeliveryState(f.root, old)
    if (stage === 'APPROVED') await f.cli('event', 'start_shipping', {}, false)
    f.runGate()
    const refreshed = await f.cli('event', 'validation_refreshed', { validation: gate(f.head, f.base) })
    assert.equal(refreshed.version, 1)
    assert.equal(refreshed.state, stage)
    assert.deepEqual(refreshed.reviewReceipts, receipts)
    if (stage === 'APPROVED') assert.equal((await f.cli('event', 'start_shipping')).state, 'SHIPPING')
  }
  assert.throws(() => transitionDeliveryState({ ...f.state, version: 99 }, 'needs_human'), /unsupported delivery state/)
})
