#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = await mkdtemp(join(tmpdir(), 'agentic-workflow-smoke-'))
execFileSync('git', ['init', '-q', repo])
await writeFile(join(repo, 'README.md'), 'user file\n')
await writeFile(join(repo, 'agent-workflow.config.json'), '{\n  "tracker": { "provider": "linear", "team": "Smoke Team" }\n}\n')

function run(command, expected = 0) {
  const result = spawnSync(process.execPath, [join(root, 'scripts/agent-workflow.mjs'), command, repo], { encoding: 'utf8' })
  if (result.status !== expected) throw new Error(`${result.stdout}\n${result.stderr}`)
}

run('install')
run('install')
run('update')
if (await readFile(join(repo, 'README.md'), 'utf8') !== 'user file\n') throw new Error('user file changed')
if (!await readFile(join(repo, '.agents/skills/harden-card/SKILL.md'), 'utf8')) throw new Error('skill missing')
if (!await readFile(join(repo, '.codex/agents/reviewer.toml'), 'utf8')) throw new Error('agent missing')
if (!await readFile(join(repo, '.claude/commands/rework.md'), 'utf8')) throw new Error('Claude command missing')
if (!await readFile(join(repo, '.agent-workflow/manifest.json'), 'utf8')) throw new Error('manifest missing')

const preview = JSON.parse(execFileSync(process.execPath, [
  join(repo, '.agent-workflow/bin/run-card.mjs'), 'PROJ-123', '--dry-run',
], { cwd: repo, encoding: 'utf8' }))
if (preview.result !== null || !preview.command.args.at(-1).includes('/start-card skill for PROJ-123')) {
  throw new Error('direct card entry point missing from dry run')
}

process.stdout.write(`Smoke test passed in ${repo}\n`)
