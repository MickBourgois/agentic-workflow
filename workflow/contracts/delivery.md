# Delivery Orchestration Contract

Load this contract when hardening, starting, implementing, reviewing, reworking,
shipping, or resuming a card. Project instructions and
`agent-workflow.config.json` supply repository-specific values; this contract owns
delivery behavior.

## Unit of work

One delivery orchestration owns exactly one tracker card, one branch, one
worktree, and one pull request. `DONE`, `NEEDS_HUMAN`, and `FAILED` are terminal.
Repository state, Git commits, tracker comments, and compact checkpoints are
shared memory. Agent transcripts are not handoffs.

```text
READY -> IMPLEMENTING -> REVIEWING -> APPROVED -> SHIPPING -> DONE
                            |             ^
                            v             |
                         REWORKING --------+
```

Any non-terminal state may move to `NEEDS_HUMAN` or `FAILED`. The default limit
is two rework cycles and one model escalation; project config may lower or raise
those numeric limits. A retry requires changed evidence. Repeating an unchanged
operation is not a recovery strategy.

## Complexity classification

Hardening assigns exactly one level. Apply critical overrides first, then score
every non-critical dimension with evidence.

### Critical overrides

Classify as `critical` when the changed contract can plausibly cause irreversible
or safety-sensitive impact involving:

- authentication, authorization, impersonation, row-level security, privileged
  access, or cross-account permissions;
- billing, payments, subscription state, credits, or financial records;
- destructive or rewriting migrations, backfills, privilege changes, locking
  hazards, or a weak rollback path;
- integrity, privacy, security, corruption, or data-loss risk;
- production infrastructure, availability, secrets, or system-wide irreversible
  effects.

Touching a neighboring file is insufficient. Name the changed contract and the
credible failure mode.

### Non-critical score

| Dimension | Range |
|---|---:|
| Change surface and number of layers | 0-3 |
| Business logic complexity | 0-3 |
| External dependencies | 0-2 |
| Async, concurrency, retries, ordering | 0-2 |
| Regression risk | 0-3 |
| Test difficulty | 0-2 |
| Remaining ambiguity | 0-2 |
| Blast radius | 0-3 |

- `simple`: 0-4, local and independently testable.
- `standard`: 5-10, normal cross-file or cross-layer work.
- `complex`: 11-20, broad or strongly coupled work.

If score and evidence disagree, choose the higher level and explain why. Blocking
ambiguity stops hardening as `needs-info`; complexity never hides an unresolved
decision.

## Model and review routing

| Complexity | Implementation | Independent review |
|---|---|---|
| `simple` | `gpt-6-sol` / `medium` | 1 × `gpt-6-sol` / `medium` |
| `standard` | `gpt-6-sol` / `high` | 1 × `gpt-6-sol` / `high` |
| `complex` | `gpt-6-sol` / `medium`; `high` for score ≥15 or ambiguity/test difficulty/regression risk ≥2 | 1 × `gpt-6-sol` / `high` |
| `critical` | `gpt-6-astra` / `high` | A: `gpt-6-astra` / `high`; B: `gpt-6-sol` / `high` |

Rework uses the implementation route. One bounded escalation maps any Sol
`medium` route to Sol `high`; Sol `high` and Astra `high` have no automatic model
escalation. The orchestrator and shipper use Sol / medium. The backlog selector
uses Luna / low. No route uses `xhigh`. `workflow/config/defaults.mjs` is the
executable source of truth and the routing tests protect this table.

## Fresh-context phase contracts

Spawn every phase without inherited conversation history.

### Implementation

Input: card ID, repository/worktree, branch, base SHA, and exact model/reasoning.
The implementer fetches the card and project instructions directly.

```yaml
card: PROJ-123
status: implementation_complete
commit: <sha>
validation:
  focused: passed
  full_check: passed
notes:
  migrations: none
  known_limitations: []
```

### Review

Input: card ID, repository/worktree, base SHA, head SHA, reviewer slot. Never pass
implementation transcripts, rationale, conclusions, or another review.

```yaml
card: PROJ-123
status: approved | findings
reviewed_head: <sha>
reviewer_slot: single | A | B
findings:
  - id: RVW-001
    priority: P0 | P1 | P2 | P3
    file: <path>
    line: <line>
    requirement: <precise requirement reference>
    evidence: <observable evidence>
    required_change: <bounded correction or test>
```

Critical reviewers run independently. The orchestrator unions duplicates by
`(file, line, requirement)` and sends conflicting opinions to a human.

### Rework

Input: card ID, worktree, current reviewed head, cycle, exact route, and confirmed
structured findings only. Output the new commit, findings addressed, validation,
and unresolved blockers. Rework never runs the next review.

### Shipping

Input: card ID, worktree, approved head, validation, and required review receipts
for that exact head. Shipping may push, open/update the PR, wait for CI, merge when
repository rules allow it, verify deployment, update the tracker, and clean the
worktree. It never edits application code or manufactures review evidence.

## Durable persistence

Hardening owns one tracker comment marked `<!-- delivery-routing:v1 -->`. It holds
the classification evidence and exact route. Delivery owns one idempotent comment
marked `<!-- delivery-checkpoint:v1 -->`. It holds state, branch/worktree hint,
SHAs, cycles, receipts, PR, validation, escalation count, and next action.

Update an existing marked comment by ID. Never create duplicates. Mirror the
checkpoint at `.delivery/state/<CARD>.json`; Git and live tracker/PR state outrank
a stale local file.

## Resume

1. Fetch the full card, relations, routing comment, and checkpoint.
2. Inspect live branches, worktrees, commits, PR, CI, and merge state.
3. Reconcile to the last state with durable evidence. Approval names the current
   head; `DONE` requires a confirmed merge.
4. Resume only the next phase in a fresh context.

Backlog traversal is an outer runner. It starts a new top-level Codex process per
card and never uses `codex exec resume`.
