---
name: rework
description: Correct only confirmed review findings for one card, validate, commit, and stop before fresh review.
disable-model-invocation: true
---

# Rework Confirmed Findings

Run in a fresh rework context. Read project instructions, the explicit card,
current repository state, confirmed findings, and
`.agent-workflow/contracts/delivery.md`. Do not consume implementation or reviewer
transcripts.

Require card ID, worktree/branch/current head, findings with evidence and bounded
required changes, route, and cycle. Ambiguous, stale, out-of-scope, product, or
security decisions return `needs_human` without edits.

1. Confirm current head equals the reviewed head.
2. Reproduce or verify each finding.
3. Make the smallest correction for confirmed findings only.
4. Add or adjust proof for each correction.
5. Run affected proof, invalidated card checks, and configured full check.
6. Create one card/finding-referencing commit, update the checkpoint to
   `REVIEWING`, and increment the cycle.

Return card, `rework_complete`, previous/new SHA, findings addressed, validation,
and unresolved blockers. Then stop. Rework never starts the next review or ships.
