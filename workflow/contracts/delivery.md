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
READY -> IMPLEMENTING -> REVIEWING -> VALIDATING -> APPROVED -> SHIPPING -> DONE
                            |  ^       required gate
                            v  |
                         REWORKING
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
| `simple` | `gpt-6-luna` / `low` | 1 × `gpt-6-luna` / `high` |
| `standard` | `gpt-6-luna` / `high` | 1 × `gpt-6.1-sol` / `medium` |
| `complex` | `gpt-6.1-sol` / `medium`; `high` for score ≥15 or ambiguity/test difficulty/regression risk ≥2 | 1 × `gpt-6.1-sol` / `high` |
| `critical` | `gpt-6.1-sol` / `high` | A: `gpt-6.1-sol` / `high`; B: `gpt-6-sol` / `high` |

Rework uses the implementation route. One bounded escalation maps Luna and Sol 6.1
`medium` implementation routes to Sol 6.1 `high`; Sol 6.1 `high` has no automatic
escalation. The orchestrator and shipper use Sol 6.1 / medium. The backlog selector
uses Luna 6 / low. Sol 6 remains as the second critical reviewer so that the two
reviews use distinct models. No route uses `xhigh`. `workflow/config/defaults.mjs` is the
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
  head: <sha>
  focused: passed
  checks:
    - command: <actual-required-focused-command>
      exitCode: 0
notes:
  migrations: none
  known_limitations: []
```

Run and record sufficient focused tests and every project/card pre-commit or
pre-review requirement, including an explicitly required build or early full
gate. Missing or failing required checks block entry into REVIEWING. The workflow
itself defers the required final gate until all independent reviews approve.
The CLI validates the records; the phase and reviewer must inspect actual results
and coverage. It cannot infer every project's required commands from a diff.

### Review

Input: card ID, repository/worktree, base SHA, head SHA, reviewer slot. Never pass
implementation transcripts, rationale, conclusions, or another slot's review.
For a bounded rework, the same slot may receive its own prior receipt and head;
its new review and receipt must cover the current head as specified by the skill.

```yaml
card: PROJ-123
status: approved | findings
reviewed_head: <sha>
reviewer_slot: single | A | B
scope: code_and_focused_checks
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
Before each dispatch, `delivery-state.mjs review-ready --card <CARD>` requires
recorded passing focused checks for the current head, a clean live worktree and
the frozen base as an ancestor. The reviewer assesses code and focused evidence;
its approval does not assert that the final gate passed. Initial and rework
reviews use the same rule, with stricter project/card instructions preserved.

### Required gate and delivery approval

`reviews_approved` takes all exact-head, scoped receipts and moves REVIEWING to
VALIDATING. Missing slots, findings, stale heads or missing focused checks block
that event. It preserves focused evidence separately as `focusedValidation`.
Only then run the required project gate on the approved head and frozen base.
Full is the default; project profiles retain the integration contract's explicit
opt-in and tested fail-closed policy. Reuse an existing receipt only if it already
meets that exact policy, pair and freshness requirements. Never rebind old or
partial results to a new commit.

`review_approved` now requires VALIDATING and a validation object:

```yaml
kind: required_gate
result: passed
base: <frozen-base-sha>
head: <approved-sha>
profile: full # or a profile permitted by explicit project mode
reason: <policy-selection-reason>
checks:
  - command: <actual-required-gate-command>
    exitCode: 0
receipt: <auditable-receipt-path>
binding: <binding-path-if-validationProof-is-configured>
```

The event verifies the project's binding when configured before entering
APPROVED (delivery approval). Gate failure leaves VALIDATING, with no shipping
authorization. `start_shipping` checks the same evidence again without rerunning
the gate; with a verifier it also compares the saved binding/receipt hashes.
Receipt expiry and project-specific freshness/coverage are enforced by the
project verifier or, without one, the project's audited process. The CLI checks
records and exact SHAs but does not execute tests or independently certify those
records without a verifier. No generic time-to-live is imposed.

Every new commit invalidates code approvals and gate evidence; a changed base
invalidates the pair too. Unexpected Git changes require reconciliation and fresh
review, never silent edits to frozen SHAs. A gate-triggered correction follows
the existing bounded rework process after confirmed findings; unresolved scope
or state mismatches require a human. Keep approvals and gate status distinct.

### Rework

Input: card ID, worktree, current reviewed head, cycle, exact route, and confirmed
structured findings only. Output the new commit, findings addressed, focused
validation, and unresolved blockers. Rework never runs the next review; the
required project gate and exact-head binding remain mandatory before approval
and shipping. Full is the default; a reduced profile requires explicit project
mode and the tested, fail-closed impact policy in the integration contract.

