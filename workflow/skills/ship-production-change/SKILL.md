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

1. Require a clean worktree, card-only diff, matching head, and all routed
   approvals.
2. Run configured full check unless fresh auditable evidence proves this exact
   head. Run remaining card-specific release/migration/security gates.
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

After confirmed merge only, remove this card's clean inactive worktree with
`git worktree remove`, prune metadata, and stop task-owned processes. Preserve
dirty or active worktrees.

Update the checkpoint to `DONE` with merge, deployment, and cleanup evidence.
Return the compact shipping result and stop. Never edit, review, rework, or select
another card.
