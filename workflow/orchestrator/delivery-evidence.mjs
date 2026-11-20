#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, copyFileSync, constants, chmodSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCard, loadConfig } from './config.mjs'
import { runOwnedProcess } from './owned-process.mjs'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()

export function evidenceSnapshot(root) {
  const hash = createHash('sha256')
  const paths = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()
  for (const path of paths) {
    hash.update(path + '\0')
    const file = resolve(root, path)
    try {
      const stat = lstatSync(file)
      hash.update(String(stat.mode) + '\0')
      assert(stat.isSymbolicLink() || stat.isFile(), 'directory entries require project-specific evidence capture')
      hash.update(stat.isSymbolicLink() ? readlinkSync(file) : readFileSync(file))
    } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('deleted') }
    hash.update('\0')
  }
  hash.update(git(root, 'diff', '--cached', '--binary', 'HEAD'))
  return { head: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git(root, 'status', '--porcelain=v1', '--untracked-files=all') !== '',
    hiddenIndexFlags: git(root, 'ls-files', '-v', '-z').split('\0').filter(Boolean).some(entry => !entry.startsWith('H ')),
    fingerprint: hash.digest('hex') }
}

function verifyBundle({ receipt, card, base, head, kind }, failedGate = false) {
  const root = realpathSync(dirname(receipt)), proof = JSON.parse(readFileSync(receipt, 'utf8'))
  assert(proof.version === 1 && proof.card === card && proof.base === base && proof.head === head && proof.kind === kind,
    'evidence identity does not match card/base/head/kind')
  assert(proof.unchanged === true && proof.snapshot.head === head, 'sources changed during evidence capture')
  assert(Array.isArray(proof.files) && proof.files.length > 0, 'evidence files required')
  if (['focused', 'gate'].includes(kind)) {
    assert(!proof.snapshot.dirty && !proof.snapshot.hiddenIndexFlags, 'clean exact-head evidence required')
    if (failedGate) {
      assert(kind === 'gate' && proof.result === 'failed' && Number.isInteger(proof.exitCode) && proof.exitCode > 0
        && proof.signal === null && proof.timedOut === false && proof.aborted === false && !proof.error,
      'completed failed gate command required')
      assert(typeof proof.command === 'string' && proof.command.trim() && Array.isArray(proof.argv) && proof.argv.length > 0,
        'executed gate command required')
      assert(proof.files.some(file => file.path === 'process.json'), 'raw process result required')
    } else assert(proof.result === 'passed' && proof.exitCode === 0, 'clean exact-head passing evidence required')
    assert(proof.files.some(file => file.path === 'stdout.log') && proof.files.some(file => file.path === 'stderr.log'), 'raw command logs required')
  }
  for (const file of proof.files) {
    const actual = realpathSync(resolve(root, file.path)), part = relative(root, actual)
    assert(part && !part.startsWith('..') && !isAbsolute(part), 'evidence file escapes bundle')
    assert(digest(readFileSync(actual)) === file.sha256, 'evidence file hash mismatch')
  }
  if (failedGate) {
    const process = JSON.parse(readFileSync(resolve(root, 'process.json'), 'utf8'))
    assert(process.state === 'exited' && process.status === proof.exitCode && process.signal === null
      && process.timedOut === false && process.aborted === false && process.error === null, 'failed gate process result mismatch')
  }
  return proof
}

export function verifyEvidence(options) {
  return verifyBundle(options)
}

export function verifyFailedGateEvidence(options) {
  assert(options.kind === 'gate', 'failed evidence must be a gate')
  return verifyBundle(options, true)
}

