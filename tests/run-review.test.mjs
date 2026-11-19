import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { writeDeliveryState } from '../workflow/orchestrator/delivery-state.mjs'
import { reviewFixture } from './fixtures/review-fixture.mjs'

test('CLI reviewer uses the exact routed model, direct read-only fresh exec and never advances state', async () => {
  const f = await reviewFixture(); await f.fake()
  const result = await f.run()
  const { args } = JSON.parse(await readFile(join(result.runDir, 'observed.json'), 'utf8'))
  assert.deepEqual(args.slice(0, 2), ['--no-daemon', 'exec']); assert.ok(!args.includes('resume'))
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-sol')
  assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort="high"')
  assert.equal(args[args.indexOf('--disable') + 1], 'multi_agent')
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only')
  assert.equal(args.at(-1), '-')
  assert.deepEqual(JSON.parse(await readFile(result.receipt, 'utf8')), f.candidate)
  assert.equal(await readFile(f.stateFile, 'utf8'), f.originalState)
})

test('unavailable model, empty wait, missing output, timeout and mismatched receipts cannot yield accepted review', async () => {
  const f = await reviewFixture()
  for (const scenario of [{ exit: 1 }, { inspection: false }, { receipt: null }, { receipt: { wait: true } },
    { receipt: { ...f.candidate, findings: undefined } },
    ...['card', 'reviewed_base', 'reviewed_head', 'reviewer_slot'].map((key) => ({ receipt: { ...f.candidate, [key]: 'wrong' } })),
    { receipt: { ...f.candidate, inspected_files: [] } },
    { receipt: { ...f.candidate, status: 'findings', findings: [] } }, { stall: true }]) {
    await f.fake(scenario)
    await assert.rejects(f.run({ timeoutMs: scenario.stall ? 200 : 5_000 }))
    assert.equal(await readFile(f.stateFile, 'utf8'), f.originalState)
  }
  for (const directory of await readdir(join(f.repo, '.delivery/reviews', f.card))) {
    await assert.rejects(access(join(f.repo, '.delivery/reviews', f.card, directory, 'receipt.json')))
  }
})

test('invalid slot and missing focused evidence block dispatch; mutation during review rejects result', async () => {
  const f = await reviewFixture(); await f.fake()
  await assert.rejects(f.run({ slot: 'single' }), /slot/)
  const changed = structuredClone(f.state); changed.validation.checks = []
  await writeDeliveryState(f.repo, changed)
  await assert.rejects(f.run(), /recorded focused/)
  await writeFile(f.stateFile, f.originalState)
  await f.fake({ dirty: true })
  await assert.rejects(f.run(), /dirty validation worktree/)
  assert.equal(await readFile(f.stateFile, 'utf8'), f.originalState)
})

test('a direct standard rework gives the fresh CLI reviewer only that slot’s validated prior finding', async () => {
  const f = await reviewFixture({ complexity: 'standard', rework: true })
  const prior = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: f.worktree, encoding: 'utf8' }).trim()
  const finding = {
    id: 'EXPECTED-BEHAVIOR', file: 'app.mjs', line: 1, requirement: 'Return two', priority: 'P2',
    evidence: 'Returns three on import', required_change: 'Return two',
  }
  const previousReceipt = { ...f.candidate, reviewed_head: prior, status: 'findings', findings: [finding] }
  f.state.previousReview = { base: f.base, head: prior, receipts: [
    { ...previousReceipt, reviewer_slot: 'A', findings: [{ ...finding, id: 'PRIVATE-OTHER-SLOT' }] },
    previousReceipt,
  ] }
  await writeDeliveryState(f.repo, f.state)
  await f.fake()
  const getPrompt = async () => {
    const result = await f.run()
    return JSON.parse(await readFile(join(result.runDir, 'observed.json'), 'utf8')).prompt
  }
  const incremental = await getPrompt()
  assert.match(incremental, /EXPECTED-BEHAVIOR/)
  assert.doesNotMatch(incremental, /PRIVATE-OTHER-SLOT/)
  f.state.previousReview.head = f.base
  await writeDeliveryState(f.repo, f.state)
  const full = await getPrompt()
  assert.match(full, /complete diff review of the card/)
  assert.doesNotMatch(full, /EXPECTED-BEHAVIOR|PRIVATE-OTHER-SLOT/)
})
