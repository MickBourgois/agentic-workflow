import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeliveryState, transitionDeliveryState, writeDeliveryState } from '../workflow/orchestrator/delivery-state.mjs'

const cli = resolve('workflow/orchestrator/delivery-evidence.mjs')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-evidence-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
  await writeFile(join(root, '.gitignore'), '.delivery/\n')
  git('add', '.gitignore'); git('commit', '-m', 'base')
  const head = git('rev-parse', 'HEAD')
  const run = (action, args = [], expected = 0) => {
    const result = spawnSync(process.execPath, [cli, action, '--repo', root, '--card', 'PROJ-802',
      '--base', head, '--head', head, ...args], { encoding: 'utf8' })
    assert.equal(result.status, expected, result.stderr)
    return result.stdout ? JSON.parse(result.stdout) : null
  }
  return { root, head, git, run }
}

test('execution preserves successful and red raw output with actual Git identity', async () => {
  const f = await fixture()
  const green = f.run('run', ['--kind', 'focused', '--', process.execPath, '-e', 'console.log("green");console.error("diagnostic")'])
  const raw = JSON.parse(await readFile(green.receipt, 'utf8'))
  assert.equal(raw.head, f.head)
  assert.equal(raw.snapshot.dirty, false)
  assert.equal(await readFile(join(green.directory, 'stdout.log'), 'utf8'), 'green\n')
  assert.equal(await readFile(join(green.directory, 'stderr.log'), 'utf8'), 'diagnostic\n')
  f.run('verify', ['--receipt', green.receipt, '--kind', 'focused'])
  const red = f.run('run', ['--kind', 'regression', '--', process.execPath, '-e', 'console.error("expected failure");process.exit(1)'], 1)
  assert.equal(JSON.parse(await readFile(red.receipt, 'utf8')).exitCode, 1)
  assert.equal(await readFile(join(red.directory, 'stderr.log'), 'utf8'), 'expected failure\n')
})

test('dirty or mutated sources, wrong pair and tampered raw output cannot validate a head', async () => {
  const f = await fixture()
  const capture = f.run('run', ['--kind', 'focused', '--', process.execPath, '-e', 'console.log("ok")'])
  const wrong = spawnSync(process.execPath, [cli, 'verify', '--repo', f.root, '--card', 'PROJ-802',
    '--base', f.head, '--head', 'old', '--kind', 'focused', '--receipt', capture.receipt], { encoding: 'utf8' })
  assert.notEqual(wrong.status, 0)
  await writeFile(join(capture.directory, 'stdout.log'), 'tampered')
  assert.notEqual(spawnSync(process.execPath, [cli, 'verify', '--repo', f.root, '--card', 'PROJ-802',
    '--base', f.head, '--head', f.head, '--kind', 'focused', '--receipt', capture.receipt]).status, 0)
  await writeFile(join(f.root, 'untracked.txt'), 'before commit')
  const dirty = f.run('run', ['--kind', 'focused', '--', process.execPath, '-e', 'console.log("ok")'])
  const proof = JSON.parse(await readFile(dirty.receipt, 'utf8'))
  assert.equal(proof.snapshot.dirty, true)
  f.run('verify', ['--receipt', dirty.receipt, '--kind', 'focused'], 1)
  f.run('run', ['--kind', 'focused', '--', process.execPath, '-e', 'require("node:fs").writeFileSync("untracked.txt","changed")'], 1)
})

test('browser/comparison artifacts survive archival and missing files are never a pass', async () => {
  const f = await fixture()
  const artifact = join(f.root, '.delivery', 'fixture.html')
  await execFileSync(process.execPath, ['-e', 'require("node:fs").mkdirSync(".delivery",{recursive:true})'], { cwd: f.root })
  await writeFile(artifact, '<main>fixture</main>')
  const capture = f.run('collect', ['--kind', 'browser', '--', artifact])
  const archive = await mkdtemp(join(tmpdir(), 'workflow-archive-'))
  await cp(capture.directory, archive, { recursive: true })
  const proof = f.run('verify', ['--receipt', join(archive, 'receipt.json'), '--kind', 'browser'])
  assert.equal(proof.result, 'captured')
  assert.equal(await readFile(join(archive, 'artifacts', '0-fixture.html'), 'utf8'), '<main>fixture</main>')
  f.run('collect', ['--kind', 'browser', '--', join(f.root, 'missing.html')], 1)
})

