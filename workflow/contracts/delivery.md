# Delivery Orchestration Contract

Load this contract when hardening, starting, implementing, reviewing, reworking,
shipping, or resuming a card. Project instructions and
`agent-workflow.config.json` supply repository-specific values; this contract owns
delivery behavior.

## Unit of work

One delivery orchestration owns exactly one tracker card, one branch, one
worktree, and one pull request. `DONE`, `NEEDS_HUMAN`, and `FAILED` are terminal,
except the explicit human reconciliation of a failed validation gate below.
Repository state, Git commits, tracker comments, and compact checkpoints are
shared memory. Agent transcripts are not handoffs.

```text
READY -> IMPLEMENTING -> REVIEWING -> VALIDATING -> APPROVED -> SHIPPING -> DONE
                            |  ^       required gate
                            v  |
                         REWORKING
```

Any non-terminal state may move to `NEEDS_HUMAN` or `FAILED`. New deliveries
allow at most one automatic rework and two rounds of review. Projects can set
zero automatic reworks. The default model escalation limit is one. Critical slots
A/B run concurrently within each round. Preserve recorded limits and counters
on resume. Remaining blockers at the limit require a human decision. Retry
only when evidence changes.

## Complexity classification

Inline intake or explicit hardening assigns exactly one level. Apply critical
overrides first, then score every non-critical dimension with evidence.

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
      receipt: <raw-focused-bundle/receipt.json>
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

#### Blocking policy

Approve when the accepted scope works, required checks pass and no demonstrated
defect remains. An empty review is valid; findings have no quota.

- `findings` contains only blocking P0-P2 defects with concrete impact on the
  accepted change: incorrect behavior, a regression, missing or failed required
  proof, a credible security/data-loss risk, or violation of a binding project rule.
  Cite the affected scenario and consequence. A P2 must meet the same standard.
- `suggestions` contains optional P2-P3 advice: polish, preferences, alternative
  designs and additional coverage without a demonstrated gap. P3 never triggers
  rework. P0/P1 cannot be downgraded to suggestions.
- Priority alone is not evidence. A P2 defect can block; an architectural
  preference cannot become a blocker by being labeled P2. Missing product choices
  need human arbitration instead of silently expanding the accepted scope.

Use this same policy during initial review, rework and PR-thread triage. Explicit
project rules and branch protection still apply. Record suggestions in the PR or
handoff without creating tickets automatically or requiring a correction commit.

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
    priority: P0 | P1 | P2
    file: <path>
    line: <line>
    requirement: <precise requirement reference>
    evidence: <observable evidence>
    required_change: <bounded correction or test>
suggestions:
  - priority: P2 | P3
    file: <path-if-relevant>
    line: <line-if-relevant>
    suggestion: <optional improvement>
