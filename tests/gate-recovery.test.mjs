import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeliveryState, deliveryCheckpoint, transitionDeliveryState, writeDeliveryState } from '../workflow/orchestrator/delivery-state.mjs'
import { verifyEvidence, verifyFailedGateEvidence } from '../workflow/orchestrator/delivery-evidence.mjs'

const stateCli = resolve('workflow/orchestrator/delivery-state.mjs')
const evidenceCli = resolve('workflow/orchestrator/delivery-evidence.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const defect = { id: 'FIX-1', priority: 'P1', file: 'app.mjs', line: 1,
  requirement: 'Reject empty input', evidence: 'The full gate reproduces acceptance of empty input',
  required_change: 'Reject empty input and retain a regression test' }
const approval = (head, slot) => ({ reviewed_head: head, reviewer_slot: slot, status: 'approved', scope: 'code_and_focused_checks' })

async function fixture(complexity = 'critical', linked = false) {
  let root = await mkdtemp(join(tmpdir(), 'workflow-gate-recovery-'))
  const owner = root
  const branch = linked ? 'codex/delivery' : 'codex/fixture'
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'codex/fixture'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
  await writeFile(join(root, '.gitignore'), '.delivery/\n')
  git('add', '.gitignore'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  if (linked) {
    const delivery = await mkdtemp(join(tmpdir(), 'workflow-gate-worktree-'))
    git('worktree', 'add', '-b', branch, delivery)
    root = delivery
  }
  await writeFile(join(root, 'app.mjs'), 'export const accepts = value => true\n')
  git('add', 'app.mjs'); git('commit', '-m', 'implementation')
  const head = git('rev-parse', 'HEAD'), card = 'PROJ-901'
  const capture = (kind, red = false, currentHead = head, currentBase = base) => {
    const result = spawnSync(process.execPath, [evidenceCli, 'run', '--repo', root, '--card', card,
      '--base', currentBase, '--head', currentHead, '--kind', kind, '--', process.execPath, '-e',
      red ? 'console.error("empty input accepted");process.exit(1)' : 'console.log("checked")'], { encoding: 'utf8' })
    assert.equal(result.status, red ? 1 : 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const green = capture('focused')
  const focused = { head, focused: 'passed', checks: [{ command: green.command, exitCode: 0,
    receipt: green.receipt, receiptSha256: sha(await readFile(green.receipt)) }] }
  let state = createDeliveryState({ card, complexity, baseSha: base, worktree: root, branch })
  state.policy.evidenceRequired = true
  state.policy.reuseFocusedChecks = true
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'implementation_complete', { commit: head, validation: focused })
  const slots = complexity === 'critical' ? ['A', 'B'] : ['single']
  state = transitionDeliveryState(state, 'reviews_approved', { receipts: slots.map(slot => approval(head, slot)) })
  const red = capture('gate', true)
  const payload = { failedGate: { receipt: red.receipt, receiptSha256: sha(await readFile(red.receipt)) },
    receipts: state.reviewReceipts.map((receipt, index) => index ? receipt : { ...receipt, status: 'findings', findings: [defect] }),
    findings: [defect] }
  const stop = (current = state) => transitionDeliveryState(current, 'needs_human', { reason: 'required_gate_failure; human reconciliation required' })
  const authorization = { reference: 'human-decision-901', reason: 'Resume the confirmed bounded correction' }
  const path = join(root, '.delivery/state', `${card}.json`)
  const event = async (name, data, ok = true, repo = root) => {
    const stateFile = join(repo, '.delivery/state', `${card}.json`)
    const before = await readFile(stateFile, 'utf8')
    await writeFile(join(repo, '.delivery/payload.json'), JSON.stringify(data))
    const result = spawnSync(process.execPath, [stateCli, 'event', '--repo', repo, '--card', card,
      '--event', name, '--payload-file', '.delivery/payload.json'], { encoding: 'utf8' })
    assert.equal(result.status === 0, ok, result.stderr)
    if (!ok) assert.equal(await readFile(stateFile, 'utf8'), before, 'rejected events must not rewrite state')
    return ok ? JSON.parse(result.stdout) : result.stderr
  }
  await writeDeliveryState(root, state)
  return { root, owner, card, base, head, git, state, green, red, payload, stop, authorization, path, event, capture }
}

test('recovery refuses legacy evidence policies without rewriting historical state', async () => {
  const f = await fixture('standard')
  for (const evidenceRequired of [false, undefined]) {
    for (const stopped of [false, true]) {
      const state = structuredClone(f.state)
      if (evidenceRequired === undefined) delete state.policy.evidenceRequired
      else state.policy.evidenceRequired = evidenceRequired
      await writeDeliveryState(f.root, stopped ? f.stop(state) : state)
      assert.match(await f.event('gate_findings', { ...f.payload, authorization: f.authorization }, false),
        /recorded raw evidence policy/)
    }
  }
})

test('native CLI records gate findings in VALIDATING without converting failure to approval', async () => {
  const f = await fixture()
  const next = await f.event('gate_findings', f.payload)
  assert.equal(next.state, 'REWORKING')
  assert.equal(next.validation.result, 'failed')
  assert.equal(next.validation.checks[0].exitCode, 1)
  assert.equal(next.reworkCycles, 0)
  assert.deepEqual(next.reviewReceipts[1], f.state.reviewReceipts[1])
  assert.deepEqual(next.gateFailures[0].reviewReceipts, f.state.reviewReceipts)
  assert.deepEqual(next.history.slice(0, -1), f.state.history)
  assert.equal(next.history.at(-1).event, 'gate_findings')
  assert.equal(next.lastAction, 'dispatch_rework')
  await f.event('start_shipping', {}, false)
  await f.event('review_approved', { useReviewedFocused: true }, false)
  assert.deepEqual(JSON.parse(await readFile(f.red.receipt, 'utf8')).result, 'failed')
  assert.doesNotMatch(deliveryCheckpoint(next), /code_and_focused_checks/)
})

test('human recovery preserves stop provenance, counters, routes, fingerprints and frozen pair', async () => {
  const f = await fixture()
  const current = { ...f.state, failureFingerprints: { full_gate: 1 }, escalationCount: 1 }
  const stopped = f.stop(current)
  assert.match(deliveryCheckpoint(stopped), /required_gate_failure; human reconciliation required/)
  assert.doesNotMatch(deliveryCheckpoint(stopped), /code_and_focused_checks/)
  await writeDeliveryState(f.root, stopped)
  await f.event('gate_findings', f.payload, false)
  const recovered = await f.event('gate_findings', { ...f.payload, authorization: f.authorization })
  assert.equal(recovered.state, 'REWORKING')
  assert.equal(recovered.reason, undefined)
  for (const field of ['policy', 'route', 'baseSha', 'currentHead', 'branch', 'worktree', 'reworkCycles', 'escalationCount', 'failureFingerprints']) {
    assert.deepEqual(recovered[field], stopped[field], field)
  }
  assert.deepEqual(recovered.history.slice(0, -1), stopped.history)
  assert.deepEqual(recovered.gateFailures[0].authorization, f.authorization)
  assert.deepEqual(recovered.gateFailures[0].terminal, stopped.history.at(-1))
  assert.equal(recovered.gateFailures[0].reason, stopped.reason)
  assert.match(deliveryCheckpoint(recovered), /required_gate_failure; human reconciliation required/)
  assert.doesNotMatch(deliveryCheckpoint(recovered), /code_and_focused_checks/)
  await f.event('gate_findings', { ...f.payload, authorization: f.authorization }, false)
})

test('failed verification is explicit; normal verifyEvidence remains strictly passing', async () => {
  const f = await fixture(), identity = { receipt: f.red.receipt, card: f.card, base: f.base, head: f.head, kind: 'gate' }
  assert.throws(() => verifyEvidence(identity), /passing evidence/)
  assert.equal(verifyFailedGateEvidence(identity).result, 'failed')
  assert.throws(() => verifyFailedGateEvidence({ ...identity, kind: 'focused' }), /must be a gate/)
  const green = f.capture('gate')
  assert.throws(() => verifyFailedGateEvidence({ ...identity, receipt: green.receipt }), /failed gate command/)
})

test('fake, missing, altered, wrong-pair and non-gate evidence cannot trigger recovery', async () => {
  const f = await fixture()
  for (const failedGate of [undefined, {}, { receipt: 'missing', receiptSha256: '0'.repeat(64) },
    { ...f.payload.failedGate, receiptSha256: '0'.repeat(64) },
    { receipt: f.green.receipt, receiptSha256: sha(await readFile(f.green.receipt)) }]) {
    await f.event('gate_findings', { ...f.payload, failedGate }, false)
  }
  const original = await readFile(f.red.receipt, 'utf8'), raw = JSON.parse(original)
  const changes = [{ result: 'passed' }, { base: f.head }, { head: f.base }, { card: 'PROJ-902' },
    { unchanged: false }, { exitCode: 0 }, { timedOut: true }, { aborted: true }, { signal: 'SIGTERM' },
    { files: raw.files.filter(file => file.path !== 'process.json') },
    { snapshot: { ...raw.snapshot, dirty: true } }, { snapshot: { ...raw.snapshot, fingerprint: 'changed' } },
    { snapshot: { ...raw.snapshot, branch: 'codex/other' } }, { startedAt: '2000-01-01T00:00:00Z' }]
  for (const changeset of changes) {
    const bytes = JSON.stringify({ ...raw, ...changeset })
    await writeFile(f.red.receipt, bytes)
    await f.event('gate_findings', { ...f.payload, failedGate: { receipt: f.red.receipt, receiptSha256: sha(bytes) } }, false)
  }
  await writeFile(f.red.receipt, original)
  for (const filename of ['stdout.log', 'stderr.log', 'process.json']) {
    const file = join(f.red.directory, filename), bytes = await readFile(file)
    await writeFile(file, 'tampered')
    await f.event('gate_findings', f.payload, false)
    await writeFile(file, bytes)
  }
  await writeFile(f.red.receipt, original + '\n')
  await f.event('gate_findings', f.payload, false)
})

test('missing slots, unconfirmed findings and replacement of retained approvals are refused', async () => {
  const f = await fixture()
  for (const changes of [{ receipts: [f.payload.receipts[0]] }, { receipts: f.state.reviewReceipts },
    { receipts: [{ ...f.payload.receipts[0], reviewed_head: f.base }, f.payload.receipts[1]] },
    { receipts: [{ ...f.payload.receipts[0], reviewed_base: f.head }, f.payload.receipts[1]] },
    { receipts: [{ ...f.payload.receipts[0], card: 'PROJ-902' }, f.payload.receipts[1]] },
    { receipts: [f.payload.receipts[0], { ...f.payload.receipts[1], extra: 'invented' }] },
    { findings: [] }, { findings: [{ ...defect, file: 'other.mjs' }] },
    { findings: [defect, defect] },
    { receipts: [{ ...f.payload.receipts[0], findings: [{ ...defect, priority: 'P3' }] }, f.payload.receipts[1]] }]) {
    await f.event('gate_findings', { ...f.payload, ...changes }, false)
  }
  const other = { ...defect, id: 'FIX-2', file: 'other.mjs' }
  await f.event('gate_findings', { ...f.payload,
    receipts: [f.payload.receipts[0], { ...f.payload.receipts[1], status: 'findings', findings: [other] }] }, false)
})

test('terminal recovery requires human authorization and real validation-stop provenance', async () => {
  const f = await fixture(), payload = { ...f.payload, authorization: f.authorization }, stopped = f.stop()
  for (const authorization of [undefined, {}, { reference: '', reason: 'approved' }, { reference: 'human', reason: ' ' }]) {
    assert.throws(() => transitionDeliveryState(stopped, 'gate_findings', { ...payload, authorization }), /human authorization/)
  }
  for (const state of ['DONE', 'FAILED', 'READY', 'IMPLEMENTING', 'REVIEWING', 'REWORKING', 'APPROVED', 'SHIPPING']) {
    assert.throws(() => transitionDeliveryState({ ...stopped, state }, 'gate_findings', payload))
  }
  for (const terminal of [{ from: 'REVIEWING', event: 'needs_human' }, { event: 'phase_failure' }, { to: 'FAILED' },
    { at: '2000-01-01T00:00:00Z' }]) {
    assert.throws(() => transitionDeliveryState({ ...stopped,
      history: [...stopped.history.slice(0, -1), { ...stopped.history.at(-1), ...terminal }] }, 'gate_findings', payload))
  }
  assert.throws(() => transitionDeliveryState({ ...stopped, reason: '' }, 'gate_findings', payload))
  assert.throws(() => transitionDeliveryState({ ...stopped, reason: 'scope_decision_required' }, 'gate_findings', payload))
  const legacyReason = 'workflow_missing_transition_VALIDATING_to_REWORKING_after_required_gate_failure; human reconciliation required'
  const legacy = transitionDeliveryState({ ...stopped, reason: legacyReason }, 'gate_findings', payload)
  assert.equal(legacy.gateFailures[0].reason, legacyReason)
  assert.throws(() => transitionDeliveryState(stopped, 'review_findings', payload), /terminal state/)
})

test('rework limits cannot be reset by human authorization or payload counters', async () => {
  const f = await fixture(), exhausted = { ...f.state, reworkCycles: 1 }
  const bounded = transitionDeliveryState(exhausted, 'gate_findings', f.payload)
  assert.equal(bounded.state, 'NEEDS_HUMAN')
  assert.equal(bounded.reason, 'rework_limit_reached')
  assert.equal(bounded.reworkCycles, 1)
  assert.throws(() => transitionDeliveryState(f.stop(exhausted), 'gate_findings', {
    ...f.payload, authorization: f.authorization, reworkCycles: 0, policy: { maxReworkCycles: 99 },
  }), /rework limit/)
  assert.equal(transitionDeliveryState({ ...exhausted, policy: { ...exhausted.policy, maxReworkCycles: 2 } },
    'gate_findings', f.payload).state, 'REWORKING', 'historical budget is preserved')
})

test('gate findings accept one explicit additional cycle only after all failed-gate and review proof validates', async () => {
  const f = await fixture(), reworkAuthorization = { ...f.authorization, additionalCycles: 1 }
  const current = { ...f.state, reworkCycles: 1, escalationCount: 1, failureFingerprints: { prior_failure: 2 } }
  const payload = { ...f.payload, reworkAuthorization }
  await writeDeliveryState(f.root, current)
  for (const changes of [{ reworkAuthorization: null }, { reworkAuthorization: { ...reworkAuthorization, additionalCycles: 2 } },
    { reworkAuthorization: { ...reworkAuthorization, reference: '' } }, { failedGate: undefined },
    { failedGate: { ...f.payload.failedGate, receiptSha256: '0'.repeat(64) } },
    { receipts: [f.payload.receipts[0]] }, { receipts: [{ ...f.payload.receipts[0], reviewed_head: f.base }, f.payload.receipts[1]] },
    { receipts: [{ ...f.payload.receipts[0], reviewed_base: f.head }, f.payload.receipts[1]] }, { findings: [] },
    { findings: [{ ...defect, file: 'other.mjs' }] }]) {
    await f.event('gate_findings', { ...payload, ...changes }, false)
  }
  assert.throws(() => transitionDeliveryState(f.state, 'gate_findings', payload), /current rework limit/)
  assert.throws(() => transitionDeliveryState(f.stop(current), 'gate_findings', {
    ...payload, authorization: f.authorization,
  }), /rework limit/)
  const next = await f.event('gate_findings', payload)
  assert.equal(next.state, 'REWORKING')
  for (const field of ['policy', 'route', 'reworkCycles', 'escalationCount', 'failureFingerprints', 'baseSha', 'currentHead']) {
    assert.deepEqual(next[field], current[field], field)
  }
  assert.deepEqual(next.history.slice(0, -1), current.history)
  assert.deepEqual(next.gateFailures[0].reviewReceipts, current.reviewReceipts)
  assert.equal(next.gateFailures[0].validation.result, 'failed')
  const trace = next.reworkAuthorizations[0]
  assert.deepEqual(trace, { ...reworkAuthorization, previousLimit: 1, newLimit: 2, reworkCycles: 1,
    base: f.base, head: f.head, event: 'gate_findings', at: trace.at })
  assert.ok(Number.isFinite(Date.parse(trace.at)))
})

test('dirty sources, hidden index flags, changed branch/head and changed focused proof refuse recovery', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'app.mjs'), 'changed\n')
  await f.event('gate_findings', f.payload, false)
  f.git('restore', 'app.mjs')
  f.git('update-index', '--assume-unchanged', 'app.mjs')
  await f.event('gate_findings', f.payload, false)
  f.git('update-index', '--no-assume-unchanged', 'app.mjs')
  f.git('branch', '-m', 'codex/other')
  await f.event('gate_findings', f.payload, false)
  f.git('branch', '-m', 'codex/fixture')
  const focused = await readFile(f.green.receipt)
  await writeFile(f.green.receipt, Buffer.concat([focused, Buffer.from('\n')]))
  await f.event('gate_findings', f.payload, false)
  await writeFile(f.green.receipt, focused)
  const noHash = structuredClone(f.state)
  delete noHash.focusedValidation.checks[0].receiptSha256
  assert.throws(() => transitionDeliveryState(noHash, 'gate_findings', f.payload), /focused receipt hashes/)
  f.git('commit', '--allow-empty', '-m', 'unexpected head')
  await f.event('gate_findings', f.payload, false)
})

