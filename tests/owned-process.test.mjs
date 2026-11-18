import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { runOwnedProcess } from '../workflow/orchestrator/owned-process.mjs'

test('diagnostics expose only lifecycle fields and cancellation touches only the owned child', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'unrelated-credential-canary'], { stdio: 'ignore' })
  await once(unrelated, 'spawn')
  try {
    const controller = new AbortController(), statuses = []
    const result = await runOwnedProcess({ command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)', 'owned-credential-canary'],
      stdio: 'ignore', signal: controller.signal,
      onStatus: (status) => { statuses.push(status); if (status.state === 'running') controller.abort() } })
    assert.equal(result.aborted, true)
    assert.equal(result.timedOut, false)
    assert.equal(statuses.at(-1).state, 'exited')
    assert.doesNotMatch(JSON.stringify(statuses), /credential-canary|args|command/)
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
  } finally { unrelated.kill(); await once(unrelated, 'close') }
})

test('timeout escalates a resistant owned child and cannot count its graceful exit as success', async () => {
  const results = []
  for (const code of ["process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"]) {
    const result = await runOwnedProcess({ command: process.execPath, args: ['-e', code], stdio: 'ignore', timeoutMs: 1_000 })
    assert.equal(result.timedOut, true)
    assert.equal(result.aborted, false)
    results.push(result)
  }
  assert.equal(results[0].signal, 'SIGKILL')
  assert.equal(results[1].status, 0)
})

test('unavailable executable, invalid timeout and pre-cancelled launch fail safely', async () => {
  const result = await runOwnedProcess({ command: '/no-such-workflow-executable', stdio: 'ignore' })
  assert.equal(result.error, 'ENOENT')
  for (const timeoutMs of [0, -1, NaN, 2 ** 32]) {
    assert.throws(() => runOwnedProcess({ command: process.execPath, timeoutMs }), /timeoutMs/)
  }
  const controller = new AbortController(); controller.abort()
  assert.throws(() => runOwnedProcess({ command: process.execPath, signal: controller.signal }), /before launch/)
})

test('an exited child cannot leave capture waiting on a descendant-held pipe indefinitely', async () => {
  const code = `require('node:child_process').spawn(process.execPath,
    ['-e', 'setTimeout(() => {}, 1500)'], {stdio: 'inherit'}).unref()`
  const result = await runOwnedProcess({ command: process.execPath, args: ['-e', code], timeoutMs: 300 })
  assert.equal(result.timedOut, true)
})