```

Use `status: approved` with absent or empty `findings`, even when suggestions
remain. `status: findings` requires at least one evidenced blocker. The CLI
checks these shapes, priorities and complete deduplicated blocker coverage; the
reviewer and orchestrator remain responsible for confirming the actual defect.

Critical reviewers run independently. The orchestrator unions duplicates by
`(file, line, requirement)` and sends conflicting opinions to a human.
Before each dispatch, `delivery-state.mjs review-ready --card <CARD>` requires
recorded passing focused checks for the current head, a clean live worktree and
the frozen base as an ancestor. The reviewer assesses code and focused evidence;
its approval does not assert that the final gate passed. Initial and rework
reviews use the same rule, with stricter project/card instructions preserved.

### CLI review dispatch

When the host cannot dispatch a routed reviewer through its native agent tool,
use the installed runner instead of constructing an ad-hoc CLI prompt:

```bash
node .agent-workflow/bin/run-review.mjs --repo <entry-repo> --card PROJ-123 --slot B --timeout-ms 1800000
```

It reads the durable routing and frozen pair, checks review readiness, and starts
a new direct read-only Codex exec without a shared daemon, with delegation disabled on the exact model
and effort. It supplies card, worktree, pair and slot. For a direct correction
on a simple or standard card, it can also supply only that slot's validated
prior findings. Use the complete diff when the correction or its impact is
uncertain or sensitive. Availability errors,
timeouts, waits without inspection, missing/invalid results, mismatched identity
or changed delivery/worktree leave delivery state untouched and produce no
accepted `receipt.json`. There is no model substitution or automatic approval.

The run directory contains private raw JSONL events, stderr, the untrusted
`result.json`, safe `process.json` lifecycle metadata, and, only on success, the
validated receipt. The receipt's `inspected_files` is the reviewer's coverage
claim. The orchestrator checks it against the actual command events and diff;
a successful inspection command alone cannot certify review quality. Record
the accepted receipt through the normal all-slot review event only after that
check. A partial failure preserves the same pair and counters for reconciliation.

### Owned-process diagnostics

Observe subprocesses through the handle/session returned by their launch and
the run's `process.json`: PID, lifecycle, exit status, signal and timeout/cancel
flags. `run-review.mjs` and evidence command capture retain their own child
handle; SIGINT/SIGTERM or the bounded timeout stop only that child, escalating
after one second if it resists. Supply `--timeout-ms` for a different command
budget (default 30 minutes). A cancelled/timed-out command never counts as a pass,
even when its handler exits zero. These budgets do not authorize retries.

Process tables and global argument dumps can expose unrelated credentials.
Do not enumerate process arguments or terminate processes by command/path
patterns, guessed PIDs or a saved PID alone. Without the original owned handle,
leave the process alone and report the limit. Native host tasks use their launch
session handle. Children or shared daemons without separately established
ownership are outside cancellation scope. Diagnostics never print argv,
environment, credentials or private provider payloads; inspect private raw logs
locally and redact before sharing. A credential exposure requires a sanitized
incident report; rotation needs the operator's authorization.

### Required gate and delivery approval

`reviews_approved` takes all exact-head, scoped receipts and moves REVIEWING to
VALIDATING. Missing slots, findings, stale heads or missing focused checks block
that event. It preserves focused evidence separately as `focusedValidation`.
Only then approve a passing gate for the approved head and frozen base. Full
is the default for a separate gate. New simple or standard deliveries reuse
approved focused checks when the evidence matches the exact pair, is fresh and
covers the required local checks for the actual diff.

`review_approved` requires VALIDATING and either a validation object or
`{"useReviewedFocused":true}` when the actual simple or standard change
qualifies. The CLI derives the
`reviewed-focused` gate from the stored hashed checks, then verifies the original
focused bundles at approval, shipping and archival. It captures no new test run.

For a separately executed gate, use this validation object:

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
    receipt: <raw-gate-bundle/receipt.json>
receipt: <auditable-receipt-path>
binding: <binding-path-if-validationProof-is-configured>
```

The event verifies the project's binding when configured before entering
APPROVED (delivery approval). Gate failure leaves VALIDATING, with no shipping
authorization. `start_shipping` checks the same evidence again without rerunning
the gate; with a verifier it also compares the saved binding/receipt hashes.
Receipt expiry and project-specific coverage are enforced by the verifier or the
project's audited process. The CLI checks the evidence and Git identity. If an
approved reused proof expires before merge, a refresh requires a newly executed
required gate or renewed validation and review under the project policy.

Every new commit invalidates code approvals and gate evidence; a changed base
invalidates the pair too. Unexpected Git changes require reconciliation and fresh
review, never silent edits to frozen SHAs. A gate-triggered correction follows
the existing bounded rework process after confirmed findings; unresolved scope
or state mismatches require a human. Keep approvals and gate status distinct.

### Confirmed findings after a failed gate

Use the native `gate_findings` event for a confirmed blocker discovered after
`reviews_approved`, while VALIDATING. Supply every exact-head reviewer slot in
`receipts` and the same structured, deduplicated `findings` used by
`review_findings`. A findings receipt supersedes that slot's prior approval;
retain every other slot's original receipt unchanged. Never create a passing
receipt from the failed run.

The additional `failedGate` object contains the raw `gate` bundle's `receipt`
path (relative to the delivery worktree) and its `receiptSha256`. Verification
requires the frozen card/base/head, matching live clean branch/worktree snapshot,
unchanged sources, hashed stdout/stderr/process logs, and an actual completed
nonzero command exit. Cancelled or timed-out commands are not defect evidence.
The gate must have run after the saved exact-head approvals. Stored successful
focused checks and their previously recorded hashes are reverified. Recovery
requires the recorded `policy.evidenceRequired: true`; older policies require
human reconciliation without silently changing their policy. Default
passing-evidence verification remains strict.

