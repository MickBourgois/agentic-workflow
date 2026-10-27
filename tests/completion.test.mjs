import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryState, transitionDeliveryState, writeDeliveryState, checkProjectCompletion, deliverySummary } from '../workflow/orchestrator/delivery-state.mjs'

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
