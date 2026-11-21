import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeliveryState, deliveryCheckpoint, deliverySummary, transitionDeliveryState, writeDeliveryState } from '../workflow/orchestrator/delivery-state.mjs'

const stateCli = resolve('workflow/orchestrator/delivery-state.mjs')
const evidenceCli = resolve('workflow/orchestrator/delivery-evidence.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const finding = { id: 'PR-1', priority: 'P2', file: 'app.mjs', line: 1, requirement: 'Reject empty input',
  evidence: 'The open PR thread reproduces acceptance of empty input', required_change: 'Reject empty input' }
const approval = (head, slot) => ({ reviewed_head: head, reviewer_slot: slot, status: 'approved', scope: 'code_and_focused_checks' })

function assertSanitized(state) {
  if (!['REWORKING', 'REVIEWING', 'VALIDATING'].includes(state.state)) return
  const inspect = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['shippingFindings', 'previousReview', 'confirmedReviewReceipts'].includes(key), `private ${key} leaked`)
      if (key === 'reviewReceipts') assert.deepEqual(child, [])
      assert.notEqual(child, 'code_and_focused_checks', 'private reviewer receipt leaked')
      inspect(child)
    }
  }
  inspect(deliverySummary(state))
  inspect(JSON.parse(deliveryCheckpoint(state).match(/```json\n([\s\S]*?)\n```/)[1]))
}

