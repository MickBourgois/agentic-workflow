#!/usr/bin/env node

import { resolve } from 'node:path'
import { FIXED_ROUTES, ROUTES } from '../config/defaults.mjs'
import { loadConfig } from './config.mjs'
import { routeFor } from './delivery-state.mjs'

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const repoIndex = args.indexOf('--repo')
  const repoRoot = resolve(repoIndex >= 0 ? args[repoIndex + 1] : process.cwd())
  if (command === 'config') {
    process.stdout.write(`${JSON.stringify(await loadConfig(repoRoot), null, 2)}\n`)
    return
  }
  if (command === 'route') {
    const complexity = args[0]
    const scoreIndex = args.indexOf('--score')
    const dimensionsIndex = args.indexOf('--dimensions')
    const score = scoreIndex >= 0 ? Number(args[scoreIndex + 1]) : 0
    const dimensions = dimensionsIndex >= 0 ? JSON.parse(args[dimensionsIndex + 1]) : {}
    const highEffort = args.includes('--high-effort')
    process.stdout.write(`${JSON.stringify(routeFor(complexity, { score, dimensions, highEffort }), null, 2)}\n`)
    return
  }
  if (command === 'routes') {
    process.stdout.write(`${JSON.stringify({ adaptive: ROUTES, fixed: FIXED_ROUTES }, null, 2)}\n`)
    return
  }
  throw new Error('Usage: agent-workflow.mjs <config|route|routes> [options]')
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
