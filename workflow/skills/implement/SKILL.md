---
name: implement
description: Implement, validate, and commit exactly one prepared card in its existing worktree.
disable-model-invocation: true
---

# Implement One Card

Run in a fresh implementation context. Read project instructions, the explicit
card, relevant domain docs, `agent-workflow.config.json`, and
`.agent-workflow/contracts/delivery.md`. The card, repository, and Git state are
authoritative; do not consume earlier-agent transcripts.

Require card ID, worktree/branch, base SHA, and model/reasoning route. Stop as
`needs_human` if inputs are missing, isolation is shared, or the card lacks
validated delivery routing or the configured implementing state.

1. Confirm worktree, branch, base, and clean starting state. Preserve unrelated
   user work.
2. Map acceptance criteria to tests and the smallest changes.
   Preserve accepted scope/design decisions; optional card suggestions remain
   optional. Read the same applicable project conventions as the reviewer.
3. Choose proof proportional to the behavior changed. Use red/green TDD when
   the project or card requires it, or when a reproducible bug or a consequential
   invariant benefits from proving the failure first. Capture the expected
   nonzero result as `regression` evidence when running a red check.
   Prefer an existing covering test or a focused smoke for routine changes.
4. Implement only the card.
5. Run any explicitly required precommit checks, including a build when required.
   Schedule focused handoff checks on the clean commit when project/card
   instructions permit it. Run the relevant lint/type checks where they cover
   the actual change. The workflow defers `commands.fullCheck` until reviews
   approve unless the project/card requires it earlier.
   Align the intended index before validation; leave tested contents unchanged.
   For a stalled command, use the delivery contract's owned-process diagnostics
   and its captured lifecycle metadata. Keep the failed run before an
   evidence-supported environment correction; a timeout never means success.
6. Review the staged diff for scope and secrets, create one card-referencing
   commit, and record its SHA.
7. Verify existing required focused receipts for the clean exact base/head using
   the delivery contract; execute only missing or invalidated checks through
   `delivery-evidence.mjs run --kind focused`. Repair a failed check before any
   review and capture fresh results on the corrected commit.
   Persist `validation.head` equal to the new commit, `validation.focused: passed`,
   and a non-empty `validation.checks` array of `{command, exitCode: 0}` for the
   checks actually passed on these unchanged contents. Transition to `REVIEWING`.
   Gate approval is the orchestrator's responsibility after reviews.

Record the returned
`command`, `exitCode` and `receipt` per check. Precommit requirements still run
before commit; capture them as `precommit`, then list those receipts and all
required red/browser/comparison bundles in `validation.artifacts`. Preserve the
baseline comparison script, both outputs, screenshots and console exports when
they are required proof. No temporary comparison test may be removed before its
source and raw results are collected. Missing mandatory evidence blocks handoff.

Return the implementation handoff from the delivery contract and stop. Do not
review, rework, push/merge a PR, or select another card.