An existing NEEDS_HUMAN stop can use this same event only with explicit human
authorization, supplied as `authorization: {reference: <decision-reference>,
reason: <authorized-resume-reason>}` with both strings non-empty. Its last history
entry must be `needs_human` from VALIDATING, the failed gate must precede that
stop, and its reason must be `required_gate_failure` or the legacy workflow code
`workflow_missing_transition_VALIDATING_to_REWORKING_after_required_gate_failure`
(optionally followed by `:` or `;` and details). Other terminal states, provenance,
reasons, missing proof, stale heads and exhausted rework budgets cannot resume.

```bash
node .agent-workflow/bin/delivery-state.mjs event --repo <state-repository> \
  --card PROJ-123 --event gate_findings --payload-file <private-payload.json>
```

When upgrading the consumer first would dirty the exact delivery head, execute
the same `workflow/orchestrator/delivery-state.mjs` from a reviewed canonical
source commit, with `--repo` pointing to the existing consumer state repository.
Do not edit state JSON, initialize again, reset counters or change frozen SHAs.

The event retains the old approvals, failed validation, terminal entry, original
reason and human authorization in local `gateFailures`. It preserves all history,
limits, fingerprints, escalation and routing. Checkpoints expose terminal reasons
and the latest failed gate without publishing obsolete approvals. Within budget,
it enters REWORKING; a VALIDATING delivery at its limit stops NEEDS_HUMAN.
Rework must produce a new head with passing focused proof, all fresh independent
review slots and a newly executed full gate before delivery approval and shipping.
Reviewed-focused reuse cannot replace that gate. Historical failed receipts stay
failed and must be retained with the delivery's evidence archive. Before DONE,
the CLI verifies every recorded failed bundle against its historical base/head,
branch/snapshot, receipt hash and raw file hashes, even after worktree removal.

### Confirmed PR findings before merge

A confirmed P0-P2 PR blocker discovered in SHIPPING uses `shipping_findings`,
never a synthetic gate failure or a manual state reset. This event is limited to
format 2 with recorded `policy.evidenceRequired: true`, a live clean unchanged
worktree and the current open, unmerged PR on the frozen head. DONE, merged PRs,
terminal stops and other phases cannot use this path.

Immediately before recording the event, capture an actual read-only provider
query through the existing command evidence helper, for example:

```bash
node .agent-workflow/bin/delivery-evidence.mjs run --repo <worktree> \
  --card PROJ-123 --base <frozen-base> --head <approved-head> --kind premerge -- \
  gh pr view <number> --repo <owner/repository> \
  --json number,url,headRefOid,headRefName,baseRefName,state,mergedAt
```

Its stdout must be one JSON object with positive `number`, HTTPS `url`, exact
`headRefOid` and `headRefName`, configured `baseRefName`, `state: "OPEN"` and
`mergedAt: null`. The URL repository/number must match the configured Git remote.
The bundle must follow `start_shipping`, with a successful completed command,
clean unchanged snapshot and hashed raw stdout/stderr/process files. The helper
verifies capture integrity, not provider authenticity; the orchestrator must
inspect that this was the actual provider query and confirm the blocking thread.
Do not capture credentials or private product payloads. A connector-only export
must first be retained locally and queried through a real auditable command;
`collect` or an invented passing command cannot substitute for provider evidence.

Supply `pr: {number, url}`, `premergeProof: {receipt, receiptSha256}`, every
exact-head independent slot in `receipts`, and the complete deduplicated
confirmed `findings`, using the review blocking policy. Findings receipts
supersede their own approvals; unaffected slots retain their original receipt.
Both passing focused and gate checks and their stored hashes are reverified.
When configured, `validationProof` is also reverified against its saved hashes.
The first PR association may be recorded here because older SHIPPING states
have `pr: null`; an existing PR association must match. Never attach an unrelated
PR, change the frozen pair or reuse evidence after a provider/head change.

