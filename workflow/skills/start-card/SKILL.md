---
name: start-card
description: Start or resume one explicit card through readiness, fresh implementation, independent review, and shipping.
disable-model-invocation: true
---

# Start One Card

You are the card orchestrator, not an implementer. Read project instructions,
`agent-workflow.config.json`, `.agent-workflow/contracts/delivery.md`, and
`.agent-workflow/contracts/tracker-linear.md`. Read effective settings using
`node .agent-workflow/bin/agent-workflow.mjs config`.

An explicit card ID is mandatory. Never query the backlog for another card.

## 1. Preflight and reconcile

1. Require configured tracker team and Linear issue CRUD before changing Git.
2. Fetch the full card, relations, labels, comments, and status.
3. Find any marked checkpoint and `.delivery/state/<CARD>.json`. Reconcile
   existing deliveries with their saved routing/limits and live Git, PR, CI,
   and merge evidence. Return an existing terminal result immediately unless an
   explicit human decision authorizes the delivery contract's narrowly scoped
   `gate_findings` recovery of a failed validation gate. Treat an
   existing checkpoint with missing local state as a recovery case.
4. For a new delivery, require zero open native blockers, no needs-info or
   other project execution hold, and the configured ready or backlog state.
5. Reuse an existing valid route if its scope/risk still matches. Contradictory,
   duplicate, or stale routing requires reconciliation before execution.

## 2. Prepare or resume isolation

One card owns one branch, worktree, and PR.

- Inspect `git worktree list`; preserve dirty, active, or unmerged worktrees.
- Fetch the configured remote/base and require a clean, uncontaminated base.
- Before creating a worktree for a new inline delivery, read the relevant code
  on that base. Verify the intended outcome and how it can be observed, check
  that this is one reviewable change, and look for critical overrides. Use
  accepted criteria, referenced specifications and actual project rules.
  Preserve the card wording and ask only about a decision that blocks execution.
  Return `needs_human` with the specific gap if readiness or scope is unclear.
  `/harden-card` is available for deliberate refinement. For a card without
  routing, classify using the delivery contract and resolve the route with the
  installed engine. Keep evidence brief for zero-score dimensions.
- Create/resume under configured `worktree.root` using the configured branch
  pattern. Resume durable state instead of duplicating it.
- Stop immediately on preparation failure. Do not initialize local/tracker state,
  change tracker status, or dispatch a phase after a failed Git/install/copy step.
  Await each step or use a fail-fast shell; never append state commands to an
  unguarded shell block. Verify the existing worktree root, owner repository,
  branch, clean contents and frozen base before proceeding.
- Run the detected/configured install command when present.
- Copy only file names listed in `environment.copyFiles`, without printing
  contents. Surface configured safety warnings before mutable smokes.
- After all preparation succeeds, persist and reread one marked
  `delivery-routing:v1` comment when new routing is needed. Follow the tracker
  contract; inline intake needs no hardened label or card description edit.
  Use `delivery-state.mjs init` with explicit
  worktree, branch and full base SHA. Init refuses an existing state/checkpoint;
  resume instead. Only after successful init may the workflow transition to
  IMPLEMENTING, update this card's tracker status and publish its checkpoint.
  `start_implementation` rechecks the prepared worktree before persisting state.

## 3. Dispatch implementation

When no durable implementation commit exists:

1. Transition `READY -> IMPLEMENTING`.
2. Spawn the project `implementer` agent with no inherited turns.
3. Pass only card ID, repository/worktree, branch, base SHA, and the validated
   implementation model/reasoning. Require the repo-local `/implement` skill.
4. Resolve its commit and persist objective validation. Do not forward its notes
   to reviewers.

Use the raw evidence protocol in the delivery contract. New deliveries require
an actual clean committed-head `focused` capture per recorded check; a narrative,
precommit fingerprint or renamed receipt cannot satisfy `review-ready`.

Two matching failure fingerprints trigger the one bounded escalation and one
fresh-context retry. A further match becomes `NEEDS_HUMAN`.

## 4. Dispatch independent review

Transition to `REVIEWING`. Run `delivery-state.mjs review-ready --card <CARD>`
before every review dispatch, including resume. It checks recorded successful
focused checks for this head and live clean Git state; also inspect their actual
coverage and any stricter project/card requirements. Failure blocks dispatch.
Before dispatch or resume, publish and reread the
checkpoint with review receipts removed while in `REVIEWING` or `REWORKING`;
if it cannot be sanitized, stop. Each fresh reviewer receives card ID, path, base
SHA, current head SHA, and reviewer slot; a bounded rework may also supply the
slot-specific prior receipt and its reviewed head.

- simple, standard, complex: one reviewer;
- critical: reviewers A and B concurrently on their distinct routed models.

Require `/code-review` and exact-head receipts with `scope: code_and_focused_checks`.
Never pass implementation
transcripts, rationale, conclusions, or another review.
If the routed reviewer is unavailable in the host agent tool, follow the delivery
contract's CLI review dispatch using `run-review.mjs`. Inspect its raw command
events and coverage before accepting the receipt. An empty wait or failed CLI
dispatch is not a review and never authorizes a route substitution.

If every required receipt approves the current head, record `reviews_approved`
with those receipts, moving `REVIEWING -> VALIDATING`. This is code approval
only: shipping is still forbidden. Sanitize the shared checkpoint in VALIDATING
too; reviewer receipts remain in local state until delivery approval.
For a new simple or standard delivery, reuse the exact focused proofs accepted
by all reviewers as the local gate when they cover the actual diff and its
required checks. Require fresh raw evidence, known impact, and the absence of any
sensitive, uncertain or additional gate requirement. Use `review_approved`
with `{ "useReviewedFocused": true }`; the CLI re-verifies the existing receipts.
Required PR CI and deployment checks still apply. When any eligibility check
fails or the saved delivery predates this profile, run the required gate below.

