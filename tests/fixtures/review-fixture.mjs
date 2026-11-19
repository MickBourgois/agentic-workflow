import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeliveryState, transitionDeliveryState, writeDeliveryState } from '../../workflow/orchestrator/delivery-state.mjs'
import { runReview } from '../../workflow/orchestrator/run-review.mjs'

export async function reviewFixture({ install = false, complexity = 'critical', rework = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workflow-review-')), repo = join(root, 'repo'), worktree = join(root, 'worktree')
  await mkdir(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
  await writeFile(join(repo, '.gitignore'), '.delivery/\n')
  await writeFile(join(repo, 'app.mjs'), 'export const value = 1\n')
  if (install) {
    execFileSync(process.execPath, [resolve('scripts/agent-workflow.mjs'), 'install', repo], { stdio: 'pipe' })
    await writeFile(join(repo, 'AGENTS.md'), '# Synthetic review fixture\nFor PROJ-801, read CARD.md as the complete card and comments. It has no Linear record. No provider/network requests are authorized except the Codex inference executing this review. Use local Git and validation proof only.\n')
    await writeFile(join(repo, 'CARD.md'), '# PROJ-801\nChange the exported value in app.mjs from 1 to 2. Acceptance: it imports and value equals 2. No other application changes. No blockers or comments. This is a synthetic critical-route review test.\n')
  }
  git('add', '.'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD'), card = 'PROJ-801', branch = 'fix/proj-801'
  git('worktree', 'add', '-b', branch, worktree, base)
  if (rework) {
    await writeFile(join(worktree, 'app.mjs'), 'export const value = 3\n')
    execFileSync('git', ['commit', '-am', 'PROJ-801 initial change'], { cwd: worktree, stdio: 'pipe' })
  }
  await writeFile(join(worktree, 'app.mjs'), 'export const value = 2\n')
  execFileSync('git', ['add', 'app.mjs'], { cwd: worktree })
  execFileSync('git', ['commit', '-m', 'PROJ-801 change'], { cwd: worktree, stdio: 'pipe' })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim()
  const proof = spawnSync(process.execPath, [resolve('workflow/orchestrator/delivery-evidence.mjs'), 'run',
    '--repo', worktree, '--card', card, '--base', base, '--head', head, '--kind', 'focused', '--', process.execPath, '--input-type=module', '-e', "import {value} from './app.mjs'; if (value !== 2) process.exit(1)"], { encoding: 'utf8' })
  assert.equal(proof.status, 0, proof.stderr)
  const captured = JSON.parse(proof.stdout)
  let state = createDeliveryState({ card, complexity, baseSha: base, branch, worktree })
  state.policy.evidenceRequired = true
  state = transitionDeliveryState(state, 'start_implementation')
  state = transitionDeliveryState(state, 'implementation_complete', { commit: head, validation: {
    head, focused: 'passed', checks: [{ command: captured.command, exitCode: 0, receipt: captured.receipt }],
  } })
  await writeDeliveryState(repo, state)
  const stateFile = join(repo, '.delivery/state', `${card}.json`)
  const originalState = await readFile(stateFile, 'utf8')
  const slot = complexity === 'critical' ? 'B' : 'single'
  const candidate = { card, reviewed_base: base, reviewed_head: head, reviewer_slot: slot,
    scope: 'code_and_focused_checks', status: 'approved', inspected_files: ['app.mjs'], findings: [], suggestions: [] }
  const cli = join(root, 'fake-codex.mjs')
  const fake = async ({ receipt = candidate, exit = 0, inspection = true, stall = false, dirty = false } = {}) => {
    await writeFile(cli, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2), file = args[args.indexOf('--output-last-message') + 1];
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  writeFileSync(file.replace('result.json', 'observed.json'), JSON.stringify({args, prompt}));
  ${inspection ? `console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',exit_code:0}}));` : ''}
  ${receipt === null ? '' : `writeFileSync(file, ${JSON.stringify(JSON.stringify(receipt))});`}
  ${dirty ? `writeFileSync('app.mjs', 'changed during review');` : ''}
  ${stall ? 'setInterval(() => {}, 1000);' : `process.exit(${exit});`}
});
`, { mode: 0o700 })
  }
  const run = (extra = {}) => runReview({ repoRoot: repo, card, slot, codexBin: cli, timeoutMs: 5_000, ...extra })
  return { root, repo, worktree, card, base, head, state, stateFile, originalState, candidate, cli, fake, run }
}