The event preserves previous PASS validation, focused proof, approvals, PR and
snapshot in private `shippingFindings`. Existing CI, migration/rollout references,
limits, fingerprints and history remain intact. It makes no claim that the old
gate failed, cancels no CI and reruns no migration. The generated checkpoint
exposes only compact recovery provenance and removes reviewer receipts while
reworking/reviewing. Publish and reread that sanitized checkpoint before dispatch.
The normal recorded budget applies. At its exact limit only an explicit human
`reworkAuthorization` with `additionalCycles: 1` can authorize one further cycle;
without it the event stops NEEDS_HUMAN. No terminal recovery or automatic budget
extension is added.

Rework requires a new commit and passing focused proof. Every slot must review
the complete card diff in a fresh context, then a newly executed full gate must
follow those reviews before approval and shipping. Old approvals, CI and the
old PASS remain historical evidence of their original head. Observe required CI
on the new PR head; reconcile any already-applied migration with project rules,
without replaying it solely because rework occurred. Archive all original
focused/gate/premerge bundles as well as new evidence before cleanup. Before
DONE the CLI revalidates their recorded hashes, pair and snapshot, including
after worktree removal. Historical bindings/rollout artifacts still follow the
project's archive/completion rules.

### Rework

At the recorded limit, an explicit human decision may authorize one additional
correction and its independent review round within the same accepted scope.
Supply `reworkAuthorization` in the existing `review_findings` (REVIEWING) or
`gate_findings` (VALIDATING), or `shipping_findings` (SHIPPING before merge)
payload, alongside every exact-head reviewer slot,
complete confirmed blockers and, for a gate failure, the verified failed bundle:

```json
{"reworkAuthorization":{"reference":"<human-decision-reference>","reason":"<authorized-bounded-correction>","additionalCycles":1}}
```

Both strings must be non-empty. The engine records the decision; it never infers
human permission from a blocker, standing policy or retry request. The orchestrator
must verify that the cited human instruction authorizes this correction. This
field is rejected before the effective limit, after it, or in a terminal state;
it adds no terminal recovery path. SHIPPING additionally requires the verified
open-PR premerge proof described above. Without it, the existing limit stops at
NEEDS_HUMAN. The automatic `policy.maxReworkCycles` and all consumed counters,
escalations, fingerprints, prior evidence and history remain intact.
Local `reworkAuthorizations` retain each decision's reference, reason, event,
timestamp, exact base/head, current counter and old/new effective limits. Each
decision increases that limit by exactly one. The summary/checkpoint exposes the
latest decision and effective limit. Never edit state JSON or reset counters.
After the new commit, successful focused proof, every fresh independent review
slot, a newly executed full gate and the existing evidence archive are mandatory;
focused reuse and reduced gates cannot replace that full gate.

Input: card ID, worktree, current reviewed head, cycle, exact route, and confirmed
structured findings only. Output the new commit, findings addressed, focused
validation, and unresolved blockers. Rework never runs the next review; the
required gate remains mandatory before approval and shipping. Full is the default;
either form of reduced gate requires a tested project policy as described in the
integration contract.

### Shipping

Input: card ID, worktree, frozen base SHA, approved head, validation, and required
review receipts for that exact head. Shipping may push, open/update the PR, wait for CI, merge when
repository rules allow it, verify deployment, update the tracker, and clean the
worktree. It never edits application code or manufactures review evidence.

## Durable persistence

### Prepared isolation and raw evidence

Prepare the worktree, install and allowed environment files sequentially and
fail fast. Before local init, tracker transitions or phase dispatch, confirm a
linked worktree at its root, owned by the same Git repository, on the intended
branch and clean frozen base. CLI init validates this, refuses existing state or
checkpoint files and sets `policy.evidenceRequired: true`; start_implementation
rechecks preparation. Never reset counters through init. Existing states retain
their recorded policy and historical evidence; do not inject fabricated bundles.

Use the installed helper to capture actual commands without shell interpolation:

```bash
node .agent-workflow/bin/delivery-evidence.mjs run \
  --repo <worktree> --card PROJ-123 --base <full-base-sha> --head <full-head-sha> \
  --kind focused -- npm test
```

