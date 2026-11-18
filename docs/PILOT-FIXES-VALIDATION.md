# Targeted validation for 0.8.2

The two fixes address CLI reviewers waiting without inspecting code and process
diagnostics exposing unrelated argv. Existing receipt/state semantics remain
compatible; the delivery orchestrator still judges actual review coverage.

## Deterministic checks

```bash
node --test tests/owned-process.test.mjs tests/run-review.test.mjs tests/evidence.test.mjs tests/review-gate.test.mjs tests/isolation.test.mjs tests/install-update.test.mjs
npm run check
```

The targeted suite exercises cancellation of only the launched child while an
unrelated process stays alive, lifecycle metadata without argv, resistant-child
timeout, zero exit after cancellation, and descendant-held output pipes. Dispatch
checks cover the exact reviewer-B model/effort, no delegation, missing inspection,
model/executable failure, incomplete/stale receipts, timeout, dirty worktree,
unchanged delivery state, installation and preserved historical evidence.

## Real CLI check

```bash
node scripts/review-smoke.mjs --live
```

This opt-in check consumes a real Codex inference. It installs the payload into a
temporary synthetic repository, records focused evidence, and runs the installed
reviewer-B fallback on the critical route. The synthetic card is local; no live
Linear card, production API or provider fixture is used. Require an approved
exact-card/base/head/slot receipt, successful inspection events and byte-identical
delivery state before/after. Private logs and the receipt stay in the temporary
fixture; the command prints only its result and artifact locations.

The execution on 2026-11-18 passed on `gpt-6-sol/high`. This proves a fresh direct
review completed on the supported host; it does not attest the provider's internal
model serving or certify every future review. Inspect raw events against claimed
file coverage before recording any receipt in a real delivery.

Timeout/cancellation controls only the retained child handle. Shared daemons and
unowned descendants are outside termination scope; ownership uncertainty requires
reporting the limit, not a process-table search or guessed kill. A command which
prints a credential can still taint private raw logs; use fixture inputs and the
contract's diagnostic rules, inspect locally and redact before sharing.
