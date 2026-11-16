# PR, CI, Merge, and Deployment Gate

This gate begins only after adaptive independent review approves the exact head.

## PR and CI

- One card, branch, worktree, and PR.
- PR body: card link, summary, scope, validation, risk, receipt count, and
  deployment/migration notes.
- Carry forward optional review suggestions in the PR or delivery handoff without
  requiring extra correction commits or creating tickets automatically.
- Pending or failed required checks are not green.
- Own the CI watch for this phase. Use event waits or the native required-check
  watcher described in the delivery contract; return changes and terminal evidence
  to the orchestrator without duplicate polling.
- Any new commit invalidates every prior receipt and returns control to the
  orchestrator.
- Classify PR threads using the delivery contract's blocking policy. Unresolved
  demonstrated P0-P2 defects block merge. Record optional suggestions separately;
  they require neither a code change nor a rework cycle. Respect repository
  thread-resolution rules without relabeling suggestions as defects.

## Merge gate

Immediately before merge verify exact approved head, current/mergeable base,
green required CI, all routed independent approvals, zero unresolved blocking thread, and
recorded authorization for sensitive rollout work. Merge through protected PR
workflow; never push directly to the base or bypass protection.

## Post-merge

Confirm the merge commit is reachable from the configured remote/base. Verify the
matching deployment and card-required safe smoke. Deployment failure leaves the
card outside done and returns `needs_human`. Remove only the clean inactive card
worktree with Git's worktree command.
