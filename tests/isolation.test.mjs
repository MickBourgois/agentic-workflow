import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, access, mkdir } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const cli = resolve('workflow/orchestrator/delivery-state.mjs')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-isolation-'))
  const repo = join(root, 'repo'), worktree = join(root, 'worktree')
  await mkdir(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
  await writeFile(join(repo, '.gitignore'), '.delivery/\n')
  git('add', '.gitignore'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD'), branch = 'fix/proj-801'
  const run = (...extra) => spawnSync(process.execPath, [cli, 'init', '--repo', repo, '--card', 'PROJ-801',
    '--complexity', 'simple', '--base', base, '--branch', branch, '--worktree', worktree, ...extra], { encoding: 'utf8' })
  const state = join(repo, '.delivery/state/PROJ-801.json'), checkpoint = join(repo, '.delivery/checkpoints/PROJ-801.md')
  return { root, repo, worktree, git, base, branch, run, state, checkpoint }
}

test('failed worktree preparation cannot initialize or publish a checkpoint', async () => {
  const f = await fixture()
  const result = f.run()
  assert.notEqual(result.status, 0)
  await assert.rejects(access(f.state), { code: 'ENOENT' })
  await assert.rejects(access(f.checkpoint), { code: 'ENOENT' })
})

test('initialization rejects wrong branch, dirty worktree, foreign repo and nested path', async () => {
  const f = await fixture()
  f.git('worktree', 'add', '-b', f.branch, f.worktree, f.base)
  await mkdir(join(f.worktree, '.delivery'))
  const foreign = join(f.root, 'foreign')
  f.git('clone', '--quiet', f.repo, foreign)
  execFileSync('git', ['checkout', '-qb', f.branch], { cwd: foreign })
  for (const extra of [['--branch', 'wrong'], ['--base', 'missing'], ['--worktree', f.repo],
    ['--worktree', foreign], ['--worktree', join(f.worktree, '.delivery')]]) {
    assert.notEqual(f.run(...extra).status, 0)
  }
  await writeFile(join(f.worktree, 'unrelated.txt'), 'preserve me')
  assert.notEqual(f.run().status, 0)
  await assert.rejects(access(f.state), { code: 'ENOENT' })
  assert.equal(await readFile(join(f.worktree, 'unrelated.txt'), 'utf8'), 'preserve me')
})

test('init is exclusive and start_implementation rechecks the prepared worktree', async () => {
  const f = await fixture()
  f.git('worktree', 'add', '-b', f.branch, f.worktree, f.base)
  assert.equal(f.run().status, 0)
  assert.equal(JSON.parse(await readFile(f.state, 'utf8')).policy.evidenceRequired, true)
  const original = await readFile(f.state, 'utf8')
  assert.notEqual(f.run().status, 0)
  assert.equal(await readFile(f.state, 'utf8'), original)
  f.git('worktree', 'move', f.worktree, join(f.root, 'moved'))
  const event = spawnSync(process.execPath, [cli, 'event', '--repo', f.repo, '--card', 'PROJ-801',
    '--event', 'start_implementation'], { encoding: 'utf8' })
  assert.notEqual(event.status, 0)
  assert.equal(await readFile(f.state, 'utf8'), original)
})

test('an orphaned checkpoint is preserved for reconciliation instead of overwritten', async () => {
  const f = await fixture()
  f.git('worktree', 'add', '-b', f.branch, f.worktree, f.base)
  await mkdir(join(f.repo, '.delivery/checkpoints'), { recursive: true })
  await writeFile(f.checkpoint, 'historical terminal checkpoint')
  assert.notEqual(f.run().status, 0)
  await assert.rejects(access(f.state), { code: 'ENOENT' })
  assert.equal(await readFile(f.checkpoint, 'utf8'), 'historical terminal checkpoint')
})
