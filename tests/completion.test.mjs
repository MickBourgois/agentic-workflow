import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryState, transitionDeliveryState, writeDeliveryState, checkProjectCompletion, checkProjectValidation, deliverySummary } from '../workflow/orchestrator/delivery-state.mjs'

function shipping() {
  let state = createDeliveryState({ card: 'PROJ-301', complexity: 'standard', baseSha: 'base', completionCheck: 'completion.mjs' })
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'implementation_complete', { commit: 'head' })
  state = transitionDeliveryState(state, 'review_approved', { receipts: [{ reviewed_head: 'head', status: 'approved', reviewer_slot: 'single' }] })
  return transitionDeliveryState(state, 'start_shipping')
}
test('a configured project completion check is mandatory and bound to head/base/merge', () => {
  const state = shipping(), payload = { mergeCommit: 'merge', pr: 'fixture' }
  assert.throws(() => transitionDeliveryState(state, 'shipped', payload), /completion proof/)
  for (const field of ['head', 'base', 'mergeCommit']) {
    const completion = { result: 'passed', head: 'head', base: 'base', mergeCommit: 'merge', [field]: 'other' }
    assert.throws(() => transitionDeliveryState(state, 'shipped', { ...payload, completion }), /completion proof/)
  }
})
test('DONE and the generated checkpoint share the reconciled runtime', async () => {
  const completion = { result: 'passed', head: 'head', base: 'base', mergeCommit: 'merge',
    runtime: { restoreRequired: false, vmState: 'Stopped', actualMemoryGiB: 6 }, deployment: { readyState: 'READY' } }
  const state = shipping()
  state.validation = { focused: 'passed', full_check: 'passed', binding: 'fixture-binding.json' }
  state.escalationCount = 1
  state.runtime = { restoreRequired: true, vmState: 'Running', actualMemoryGiB: 4 }
  const next = transitionDeliveryState(state, 'shipped', { mergeCommit: 'merge', pr: 'fixture', completion })
  const directory = await mkdtemp(join(tmpdir(), 'workflow-completion-'))
  await writeDeliveryState(directory, next)
  const stored = JSON.parse(await readFile(join(directory, '.delivery/state/PROJ-301.json'), 'utf8'))
  const markdown = await readFile(join(directory, '.delivery/checkpoints/PROJ-301.md'), 'utf8')
  const checkpoint = JSON.parse(markdown.split('json\n')[1].split('\n' + String.fromCharCode(96).repeat(3))[0])
  assert.equal(stored.state, 'DONE')
  assert.deepEqual(stored.runtime, completion.runtime)
  assert.deepEqual(checkpoint.runtime, stored.runtime)
  assert.equal(checkpoint.state, stored.state)
  assert.deepEqual(checkpoint.reviewReceipts, stored.reviewReceipts)
  assert.deepEqual(checkpoint.validation, stored.validation)
  assert.equal(checkpoint.escalationCount, stored.escalationCount)
})
test('the project checker uses stdin and fails closed without returning stderr', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-checker-'))
  await writeFile(join(directory, 'completion.mjs'), "console.error('fixture-private-do-not-log');process.exit(1)")
  assert.throws(() => checkProjectCompletion(directory, shipping(), {}, { commands: { completionCheck: 'completion.mjs' } }),
    error => error.message === 'PROJECT_COMPLETION_CHECK_FAILED')
})
test('routine summaries omit full history, diffs, and private runtime fields', () => {
  const state = shipping()
  state.history.push({ private: 'fixture-do-not-emit' })
  state.runtime = { restoreRequired: false, vmState: 'Stopped', secret: 'fixture-do-not-emit' }
  state.pr = { number: 1, url: 'https://example.test/1', body: 'fixture-do-not-emit' }
  const summary = deliverySummary(state)
  assert.equal(summary.currentHead, 'head')
  assert.equal(summary.runtime.vmState, 'Stopped')
  assert.equal(JSON.stringify(summary).includes('fixture-do-not-emit'), false)
})

test('approval verifier fails closed on dirty verifier, stale head or tampered evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-validation-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
  await writeFile(join(directory, '.gitignore'), 'proof/\n')
  const script = `const args=process.argv;console.log(JSON.stringify({result:'passed',card:args[args.indexOf('--card')+1],head:args[args.indexOf('--head')+1],binding:'proof/binding.json'}))`
  await writeFile(join(directory, 'verify.mjs'), script)
  git('add', '.gitignore', 'verify.mjs'); git('commit', '-m', 'fixture')
  const head = git('rev-parse', 'HEAD')
  const state = { card: 'PROJ-301', baseSha: head, currentHead: head, worktree: directory }
  const config = { commands: { validationProof: 'verify.mjs' } }
  await mkdir(join(directory, 'proof'))
  const receipt = '{}', digest = createHash('sha256').update(receipt).digest('hex')
  const binding = { result: 'passed', card: state.card, base: head, head, receipt: 'proof/receipt.json', receiptSha256: digest }
  await writeFile(join(directory, 'proof/receipt.json'), receipt)
  await writeFile(join(directory, 'proof/binding.json'), JSON.stringify(binding))
  assert.equal(checkProjectValidation(state, config).receiptSha256, digest)
  await writeFile(join(directory, 'verify.mjs'), 'console.log("forged")')
  assert.throws(() => checkProjectValidation(state, config), /PROJECT_VALIDATION_CHECK_FAILED/)
  await writeFile(join(directory, 'verify.mjs'), script)
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    git('update-index', flag, 'verify.mjs')
    await writeFile(join(directory, 'verify.mjs'), 'console.log("forged")')
    assert.throws(() => checkProjectValidation(state, config), /PROJECT_VALIDATION_CHECK_FAILED/)
    await writeFile(join(directory, 'verify.mjs'), script)
    git('update-index', flag === '--skip-worktree' ? '--no-skip-worktree' : '--no-assume-unchanged', 'verify.mjs')
  }
  await writeFile(join(directory, 'proof/receipt.json'), 'tampered')
  assert.throws(() => checkProjectValidation(state, config), /PROJECT_VALIDATION_CHECK_FAILED/)
  await writeFile(join(directory, 'proof/receipt.json'), receipt)
  await writeFile(join(directory, 'proof/binding.json'), JSON.stringify({ ...binding, head: 'old' }))
  assert.throws(() => checkProjectValidation(state, config), /PROJECT_VALIDATION_CHECK_FAILED/)
})

test('legacy shipping state accepts only a verified exact-head validation refresh', () => {
  const state = shipping()
  assert.throws(() => transitionDeliveryState(state, 'validation_refreshed', { validation: { result: 'passed', head: 'old', base: 'base' } }), /verified validation/)
  const next = transitionDeliveryState(state, 'validation_refreshed', { validation: { result: 'passed', head: 'head', base: 'base' } })
  assert.equal(next.state, 'SHIPPING')
  assert.equal(next.validation.head, 'head')
})
