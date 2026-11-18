#!/usr/bin/env node

// Explicit opt-in: this synthetic check uses a real routed Codex inference.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { reviewFixture } from '../tests/fixtures/review-fixture.mjs'

if (!process.argv.includes('--live')) throw new Error('Pass --live to authorize the synthetic CLI inference')
const fixture = await reviewFixture({ install: true })
const { runReview } = await import(pathToFileURL(resolve(fixture.repo, '.agent-workflow/bin/run-review.mjs')))
const result = await runReview({ repoRoot: fixture.repo, card: fixture.card, slot: 'B', timeoutMs: 180_000 })
const receipt = JSON.parse(await readFile(result.receipt, 'utf8'))
if (receipt.status !== 'approved') throw new Error(`Synthetic review found blockers; inspect ${result.runDir}`)
if (await readFile(fixture.stateFile, 'utf8') !== fixture.originalState) throw new Error('Review changed delivery state')
process.stdout.write(JSON.stringify({ result: 'passed', model: 'gpt-6-sol', reasoning: 'high',
  repo: fixture.repo, receipt: result.receipt, deliveryStateUnchanged: true }) + '\n')
