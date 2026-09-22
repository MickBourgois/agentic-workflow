---
name: start-card
description: Orchestrate one hardened card through fresh implementation, adaptive review, bounded rework, and shipping contexts.
disable-model-invocation: true
---

# Start One Card

You are the card orchestrator, not an implementer. Read project instructions,
`agent-workflow.config.json`, `.agent-workflow/contracts/delivery.md`, and
`.agent-workflow/contracts/tracker-linear.md` completely.

An explicit card ID is mandatory. Never query the backlog for another card.

## 1. Preflight and reconcile

1. Require configured tracker team and Linear issue CRUD before changing Git.
2. Fetch the full card, relations, labels, comments, and status.
3. Require configured hardened/ready labels, zero open blockers, and one valid
   `delivery-routing:v1` comment. Missing or contradictory routing is
   `needs_human`; direct the user to `/harden-card`.
4. Validate routing against the installed engine. Find any marked checkpoint and
   `.delivery/state/<CARD>.json`; reconcile both with live Git, PR, CI, and merge
   evidence.
5. Return an existing terminal result immediately.

## 2. Prepare or resume isolation

One card owns one branch, worktree, and PR.

- Inspect `git worktree list`; preserve dirty, active, or unmerged worktrees.
- Fetch the configured remote/base and require a clean, uncontaminated base.
- Create/resume under configured `worktree.root` using the configured branch
  pattern. Resume durable state instead of duplicating it.
- Run the detected/configured install command when present.
- Copy only file names listed in `environment.copyFiles`, without printing
  contents. Surface configured safety warnings before mutable smokes.
- Move only this card to the configured implementing status before the first edit.
- Initialize/update state with `.agent-workflow/bin/delivery-state.mjs` and the
  marked tracker checkpoint.

## 3. Dispatch implementation

When no durable implementation commit exists:

1. Transition `READY -> IMPLEMENTING`.
2. Spawn the project `implementer` agent with no inherited turns.
3. Pass only card ID, repository/worktree, branch, base SHA, and the validated
   implementation model/reasoning. Require the repo-local `/implement` skill.
4. Resolve its commit and persist objective validation. Do not forward its notes
   to reviewers.

Two matching failure fingerprints trigger the one bounded escalation and one
fresh-context retry. A further match becomes `NEEDS_HUMAN`.

## 4. Dispatch independent review

Transition to `REVIEWING`. Each fresh reviewer receives only card ID, path, base
SHA, current head SHA, and reviewer slot.

- simple, standard, complex: one reviewer;
- critical: reviewers A and B concurrently on their distinct routed models.

Require `/code-review` and exact-head receipts. Never pass implementation
transcripts, rationale, conclusions, or another review.

If every required receipt approves the current head, transition to `APPROVED`.
Otherwise deduplicate findings by `(file, line, requirement)`. Conflicting reviews
need a human. Within the configured rework limit, move the card to rework, spawn a
fresh `reworker` with confirmed findings only, require a new commit, then run a
completely fresh review on the new head. Any commit invalidates prior approvals.

## 5. Dispatch shipping

After `APPROVED`, spawn `shipper` with no inherited turns on the fixed Sol /
medium route. Pass only card, worktree, approved head, validation, and exact-head
receipts. Require `/ship-production-change`. Accept `DONE` only after merge on the
configured base, tracker completion, and required deployment proof.

## 6. Terminal response

```json
{
  "card": "PROJ-123",
  "status": "done | needs_human | failed",
  "state": "DONE | NEEDS_HUMAN | FAILED",
  "head": "sha-or-null",
  "pr": "url-or-null",
  "summary": "compact objective outcome"
}
```

Then stop the card process. Backlog traversal belongs to the outer runner.