async function fixture(complexity = 'critical', reuse = false, verifier = false) {
  const repo = await mkdtemp(join(tmpdir(), 'workflow-premerge-'))
  const worktree = await mkdtemp(join(tmpdir(), 'workflow-premerge-worktree-'))
  const gitAt = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  gitAt(repo, 'init', '-b', 'main'); gitAt(repo, 'config', 'user.email', 'fixture@example.test'); gitAt(repo, 'config', 'user.name', 'Fixture')
  gitAt(repo, 'remote', 'add', 'origin', 'git@example.test:fixtures/workflow.git')
  await writeFile(join(repo, '.gitignore'), '.delivery/\n')
  if (verifier) {
    await writeFile(join(repo, 'agent-workflow.config.json'), JSON.stringify({ commands: { validationProof: 'verify.mjs' } }))
    await writeFile(join(repo, 'verify.mjs'), `import {readFileSync} from 'node:fs'; console.log(readFileSync('.delivery/verdict.json', 'utf8'))\n`)
    gitAt(repo, 'add', 'agent-workflow.config.json', 'verify.mjs')
  }
  gitAt(repo, 'add', '.gitignore'); gitAt(repo, 'commit', '-m', 'base')
  const base = gitAt(repo, 'rev-parse', 'HEAD'), branch = 'codex/fixture', card = 'PROJ-902'
  gitAt(repo, 'worktree', 'add', '-b', branch, worktree)
  const git = (...args) => gitAt(worktree, ...args)
  await writeFile(join(worktree, 'app.mjs'), 'export const accepts = value => true\n')
  git('add', 'app.mjs'); git('commit', '-m', 'implementation')
  const head = git('rev-parse', 'HEAD')
  const capture = (kind, output = 'checked', currentHead = head) => {
    const result = spawnSync(process.execPath, [evidenceCli, 'run', '--repo', worktree, '--card', card,
      '--base', base, '--head', currentHead, '--kind', kind, '--', process.execPath, '-e', `console.log(${JSON.stringify(output)})`], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const green = capture('focused')
  const focused = { head, focused: 'passed', checks: [{ command: green.command, exitCode: 0,
    receipt: green.receipt, receiptSha256: sha(await readFile(green.receipt)) }] }
  let state = createDeliveryState({ card, complexity, baseSha: base, worktree, branch })
  state.policy.evidenceRequired = true; state.policy.reuseFocusedChecks = true
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'implementation_complete', { commit: head, validation: focused })
  const receipts = (currentHead = head) => (complexity === 'critical' ? ['A', 'B'] : ['single']).map(slot => approval(currentHead, slot))
  state = transitionDeliveryState(state, 'reviews_approved', { receipts: receipts() })
  const gate = capture('gate')
  const validation = { kind: 'required_gate', result: 'passed', base, head, profile: 'full', reason: 'Required full gate', receipt: gate.receipt,
    checks: [{ command: gate.command, exitCode: 0, receipt: gate.receipt, receiptSha256: sha(await readFile(gate.receipt)) }] }
  state = transitionDeliveryState(state, 'review_approved', reuse ? { useReviewedFocused: true } : { validation })
  state = transitionDeliveryState(state, 'start_shipping')
  state.ci = { head, status: 'completed', conclusion: 'success' }; state.migration = { applied: true, head }
  const pr = { number: 42, url: 'https://example.test/fixtures/workflow/pull/42' }
  const metadata = { ...pr, headRefOid: head, headRefName: branch, baseRefName: 'main', state: 'OPEN', mergedAt: null }
  const premerge = capture('premerge', JSON.stringify(metadata))
  const premergeProof = { receipt: premerge.receipt, receiptSha256: sha(await readFile(premerge.receipt)) }
  const payload = { pr, premergeProof, receipts: receipts().map((receipt, i) => i ? receipt : { ...receipt, status: 'findings', findings: [finding] }), findings: [finding] }
  const path = join(repo, '.delivery/state', `${card}.json`)
  const event = async (name, data = {}, ok = true) => {
    const before = await readFile(path, 'utf8')
    await writeFile(join(repo, '.delivery/payload.json'), JSON.stringify(data))
    const result = spawnSync(process.execPath, [stateCli, 'event', '--repo', repo, '--card', card,
      '--event', name, '--payload-file', '.delivery/payload.json'], { encoding: 'utf8' })
    assert.equal(result.status === 0, ok, result.stderr)
    if (!ok) assert.equal(await readFile(path, 'utf8'), before, 'rejected event is atomic')
    if (!ok) return result.stderr
    const next = JSON.parse(result.stdout)
    assertSanitized(next)
    return next
  }
  if (verifier) {
    const receipt = '.delivery/project-receipt.json', binding = '.delivery/binding.json'
    await writeFile(join(worktree, receipt), 'project gate receipt\n')
    const receiptSha256 = sha(await readFile(join(worktree, receipt)))
    await writeFile(join(worktree, binding), JSON.stringify({ result: 'passed', card, base, head, receipt, receiptSha256 }))
    await writeFile(join(worktree, '.delivery/verdict.json'), JSON.stringify({ result: 'passed', card, head, binding }))
    state.validation = { ...state.validation, receipt, receiptSha256, binding, bindingSha256: sha(await readFile(join(worktree, binding))) }
  }
  await writeDeliveryState(repo, state)
  return { repo, worktree, git, gitAt, base, head, card, state, metadata, pr, premerge, payload, green, gate, focused, capture, event, receipts }
}

test('native premerge findings bind the first PR and preserve passing gate, CI, migrations, approvals and counters', async () => {
  const f = await fixture()
  const current = { ...f.state, escalationCount: 1, failureFingerprints: { existing_failure: 1 } }
  await writeDeliveryState(f.repo, current)
  const next = await f.event('shipping_findings', f.payload)
  assert.equal(next.state, 'REWORKING'); assert.equal(next.lastAction, 'dispatch_rework')
  assert.deepEqual(next.pr, f.pr)
  assert.deepEqual(next.validation, current.focusedValidation)
  for (const key of ['focusedValidation', 'ci', 'migration', 'policy', 'route', 'reworkCycles', 'escalationCount', 'failureFingerprints']) {
    assert.deepEqual(next[key], current[key], key)
  }
  assert.deepEqual(next.history.slice(0, -1), current.history)
  assert.equal(next.history.at(-1).event, 'shipping_findings')
  assert.deepEqual(next.shippingFindings[0].reviewReceipts, current.reviewReceipts)
  assert.deepEqual(next.shippingFindings[0].confirmedReviewReceipts, f.payload.receipts)
  assert.deepEqual(next.shippingFindings[0].findings, f.payload.findings)
  assert.deepEqual(next.shippingFindings[0].validation, current.validation)
  assert.equal(next.shippingFindings[0].validation.result, 'passed')
  assert.equal(next.gateFailures, undefined)
  assert.deepEqual(next.reviewReceipts[1], current.reviewReceipts[1])
  assert.doesNotMatch(deliveryCheckpoint(next), /code_and_focused_checks|Reject empty input/)
  await f.event('start_shipping', {}, false)
  await f.event('shipping_findings', f.payload, false)
})

test('recovery rejects other states, legacy policies, merged deliveries and recorded PR mismatches', async () => {
  const f = await fixture()
  const invalid = ['READY', 'IMPLEMENTING', 'REVIEWING', 'VALIDATING', 'APPROVED', 'REWORKING', 'DONE', 'NEEDS_HUMAN', 'FAILED'].map(state => ({ state }))
  invalid.push({ version: 1 }, { policy: { ...f.state.policy, evidenceRequired: false } }, { policy: { ...f.state.policy, evidenceRequired: undefined } },
    { mergeCommit: f.head }, { pr: { ...f.pr, merged: true } }, { pr: { ...f.pr, mergedAt: new Date().toISOString() } },
    { pr: { ...f.pr, number: 43 } }, { pr: { ...f.pr, url: f.pr.url + '0' } }, { pr: f.pr.url + '0' })
  for (const changes of invalid) {
    const current = { ...f.state, ...changes }
    await writeDeliveryState(f.repo, current)
    await f.event('shipping_findings', f.payload, false)
  }
  for (const field of ['validation', 'focusedValidation']) {
    const current = structuredClone(f.state)
    delete current[field].checks[0].receiptSha256
    await writeDeliveryState(f.repo, current)
    await f.event('shipping_findings', f.payload, false)
  }
  for (const pr of [f.pr, f.pr.url, { ...f.pr, ci: 'historical' }]) {
    await writeDeliveryState(f.repo, { ...f.state, pr })
    const next = await f.event('shipping_findings', f.payload)
    assert.equal(next.state, 'REWORKING')
    assert.deepEqual(next.pr, pr)
  }
})

test('provider proof must identify the exact repository, PR, base, branch, unmerged head and current clean capture', async () => {
  const f = await fixture()
  for (const changes of [{ number: 43 }, { url: 'https://other.test/fixtures/workflow/pull/42' },
    { url: 'https://example.test/other/workflow/pull/42' }, { url: f.pr.url + '?token=redacted' },
    { url: 'https://example.test/fixtures/workflow/pull/43' }, { baseRefName: 'other' }, { headRefOid: f.base },
    { headRefName: 'codex/other' }, { state: 'MERGED' }, { state: 'CLOSED' }, { mergedAt: new Date().toISOString() }, { mergedAt: undefined }]) {
    const proof = f.capture('premerge', JSON.stringify({ ...f.metadata, ...changes }))
    await f.event('shipping_findings', { ...f.payload, premergeProof: { receipt: proof.receipt, receiptSha256: sha(await readFile(proof.receipt)) } }, false)
  }
  const bytes = await readFile(f.premerge.receipt)
  const raw = JSON.parse(bytes)
  for (const changes of [{ unchanged: false }, { result: 'captured' }, { exitCode: 1 }, { timedOut: true }, { aborted: true },
    { snapshot: { ...raw.snapshot, dirty: true } }, { snapshot: { ...raw.snapshot, hiddenIndexFlags: true } },
    { snapshot: { ...raw.snapshot, fingerprint: '0'.repeat(64) } }, { startedAt: f.state.createdAt, finishedAt: f.state.createdAt }]) {
    await writeFile(f.premerge.receipt, JSON.stringify({ ...raw, ...changes }))
    await f.event('shipping_findings', { ...f.payload, premergeProof: { ...f.payload.premergeProof, receiptSha256: sha(await readFile(f.premerge.receipt)) } }, false)
  }
  await writeFile(f.premerge.receipt, bytes)
  await f.event('shipping_findings', { ...f.payload, premergeProof: { ...f.payload.premergeProof, receiptSha256: '0'.repeat(64) } }, false)
  const stdout = f.premerge.receipt.replace('receipt.json', 'stdout.log'), logs = await readFile(stdout)
  await writeFile(stdout, 'altered')
  await f.event('shipping_findings', f.payload, false)
  await writeFile(stdout, logs)
  f.git('branch', '-m', 'codex/other'); await f.event('shipping_findings', f.payload, false); f.git('branch', '-m', 'codex/fixture')
  f.git('update-index', '--assume-unchanged', 'app.mjs'); await f.event('shipping_findings', f.payload, false); f.git('update-index', '--no-assume-unchanged', 'app.mjs')
  await writeFile(join(f.worktree, 'app.mjs'), 'changed\n'); await f.event('shipping_findings', f.payload, false); f.git('restore', 'app.mjs')
  const focused = await readFile(f.green.receipt)
  await writeFile(f.green.receipt, Buffer.concat([focused, Buffer.from('\n')]))
  await f.event('shipping_findings', f.payload, false); await writeFile(f.green.receipt, focused)
  const gate = await readFile(f.gate.receipt)
  await writeFile(f.gate.receipt, Buffer.concat([gate, Buffer.from('\n')]))
  await f.event('shipping_findings', f.payload, false); await writeFile(f.gate.receipt, gate)
  f.git('commit', '--allow-empty', '-m', 'unexpected head'); await f.event('shipping_findings', f.payload, false)
})

test('all independent slots, complete union and preserved unaffected approvals are mandatory before one bounded authorization', async () => {
  const f = await fixture()
  const authorization = { reference: 'human-decision-902', reason: 'Correct this confirmed PR blocker', additionalCycles: 1 }
  const current = { ...f.state, reworkCycles: 1 }
  await writeDeliveryState(f.repo, current)
  for (const changes of [{ receipts: f.payload.receipts.slice(0, 1) }, { receipts: [f.payload.receipts[0], f.payload.receipts[0]] },
    { receipts: [{ ...f.payload.receipts[0], reviewed_head: f.base }, f.payload.receipts[1]] },
    { receipts: [{ ...f.payload.receipts[0], reviewed_base: f.head }, f.payload.receipts[1]] },
    { receipts: [f.payload.receipts[0], { ...f.payload.receipts[1], extra: 'changed' }] }, { findings: [] },
    { findings: [finding, finding] }, { findings: [{ ...finding, requirement: 'different' }] },
    { receipts: [f.payload.receipts[0], { ...f.payload.receipts[1], status: 'findings', findings: [{ ...finding, requirement: 'second blocker' }] }] },
    { reworkAuthorization: { ...authorization, additionalCycles: 2 } }, { reworkAuthorization: { ...authorization, reference: '' } },
    { premergeProof: undefined }]) {
    await f.event('shipping_findings', { ...f.payload, reworkAuthorization: authorization, ...changes }, false)
  }
  const next = await f.event('shipping_findings', { ...f.payload, reworkAuthorization: authorization })
  assert.equal(next.state, 'REWORKING'); assert.equal(next.reworkCycles, 1); assert.equal(next.policy.maxReworkCycles, 1)
  const trace = next.reworkAuthorizations[0]
  assert.deepEqual(trace, { ...authorization, event: 'shipping_findings', at: trace.at, base: f.base, head: f.head, reworkCycles: 1, previousLimit: 1, newLimit: 2 })
  await writeDeliveryState(f.repo, f.state)
  await f.event('shipping_findings', { ...f.payload, reworkAuthorization: authorization }, false)
  await writeDeliveryState(f.repo, { ...f.state, reworkCycles: 2 })
  await f.event('shipping_findings', { ...f.payload, reworkAuthorization: authorization }, false)
  await writeDeliveryState(f.repo, current)
  assert.equal((await f.event('shipping_findings', f.payload)).state, 'NEEDS_HUMAN')
})

for (const reuse of [false, true]) test(`correction requires new approvals/full gate and archives historical ${reuse ? 'reviewed-focused' : 'full'} PASS after cleanup`, async () => {
  const f = await fixture('standard', reuse)
  await f.event('shipping_findings', f.payload)
  await f.event('rework_complete', { commit: f.head, validation: f.focused }, false)
  await writeFile(join(f.worktree, 'app.mjs'), 'export const accepts = value => value !== ""\n')
  f.git('commit', '-am', 'bounded correction')
  const head = f.git('rev-parse', 'HEAD')
  await f.event('rework_complete', { commit: head, validation: { ...f.focused, head } }, false)
  const green = f.capture('focused', 'new focused pass', head)
  const reviewing = await f.event('rework_complete', { commit: head, validation: { head, focused: 'passed', checks: [{ command: green.command, exitCode: 0, receipt: green.receipt }] } })
  assert.deepEqual(reviewing.reviewReceipts, []); assert.equal(reviewing.reworkCycles, 1)
  assert.equal(reviewing.shippingFindings[0].validation.result, 'passed')
  await f.event('reviews_approved', { receipts: f.receipts() }, false)
  const earlyGate = f.capture('gate', 'gate before fresh reviews', head)
  await f.event('reviews_approved', { receipts: f.receipts(head) })
  await f.event('review_approved', { useReviewedFocused: true }, false)
  await f.event('review_approved', { validation: f.state.validation }, false)
  const gate = f.capture('gate', 'new full pass', head)
  const validation = { kind: 'required_gate', result: 'passed', base: f.base, head, profile: 'full', reason: 'Full gate after premerge correction',
    receipt: gate.receipt, checks: [{ command: gate.command, exitCode: 0, receipt: gate.receipt }] }
  await f.event('review_approved', { validation: { ...validation, receipt: earlyGate.receipt,
    checks: [{ command: earlyGate.command, exitCode: 0, receipt: earlyGate.receipt }] } }, false)
  await f.event('review_approved', { validation: { ...validation, profile: 'reduced' } }, false)
  await f.event('review_approved', { validation })
  const shipping = await f.event('start_shipping')
  const archive = join(f.repo, '.delivery/archives', f.card, 'evidence')
  await cp(join(f.worktree, '.delivery/evidence', f.card), archive, { recursive: true })
  const archived = join(archive, f.premerge.directory.split('/').at(-1), 'stdout.log'), bytes = await readFile(archived)
  await writeFile(archived, 'altered')
  const completion = { pr: f.pr, mergeCommit: head, evidenceArchive: archive }
  await f.event('shipped', completion, false)
  await writeFile(archived, bytes)
  const archivedFocused = join(archive, f.green.directory.split('/').at(-1), 'receipt.json'), focusedBytes = await readFile(archivedFocused)
  await writeFile(archivedFocused, Buffer.concat([focusedBytes, Buffer.from('\n')]))
  await f.event('shipped', completion, false)
  await writeFile(archivedFocused, focusedBytes)
  if (!reuse) {
    const archivedGate = join(archive, f.gate.directory.split('/').at(-1), 'receipt.json'), gateBytes = await readFile(archivedGate)
    await writeFile(archivedGate, Buffer.concat([gateBytes, Buffer.from('\n')]))
    await f.event('shipped', completion, false)
    await writeFile(archivedGate, gateBytes)
  }
  f.gitAt(f.repo, 'worktree', 'remove', f.worktree)
  const done = await f.event('shipped', completion)
  assert.equal(done.state, 'DONE'); assert.deepEqual(done.shippingFindings, shipping.shippingFindings)
})


test('configured validation hook is reverified without replacing saved gate evidence or accepting changed binding hashes', async () => {
  const f = await fixture('critical', false, true)
  const binding = join(f.worktree, f.state.validation.binding), bytes = await readFile(binding)
  await writeFile(binding, Buffer.concat([bytes, Buffer.from('\n')]))
  assert.match(await f.event('shipping_findings', f.payload, false), /validation evidence changed/)
  await writeFile(binding, bytes)
  const receipt = join(f.worktree, f.state.validation.receipt), raw = await readFile(receipt)
  await writeFile(receipt, 'changed')
  assert.match(await f.event('shipping_findings', f.payload, false), /PROJECT_VALIDATION_CHECK_FAILED/)
  await writeFile(receipt, raw)
  const next = await f.event('shipping_findings', f.payload)
  assert.deepEqual(next.validation, f.state.focusedValidation)
  assert.deepEqual(next.shippingFindings[0].validation, f.state.validation)
})


test('PR association follows configured remote and base, with compact sanitized checkpoint provenance', async () => {
  const f = await fixture('standard')
  f.git('remote', 'rename', 'origin', 'upstream')
  await writeFile(join(f.repo, 'agent-workflow.config.json'), JSON.stringify({ git: { remote: 'upstream', baseBranch: 'release' } }))
  assert.match(await f.event('shipping_findings', f.payload, false), /configured base branch/)
  await writeFile(join(f.repo, 'agent-workflow.config.json'), JSON.stringify({ git: { remote: 'upstream', baseBranch: 'main' } }))
  f.git('remote', 'set-url', 'upstream', 'https://example.test/fixtures/workflow.git')
  const next = await f.event('shipping_findings', { ...f.payload, premergeProof: { ...f.payload.premergeProof, privateDetails: 'do-not-publish' } })
  assert.doesNotMatch(deliveryCheckpoint(next), /do-not-publish|code_and_focused_checks|Reject empty input/)
  assert.deepEqual(next.shippingFindings[0].premergeProof, f.payload.premergeProof)
})