test('new deliveries require raw exact-head receipts through review, approval and archived DONE', async () => {
  const f = await fixture()
  let state = createDeliveryState({ card: 'PROJ-802', complexity: 'simple', baseSha: f.head, worktree: f.root })
  state.policy.evidenceRequired = true
  state = transitionDeliveryState(state, 'start_implementation')
  await writeDeliveryState(f.root, state)
  const stateCli = resolve('workflow/orchestrator/delivery-state.mjs')
  const event = async (name, payload, expected = 0) => {
    const before = await readFile(join(f.root, '.delivery/state/PROJ-802.json'), 'utf8')
    await writeFile(join(f.root, '.delivery/payload.json'), JSON.stringify(payload))
    const result = spawnSync(process.execPath, [stateCli, 'event', '--repo', f.root, '--card', 'PROJ-802',
      '--event', name, '--payload-file', '.delivery/payload.json'], { encoding: 'utf8' })
    assert.equal(result.status, expected, result.stderr)
    if (expected) assert.equal(await readFile(join(f.root, '.delivery/state/PROJ-802.json'), 'utf8'), before)
    return expected ? null : JSON.parse(result.stdout)
  }
  const focused = { head: f.head, focused: 'passed', checks: [{ command: 'tests passed in prose', exitCode: 0 }] }
  await event('implementation_complete', { commit: f.head, validation: focused }, 1)
  const capture = f.run('run', ['--kind', 'focused', '--', process.execPath, '-e', 'console.log("focused")'])
  const screenshot = join(f.root, '.delivery/screenshot.html')
  await writeFile(screenshot, '<main>browser fixture</main>')
  const browser = f.run('collect', ['--kind', 'browser', '--', screenshot])
  focused.checks = [{ command: capture.command, exitCode: 0, receipt: capture.receipt }]
  focused.artifacts = [{ receipt: browser.receipt }]
  await event('implementation_complete', { commit: f.head, validation: focused })
  await event('reviews_approved', { receipts: [{ reviewed_head: f.head, reviewer_slot: 'single', status: 'approved', scope: 'code_and_focused_checks' }] })
  const gateCapture = f.run('run', ['--kind', 'gate', '--', process.execPath, '-e', 'console.log("full gate")'])
  const validation = { kind: 'required_gate', result: 'passed', head: f.head, base: f.head,
    profile: 'full', reason: 'fixture full gate', receipt: gateCapture.receipt,
    checks: [{ command: gateCapture.command, exitCode: 0, receipt: gateCapture.receipt }] }
  await event('review_approved', { validation: { ...validation, checks: focused.checks } }, 1)
  await event('review_approved', { validation })
  await event('start_shipping', {})
  const shipping = { mergeCommit: f.head, pr: 'https://example.test/pr/1' }
  await event('shipped', shipping, 1)
  const unsafeArchive = join(f.root, '.delivery/archive')
  await cp(join(f.root, '.delivery/evidence/PROJ-802'), unsafeArchive, { recursive: true })
  await event('shipped', { ...shipping, evidenceArchive: unsafeArchive }, 1)
  const archive = await mkdtemp(join(tmpdir(), 'workflow-done-archive-'))
  await cp(join(f.root, '.delivery/evidence/PROJ-802'), archive, { recursive: true })
  await writeFile(join(archive, browser.directory.split('/').at(-1), 'artifacts/0-screenshot.html'), 'altered artifact')
  await event('shipped', { ...shipping, evidenceArchive: archive }, 1)
  await cp(join(f.root, '.delivery/evidence/PROJ-802'), archive, { recursive: true })
  await writeFile(join(archive, gateCapture.directory.split('/').at(-1), 'stdout.log'), 'tampered')
  await event('shipped', { ...shipping, evidenceArchive: archive }, 1)
  await cp(join(f.root, '.delivery/evidence/PROJ-802'), archive, { recursive: true })
  const stored = JSON.parse(await readFile(join(f.root, '.delivery/state/PROJ-802.json'), 'utf8'))
  stored.worktree = join(f.root, 'removed-worktree')
  await writeDeliveryState(f.root, stored)
  assert.equal((await event('shipped', { ...shipping, evidenceArchive: archive })).state, 'DONE')
})