async function main() {
  const [action, ...args] = process.argv.slice(2), flags = {}, values = []
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--') { values.push(...args.slice(index + 1)); break }
    assert(args[index].startsWith('--') && args[index + 1], 'expected --flag value')
    flags[args[index].slice(2)] = args[index + 1]
  }
  const root = realpathSync(flags.repo ?? process.cwd())
  const identity = { card: flags.card, base: flags.base, head: flags.head, kind: flags.kind }
  assertCard(identity.card, (await loadConfig(root)).tracker.cardPattern)
  assert(identity.base && identity.head && identity.kind, 'card, base, head and kind required')
  if (action === 'verify') {
    const proof = verifyEvidence({ ...identity, receipt: resolve(root, flags.receipt) })
    process.stdout.write(JSON.stringify({ result: proof.result, ...identity }) + '\n')
    return
  }
  assert(['run', 'collect'].includes(action) && values.length > 0, 'run a command or collect explicit artifact files after --')
  assert(action !== 'collect' || !['focused', 'gate'].includes(identity.kind), 'focused and gate evidence must execute a command')
  assert(realpathSync(git(root, 'rev-parse', '--show-toplevel')) === root, 'evidence repo must be a repository root')
  const before = evidenceSnapshot(root)
  assert(before.head === identity.head && git(root, 'rev-parse', '--verify', `${identity.base}^{commit}`) === identity.base,
    'evidence requires actual full base/head SHAs')
  git(root, 'merge-base', '--is-ancestor', identity.base, identity.head)
  const parent = resolve(root, '.delivery/evidence', identity.card)
  git(root, 'check-ignore', '-q', '.delivery/evidence/')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(resolve(parent, `${identity.kind.replace(/[^a-zA-Z0-9_-]/g, '_')}-`))
  const proof = { version: 1, ...identity, snapshot: before, startedAt: new Date().toISOString(), files: [] }
  const recordFile = (path) => proof.files.push({ path, sha256: digest(readFileSync(resolve(directory, path))) })
  if (action === 'run') {
    const out = openSync(resolve(directory, 'stdout.log'), 'wx', 0o600), err = openSync(resolve(directory, 'stderr.log'), 'wx', 0o600)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
    let result
    try {
      result = await runOwnedProcess({ command: values[0], args: values.slice(1), cwd: root,
        stdio: ['ignore', out, err], signal: controller.signal,
        timeoutMs: Number(flags['timeout-ms'] ?? 1_800_000),
        onStatus: (status) => writeFileSync(resolve(directory, 'process.json'), JSON.stringify(status), { mode: 0o600 }) })
    } finally {
      process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
      closeSync(out); closeSync(err)
    }
    proof.argv = values
    proof.command = values.map(value => /^[a-zA-Z0-9_./:@=+-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'").join(' ')
    proof.exitCode = result.status
    proof.signal = result.signal
    proof.timedOut = result.timedOut
    proof.aborted = result.aborted
    proof.result = result.status === 0 && !result.error && !result.timedOut && !result.aborted ? 'passed' : 'failed'
    if (result.error) proof.error = result.error
    recordFile('stdout.log'); recordFile('stderr.log'); recordFile('process.json')
  } else {
    mkdirSync(resolve(directory, 'artifacts'), { mode: 0o700 })
    values.forEach((source, index) => {
      source = resolve(root, source)
      assert(lstatSync(source).isFile(), 'artifact must be a regular file')
      const path = `artifacts/${index}-${basename(source)}`
      copyFileSync(source, resolve(directory, path), constants.COPYFILE_EXCL)
      chmodSync(resolve(directory, path), 0o600)
      recordFile(path)
    })
    proof.result = 'captured'
  }
  proof.unchanged = JSON.stringify(before) === JSON.stringify(evidenceSnapshot(root))
  if (!proof.unchanged) proof.result = 'invalidated'
  proof.finishedAt = new Date().toISOString()
  const receipt = resolve(directory, 'receipt.json')
  writeFileSync(receipt, JSON.stringify(proof, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  process.stdout.write(JSON.stringify({ result: proof.result, receipt, directory, command: proof.command, exitCode: proof.exitCode }) + '\n')
  if (['failed', 'invalidated'].includes(proof.result)) process.exitCode = 1
}

const isDirectRun = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
if (isDirectRun) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