Use `regression` for the expected red execution, `precommit` for requirements
run before commit, `focused` after commit and `gate` after code approval. The
helper preserves stdout/stderr and exit status in unique ignored private bundles
under `.delivery/evidence/<CARD>/`, with timestamps, actual Git identity, dirty
status, source/index fingerprint and SHA-256 file hashes. Source mutations during
capture invalidate the result. A dirty precommit/red run can be retained but
cannot establish passing focused/gate evidence for a commit. Where project
instructions permit it, run the focused handoff checks once on the committed clean
head. Any later commit needs its own proof.

Before executing a required check, inspect its existing raw receipt. Verify the
same card, scope/command, base/head, kind, clean unchanged sources and raw hashes
with `delivery-evidence.mjs verify`; also enforce project freshness, environment
and coverage requirements. The state CLI's `review-ready` and phase events check
the live worktree and stored receipt hashes. Verification does not execute the
captured command. A phase/agent handoff alone is no reason to rerun a passing
check. Reviewers independently assess the same objective bundles. Execute again
only for missing/invalidated proof, an explicit project requirement or a concrete
defect/coverage gap. Retain failed evidence; never retry merely to obtain green.
Do not promote precommit or previous-head proof to focused/gate evidence, or
substitute focused proof for a separate gate outside `reviewed-focused` eligibility.
Critical work and gate/premerge/human-authorized recovery still require their
full gates.
Required CI in another environment remains separate validation.

To inspect cost, use `delivery-state.mjs show` for registered receipt paths and
read the bundles' `startedAt`, `finishedAt`, `command`, `kind` and result. Count
one execution per original command bundle, deduplicating repeated references and
archived copies by the original path and receipt hash. `verify`, `review-ready`
and state transitions are verification/reuse, not new test executions. Compare
separate bundles for the same command/pair/environment to investigate repeats;
keep local runs and CI distinct. Timestamps describe captured elapsed time, not
measured savings; report savings only from a comparable before/after measurement.

Each validation check carries the helper's returned `command`, `exitCode` and
`receipt`. New evidence-required states verify their card/base/head/kind, clean
snapshot and raw files at implementation/rework handoff, review-ready, approval
and shipping. Missing, stale or altered files block advancement. Project gate
policy, coverage and authenticity remain the phase/reviewer's responsibility;
the helper is a capture/checksum mechanism, not an independent test oracle.

For tool-produced screenshots, console exports, baseline/current render files
and temporary comparison sources, capture explicit files before deleting them:

```bash
node .agent-workflow/bin/delivery-evidence.mjs collect \
  --repo <worktree> --card PROJ-123 --base <full-base-sha> --head <full-head-sha> \
  --kind browser -- <screenshot> <console-export> <fixture-source>
```

Collect returns `captured`, never a test pass. A byte-equality claim also needs
the comparison command's raw execution and both compared files; saving only the
final HTML is insufficient. List every supplementary bundle (including red and
precommit runs) as `{receipt: <path>}` in `validation.artifacts`. The CLI records
their hashes for later archive verification. Reviewers inspect objective proof
without reading implementation narratives. Read-only reviewers request any new
logged command execution from the orchestrator when their host cannot preserve
raw output; they retain independent judgement.

Before cleanup, shipping copies the entire evidence directory to an archive
outside the worktree. Verify copied files with `delivery-evidence.mjs verify
--repo <entry-repo> --card <CARD> --base <base> --head <head> --kind <kind>
--receipt <archived-receipt>`. `shipped` requires `evidenceArchive` on new states
and verifies registered focused, gate and supplementary bundles against stored
hashes, even after worktree removal. Artifacts stay local and ignored. Use fixture
data; never pass secrets in command arguments or capture credentials/private
production payloads. Inspect/redact material before sharing it externally.

Inline intake or explicit hardening writes one tracker comment marked
`<!-- delivery-routing:v1 -->`. It holds the classification evidence and exact
route. Delivery owns one idempotent comment
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

### Compatibility with deliveries started before 0.8.0

State format remains 2. Existing approved receipts with absent or empty findings
remain compatible; update never rewrites runtime/checkpoints or resets counters.
Preserve historical receipts. Before resuming pending old findings, reconfirm each
against the blocking policy and recover its real evidence. P3-only, incomplete or
ambiguous pending blockers require human reconciliation, not silent removal or
synthetic approval. New review receipts and rework events must follow the current
policy. Format 1 delivery recovery still follows the rules below.

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
