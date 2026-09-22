import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function makeRepo(prefix) {
  const repo = await mkdtemp(join(tmpdir(), prefix))
  execFileSync('git', ['init', '-q', repo])
  await writeFile(join(repo, 'AGENTS.md'), '# User-owned instructions\n')
  await writeFile(join(repo, '.gitignore'), 'user-cache/\n')
  return repo
}

function run(source, command, target, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [join(source, 'scripts/agent-workflow.mjs'), command, target], { encoding: 'utf8' })
  assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`)
  return result
}

test('install is complete, idempotent, and preserves user-owned files', async () => {
  const repo = await makeRepo('agent-workflow-install-')
  run(SOURCE, 'install', repo)

  assert.equal(await readFile(join(repo, 'AGENTS.md'), 'utf8'), '# User-owned instructions\n')
  assert.match(await readFile(join(repo, '.gitignore'), 'utf8'), /user-cache\//)
  assert.match(await readFile(join(repo, '.gitignore'), 'utf8'), /\.agent-workflow\.local\.json/)
  for (const path of [
    '.agents/skills/harden-card/SKILL.md',
    '.agents/skills/rework/SKILL.md',
    '.codex/agents/implementer.toml',
    '.claude/commands/harden-card.md',
    '.agent-workflow/bin/delivery-state.mjs',
    '.agent-workflow/contracts/delivery.md',
    '.agent-workflow/manifest.json',
    'agent-workflow.config.json',
  ]) {
    assert.ok((await readFile(join(repo, path))).length > 0, `${path} should exist`)
  }

  const config = '{\n  "tracker": { "provider": "linear", "team": "My Team" }\n}\n'
  await writeFile(join(repo, 'agent-workflow.config.json'), config)
  const second = run(SOURCE, 'install', repo)
  assert.match(second.stdout, /conflicts 0/)
  assert.equal(await readFile(join(repo, 'agent-workflow.config.json'), 'utf8'), config)
})

test('update changes pristine managed files and preserves project configuration', async () => {
  const repo = await makeRepo('agent-workflow-update-')
  run(SOURCE, 'install', repo)
  const configPath = join(repo, 'agent-workflow.config.json')
  const config = '{\n  "tracker": { "provider": "linear", "team": "Configured Team" }\n}\n'
  await writeFile(configPath, config)

  const source2 = await mkdtemp(join(tmpdir(), 'agent-workflow-source-'))
  await cp(SOURCE, source2, { recursive: true, filter: (path) => !path.includes(`${join(SOURCE, '.git')}`) })
  await writeFile(join(source2, 'VERSION'), '0.2.0\n')
  const managedSource = join(source2, 'workflow/skills/rework/SKILL.md')
  await writeFile(managedSource, `${await readFile(managedSource, 'utf8')}\n<!-- update-proof -->\n`)

  const result = run(source2, 'update', repo)
  assert.match(result.stdout, /updated [1-9]/)
  assert.match(await readFile(join(repo, '.agents/skills/rework/SKILL.md'), 'utf8'), /update-proof/)
  assert.equal(await readFile(configPath, 'utf8'), config)
  assert.equal((await readFile(join(repo, '.agent-workflow/VERSION'), 'utf8')).trim(), '0.2.0')
})

test('update reports a conflict and never overwrites a modified managed file', async () => {
  const repo = await makeRepo('agent-workflow-conflict-')
  run(SOURCE, 'install', repo)
  const managed = join(repo, '.agents/skills/rework/SKILL.md')
  await writeFile(managed, '# user modification\n')
  const result = run(SOURCE, 'update', repo, 2)
  assert.match(result.stdout, /CONFLICT \.agents\/skills\/rework\/SKILL\.md/)
  assert.equal(await readFile(managed, 'utf8'), '# user modification\n')
  const manifest = JSON.parse(await readFile(join(repo, '.agent-workflow/manifest.json'), 'utf8'))
  const conflict = manifest.conflicts.find((item) => item.path === '.agents/skills/rework/SKILL.md')
  assert.ok(conflict?.incoming)
  assert.ok((await readFile(join(repo, conflict.incoming))).length > 0)
})

test('installed runtime is independent from the source checkout', async () => {
  const repo = await makeRepo('agent-workflow-independent-')
  run(SOURCE, 'install', repo)
  const output = execFileSync(process.execPath, [
    join(repo, '.agent-workflow/bin/agent-workflow.mjs'), 'route', 'standard', '--repo', repo,
  ], { encoding: 'utf8' })
  assert.equal(JSON.parse(output).implementation.model, 'gpt-6-sol')

  const manifest = JSON.parse(await readFile(join(repo, '.agent-workflow/manifest.json'), 'utf8'))
  for (const path of Object.keys(manifest.files)) {
    const text = await readFile(join(repo, path), 'utf8')
    assert.doesNotMatch(text, /ScrybeCast|Scrybecast|MickBourgois|\/Users\/|SCR-/i, path)
    assert.doesNotMatch(text, new RegExp(SOURCE.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')), path)
  }
})