Run the configured `commands.fullCheck` on the exact head unless fresh auditable
evidence of the required gate already exists. In `delivery.validationMode: full`,
execute the full gate. With explicit `project` mode, the project's tested,
fail-closed impact policy may select a reduced gate; missing, stale, ambiguous,
or sensitive impact requires the full gate. Record `validation.kind: required_gate`,
`result: passed`, frozen `base`, approved `head`, selected `profile`, policy
`reason`, non-empty executed `checks: [{command, exitCode: 0}]`, and the auditable
`receipt` path. Without a configured command, obtain the project's explicit gate
and auditable evidence; absence of a command never implies a pass.
Bind the receipt using `commands.validationProof` when configured and pass its
returned binding path in `review_approved` payload `validation.binding`. The
`review_approved` event verifies that proof before transitioning to `APPROVED`;
any failure blocks shipping. Preserve the verified binding and receipt for the
final archive.
When a new gate execution is needed, capture it through
`delivery-evidence.mjs run --kind gate` and include its
raw bundle receipt in each check's `receipt`, using the returned `command`.
Retain the separate project policy receipt/binding when configured.
On a gate failure stay in VALIDATING; do not dispatch shipping. For confirmed
blocking defects use `gate_findings` with all exact-head scoped reviewer receipts,
deduplicated findings and `failedGate: {receipt, receiptSha256}` for the real failed
raw bundle. Retain unaffected slots unchanged. This native event verifies the live
snapshot and previously hashed focused evidence, preserves the failed gate and
old approvals, and applies the recorded rework budget. An existing NEEDS_HUMAN
validation stop additionally requires a human authorization reference and reason,
with the exact provenance and reason codes documented in the delivery contract.
Never edit state JSON or initialize again. A reviewed canonical source CLI may
target the consumer with `--repo` before an installation would dirty its head.
After this correction a newly executed full gate is required; focused reuse is
disabled. Any code change
requires fresh focused checks and all required reviews on the new head. Reconcile
unexpected commits/base changes with a human rather than editing frozen SHAs or
reusing old receipts. Resume VALIDATING by verifying its local exact-head
approvals and running/verifying only the missing gate, never inventing receipts
from the sanitized shared checkpoint.
Otherwise apply the delivery contract's blocking policy. Confirm each defect
with a scenario or applicable requirement and deduplicate by `(file, line,
requirement)`. The `review_findings` payload must cover every reviewed blocker
exactly once; reconcile unsupported findings with the reviewer or a human rather
than silently dropping them. Record optional `suggestions` without forcing a
cycle or creating tickets automatically. Conflicting reviews need a human.
New deliveries allow at most one automated correction and two review rounds.
Within the recorded rework limit, move the card to rework, spawn a
fresh `reworker` with confirmed findings only and require a new commit. Review
the new head independently in each required slot. After a bounded correction,
use the local state `previousReview` to pass each slot only its own previous
receipt and old/new SHAs: inspect the correction, its callers and tests, and
that slot’s previous findings; issue a new receipt
for the new head. If impact, scope, base, dependencies, or risk are uncertain or
a sensitive contract changes, review the complete card diff again. If the local
context is unavailable on resume, review the complete card diff again. Any commit
invalidates prior approvals; previous receipts are context, never approval of the
new head.

Keep settled scope/design decisions on re-review. New blockers require a concrete
defect under the same policy. Batch confirmed defects into the one allowed
correction. Preserve the rework counter on resume. At the limit, present the
remaining blockers and proposed decision to the user. Any additional review
or rework requires explicit human approval. When the existing human instruction
expressly authorizes that bounded correction in the accepted scope, record it
through `reworkAuthorization: {reference, reason, additionalCycles: 1}` in the
current `review_findings` or `gate_findings` event before a terminal stop. Follow
the delivery contract's exact-limit and proof requirements; never infer approval
or reset counters. This adds one cycle with a durable decision trace, then
requires fresh focused proof, all review slots and a newly executed full gate.

## 5. Dispatch shipping

After `APPROVED`, spawn `shipper` with no inherited turns on the fixed Sol 6.1 /
medium route. Pass only card, worktree, frozen base SHA, approved head,
validation, and exact-head receipts. Require `/ship-production-change`. Accept `DONE` only after merge on the
configured base, tracker completion, and required deployment proof.

While shipping runs, await its result using the observation ownership contract;
the shipper owns the external watch. Use compact state summaries for routine
updates and perform the independent terminal audit once.

If the shipper identifies a confirmed blocker before merge, retain SHIPPING
and use the delivery contract's native `shipping_findings` path. Capture the
current provider PR identity/head/base/open-unmerged state as a clean hashed
`premerge` command bundle after `start_shipping`; inspect the actual query and
thread. Supply `pr`, `premergeProof`, every exact-head slot, complete confirmed
findings and, only at the exact limit with an explicit human instruction,
`reworkAuthorization: {reference, reason, additionalCycles: 1}`. Keep unaffected
slot receipts unchanged. Do not manufacture a gate failure, edit state, reset
counters or expand scope. Existing terminal stops and merged PRs are ineligible.
A reviewed canonical CLI may target the existing consumer state via `--repo`
when an installation would dirty its frozen head. Publish/reread the sanitized
checkpoint, dispatch a fresh reworker, obtain new focused proof and FULL fresh
reviews in all slots, then run a NEW full gate after those reviews. Historical
PASS/CI and applied-migration evidence stay tied to their original head; preserve
and archive them without replaying deployment work. Resume shipping on the new
approved head and observe its required CI.

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