### Shipping

Input: card ID, worktree, frozen base SHA, approved head, validation, and required
review receipts for that exact head. Shipping may push, open/update the PR, wait for CI, merge when
repository rules allow it, verify deployment, update the tracker, and clean the
worktree. It never edits application code or manufactures review evidence.

## Durable persistence

Hardening owns one tracker comment marked `<!-- delivery-routing:v1 -->`. It holds
the classification evidence and exact route. Delivery owns one idempotent comment
marked `<!-- delivery-checkpoint:v1 -->`. It holds state, branch/worktree hint,
SHAs, cycles, receipts, PR, validation, escalation count, and next action.

Update an existing marked comment by ID. Never create duplicates. Mirror the
checkpoint at `.delivery/state/<CARD>.json`; Git and live tracker/PR state outrank
a stale local file. Previous review receipts stay in local state only, never in
the shared checkpoint; active review and rework checkpoints omit all review
receipts, including in VALIDATING. Before dispatch or resume, publish and verify the sanitized checkpoint.
If local context is lost, use a full fresh review.

## Resume

### Observation ownership

The active phase owns its external watch. During shipping, the shipper owns PR,
CI, and deployment status; the orchestrator awaits the phase result. Perform one
independent terminal audit after that result. Emit human updates on a meaningful
state change, failure, or required action; use a machine-visible heartbeat while
unchanged, subject to the host's communication requirements.

Prefer a connector's event wait. Where unavailable, GitHub CLI provides a bounded
tool session with `gh pr checks <PR> --repo <OWNER/REPO> --required --watch
--fail-fast --interval 30`. Record the head before watching and recheck head/base
and CI before merge. Missing, skipped, unknown or empty required checks do not
establish a passing required gate. Never rerun a failed CI solely to keep watching.

Read compact metadata projections from connectors: head/status/conclusion/URL,
not full commit diffs or issue bodies for a status lookup. Use
`delivery-state.mjs summary --card <CARD>` for routine local status. Full receipts,
logs and history stay in files and are read only to investigate a specific issue.

1. Fetch the full card, relations, routing comment, and checkpoint.
2. Inspect live branches, worktrees, commits, PR, CI, and merge state. Follow the
   legacy compatibility rules below before changing an older state.
3. Reconcile to the last state with durable evidence. Approval names the current
   head; `DONE` requires a confirmed merge.
4. Resume only the next phase in a fresh context.

Backlog traversal is an outer runner. It starts a new top-level Codex process per
card and never uses `codex exec resume`.

### Compatibility with deliveries started before 0.7.0

New local states use format version 2. The tracker marker stays
`delivery-checkpoint:v1` so comment ownership is unchanged; its JSON now includes
the local state version. Installation/update never migrates `.delivery`, changes
tracker comments, or rewrites receipts. Versions 1 and 2 can be read; unknown
versions cannot transition. Do not change a version field to bypass checks.

- READY/IMPLEMENTING: continue implementation and record real focused checks;
  completion writes format 2.
- REVIEWING: run `review-ready`. A legacy `full_check: passed` flag alone is
  insufficient. Recover actual commands, successful results and their tested head
  from durable evidence, with human reconciliation if records are incomplete.
  Never invent focused records from a green summary. Obtain fresh scoped reviews
  and use `reviews_approved`; old unscoped receipts cannot enter VALIDATING.
- REWORKING: keep confirmed findings, slot-specific prior receipts, cycle and
  escalation counts. A real corrected commit with focused evidence continues in
  format 2; missing local context requires full-diff reviews, not incremental ones.
- VALIDATING: resume from local exact-head scoped approvals. The sanitized shared
  checkpoint cannot reconstruct them; missing local receipts requires a human
  and fresh reviews, never synthetic approvals.
- APPROVED/SHIPPING from format 1: keep the existing exact-head slots and approval
  scope as recorded. They are not retrospectively labeled as focused reviews.
  Before shipping/cleanup, recover and verify the real required-gate receipt and
  record all gate fields above via `validation_refreshed` (same base/head,
  `validationProof` verification when configured). Format 1 and original receipts
  remain intact. Reuse valid proof rather than rerunning; expired proof requires
  a real refresh. Missing approvals, a lost worktree, a changed pair or unavailable
  proof requires a human; never recreate an old successful run. Already-merged
  deliveries with a removed worktree need project completion/archive reconciliation,
  not another merge or a fabricated local gate.
- DONE/NEEDS_HUMAN/FAILED: preserve terminal state. Audit external facts separately;
  a checkpoint or green PR alone proves neither merge nor deployment.
