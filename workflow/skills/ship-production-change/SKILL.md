---
name: ship-production-change
description: Ship one independently approved card through final validation, PR, CI, merge, deployment proof, and cleanup.
disable-model-invocation: true
---

# Ship One Approved Card

Run in a fresh shipping context. Read project instructions, the full card,
`agent-workflow.config.json`, `.agent-workflow/contracts/delivery.md`, and
`references/review-loop.md`.

Require card ID, worktree/branch/base, approved head, validation, and exact-head
review receipts. Simple/standard/complex require one receipt; critical requires
independent A and B receipts. Missing proof returns `needs_human`; shipping never
creates substitute evidence.

## Final gate

For an older approval or shipping state, follow the legacy resume procedure in
the delivery contract. Preserve existing receipts; refresh validation only from
real exact-base/head evidence using `validation_refreshed`. Missing worktree,
approvals or unrecoverable proof requires human reconciliation.

1. Require a clean worktree, card-only diff, matching head, and all routed
   approvals.
2. Reuse the orchestrator's fresh auditable gate for this exact base/head; do not
   rerun it solely because shipping uses a fresh context. `start_shipping`
   rechecks live Git and, when configured, invokes `validationProof` again and
   compares the saved binding/receipt hashes. Changed or expired evidence blocks.
   If project policy requires a refresh, run the gate again without changing code
   and record `validation_refreshed` before shipping. Set the frozen base; bind the
   successful immutable required-gate receipt to the approved head with
   `commands.validationProof` when configured, then verify it. Otherwise record
   auditable project evidence for the approved head. Never accept focused proof or a
   binding from an earlier head. Default `delivery.validationMode: full` requires
   the full gate. Explicit `project` mode permits only a reduced profile selected
   by the project's tested fail-closed impact policy; otherwise require full.
   Record the required-gate fields from the delivery contract. Focused evidence
   never substitutes for the final gate, even without `validationProof`.
   Run remaining card-specific release, migration,
   and security gates; preserve raw receipts.
3. Failed gates stop. Shipping does not edit application code.
4. Pull/rebase against the current configured remote/base before push when needed.
   A changed head invalidates approvals and returns to the orchestrator.

## PR, merge, deployment

Follow the review-loop reference. Push the exact approved head; open/update one
linked PR; reflect configured review/rework/merging statuses; wait for required CI;
respect branch protection and recorded authorization for destructive or sensitive
rollouts. Immediately before merge, recheck head/base, CI, approvals, threads,
and mergeability. Confirm merge on the configured base and required deployment/
safe-smoke proof before setting the card to done.

## Cleanup

When validation proof is configured, archive the verified binding and its raw
receipt with their recorded hashes before removing the worktree; pass their
archive paths to the project completion checker.

After confirmed merge only, remove this card's clean inactive worktree with
`git worktree remove`, prune metadata, and stop task-owned processes. Preserve
dirty or active worktrees.

Update the checkpoint to `DONE` with merge, deployment, and cleanup evidence.
When `commands.completionCheck` is configured, supply its project evidence to
the state machine's `shipped` event. The command receives state/payload/config on
stdin and must return a passing proof for the exact head/base/merge. Let the state
writer generate `.delivery/checkpoints/<CARD>.md`; publish that body to the one
marked tracker comment and reread it. A failed completion check leaves SHIPPING.
Return the compact shipping result and stop. Never edit, review, rework, or select
another card.
