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
    receipts: [receipt('head', 'A', 'findings'), receipt('head', 'B')], findings: [{ id: 'FIX' }],
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