test('recovery requires new proof and archives every failed bundle before DONE, including after worktree removal', async () => {
  const f = await fixture('standard', true)
  await writeDeliveryState(f.root, f.stop())
  await f.event('gate_findings', { ...f.payload, authorization: f.authorization })
  await f.event('rework_complete', { commit: f.head, validation: f.state.focusedValidation }, false)
  await writeFile(join(f.root, 'app.mjs'), 'export const accepts = value => value !== ""\n')
  f.git('add', 'app.mjs'); f.git('commit', '-m', 'bounded correction')
  let head = f.git('rev-parse', 'HEAD')
  await f.event('rework_complete', { commit: head, validation: { head, focused: 'passed', checks: [] } }, false)
  await f.event('rework_complete', { commit: head, validation: { head, focused: 'passed',
    checks: [{ command: 'unexecuted focused check', exitCode: 0 }] } }, false)
  let green = f.capture('focused', false, head)
  const focused = { head, focused: 'passed', checks: [{ command: green.command, exitCode: 0, receipt: green.receipt }] }
  const reviewing = await f.event('rework_complete', { commit: head, validation: focused })
  assert.equal(reviewing.reworkCycles, 1)
  assert.deepEqual(reviewing.reviewReceipts, [])
  assert.deepEqual(reviewing.previousReview.receipts, f.payload.receipts)
  assert.equal(reviewing.gateFailures[0].validation.result, 'failed')
  await f.event('start_shipping', {}, false)
  await f.event('reviews_approved', { receipts: f.state.reviewReceipts }, false)
  await f.event('reviews_approved', { receipts: [approval(head, 'single')] })
  await f.event('start_shipping', {}, false)
  await f.event('review_approved', { useReviewedFocused: true }, false)
  await f.event('review_approved', { validation: reviewing.gateFailures[0].validation }, false)
  const secondRed = f.capture('gate', true, head)
  await f.event('gate_findings', { failedGate: { receipt: secondRed.receipt, receiptSha256: sha(await readFile(secondRed.receipt)) },
    receipts: [{ ...approval(head, 'single'), status: 'findings', findings: [defect] }], findings: [defect],
    reworkAuthorization: { ...f.authorization, additionalCycles: 1 } })
  await writeFile(join(f.root, 'app.mjs'), 'export const accepts = value => typeof value === "string" && value !== ""\n')
  f.git('add', 'app.mjs'); f.git('commit', '-m', 'second bounded correction')
  head = f.git('rev-parse', 'HEAD')
  green = f.capture('focused', false, head)
  await f.event('rework_complete', { commit: head, validation: { head, focused: 'passed',
    checks: [{ command: green.command, exitCode: 0, receipt: green.receipt }] } })
  await f.event('reviews_approved', { receipts: [approval(head, 'single')] })
  const gate = f.capture('gate', false, head)
  const validation = { kind: 'required_gate', result: 'passed', base: f.base, head, profile: 'full',
    reason: 'Full gate after confirmed correction', receipt: gate.receipt,
    checks: [{ command: gate.command, exitCode: 0, receipt: gate.receipt }] }
  await f.event('review_approved', { validation: { ...validation, receipt: 'nonexistent-receipt',
    checks: [{ command: 'unexecuted gate', exitCode: 0, receipt: 'nonexistent-receipt' }] } }, false)
  assert.equal((await f.event('review_approved', { validation })).state, 'APPROVED')
  const shipping = await f.event('start_shipping', {})
  assert.equal(shipping.state, 'SHIPPING')
  assert.equal(shipping.reworkCycles, 2)
  assert.equal(shipping.policy.maxReworkCycles, 1)
  assert.equal(shipping.reworkAuthorizations[0].head, reviewing.currentHead)
  assert.equal(shipping.gateFailures.length, 2)
  assert.equal(JSON.parse(await readFile(f.red.receipt, 'utf8')).result, 'failed')

  const archive = await mkdtemp(join(tmpdir(), 'workflow-gate-archive-'))
  const done = { mergeCommit: head, pr: 'https://example.test/pr/1', evidenceArchive: archive }
  for (const capture of [green, gate]) await cp(capture.directory, join(archive, capture.directory.split('/').at(-1)), { recursive: true })
  await f.event('shipped', done, false)
  const bundle = join(archive, f.red.directory.split('/').at(-1))
  await cp(f.red.directory, bundle, { recursive: true })
  await f.event('shipped', done, false)
  await cp(secondRed.directory, join(archive, secondRed.directory.split('/').at(-1)), { recursive: true })

  for (const filename of ['receipt.json', 'stdout.log', 'stderr.log', 'process.json']) {
    const file = join(bundle, filename), original = await readFile(file)
    await writeFile(file, filename === 'receipt.json' ? Buffer.concat([original, Buffer.from('\n')]) : 'altered')
    await f.event('shipped', done, false)
    await writeFile(file, original)
  }
  for (const changes of [{ base: head }, { head: f.base },
    { snapshot: { ...shipping.gateFailures[0].snapshot, branch: 'codex/other' } },
    { snapshot: { ...shipping.gateFailures[0].snapshot, fingerprint: 'changed' } }]) {
    const changed = structuredClone(shipping)
    if (changes.snapshot) changed.gateFailures[0].snapshot = changes.snapshot
    else Object.assign(changed.gateFailures[0].validation, changes)
    await writeDeliveryState(f.root, changed)
    await f.event('shipped', done, false)
  }
  await writeDeliveryState(f.root, shipping)
  assert.equal((await f.event('shipped', done)).state, 'DONE')

  await writeDeliveryState(f.owner, shipping)
  f.git('-C', f.owner, 'worktree', 'remove', f.root)
  await assert.rejects(access(f.root), { code: 'ENOENT' })
  const rawFile = join(bundle, 'stderr.log'), original = await readFile(rawFile)
  await writeFile(rawFile, 'altered after cleanup')
  await f.event('shipped', done, false, f.owner)
  await writeFile(rawFile, original)
  assert.equal((await f.event('shipped', done, true, f.owner)).state, 'DONE')
})
