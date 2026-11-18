import { spawn } from 'node:child_process'

// Keep the ChildProcess handle: a PID discovered later cannot establish ownership.
export function runOwnedProcess({ command, args = [], cwd, stdio, input, signal,
  timeoutMs = 1_800_000, onStatus = () => {} }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error('timeoutMs must be a positive timer duration')
  }
  if (signal?.aborted) throw new Error('process cancelled before launch')
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio })
    let stopped = false, timedOut = false, aborted = false, escalation, reportingError
    const report = (status) => {
      try { onStatus({ pid: child.pid ?? null, ...status }) }
      catch (error) { reportingError = error; stop('reporting') }
    }
    const closePipes = () => {
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy()
    }
    const stop = (reason) => {
      if (stopped) return
      stopped = true
      timedOut = reason === 'timeout'
      aborted = reason === 'cancelled'
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      else closePipes()
      escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        closePipes()
      }, 1_000)
      report({ state: 'stopping', reason })
    }
    const cancel = () => stop('cancelled')
    const timer = setTimeout(() => stop('timeout'), timeoutMs)
    signal?.addEventListener('abort', cancel, { once: true })
    let spawnError
    child.once('error', (error) => { spawnError = error.code ?? 'SPAWN_FAILED' })
    child.once('close', (status, processSignal) => {
      stopped = true
      clearTimeout(timer)
      clearTimeout(escalation)
      signal?.removeEventListener('abort', cancel)
      const result = { status, signal: processSignal, timedOut, aborted, error: spawnError ?? null }
      report({ state: 'exited', ...result })
      if (reportingError) reject(new Error('process status could not be recorded'))
      else resolve(result)
    })
    report({ state: 'running' })
    if (child.stdin && input !== undefined) {
      child.stdin.on('error', () => {}) // An early CLI exit can close stdin before the prompt is sent.
      child.stdin.end(input)
    }
  })
}
