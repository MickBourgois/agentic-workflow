# PR, CI, Merge, and Deployment Gate

This gate begins only after adaptive independent review approves the exact head.

## PR and CI

- One card, branch, worktree, and PR.
- PR body: card link, summary, scope, validation, risk, receipt count, and
  deployment/migration notes.
- Pending or failed required checks are not green.
- Any new commit invalidates every prior receipt and returns control to the
  orchestrator.
- Classify every PR thread; actionable unresolved P0-P3 blocks merge.

## Merge gate

Immediately before merge verify exact approved head, current/mergeable base,
green required CI, all routed independent approvals, zero actionable thread, and
recorded authorization for sensitive rollout work. Merge through protected PR
workflow; never push directly to the base or bypass protection.

## Post-merge

Confirm the merge commit is reachable from the configured remote/base. Verify the
matching deployment and card-required safe smoke. Deployment failure leaves the
card outside done and returns `needs_human`. Remove only the clean inactive card
worktree with Git's worktree command.
