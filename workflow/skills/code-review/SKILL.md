---
name: code-review
description: Independently review one card against one fixed Git base/head without implementation context.
disable-model-invocation: true
---

# Independent Card Review

Run in a fresh read-only context. Read the card's accepted requirements,
relevant decisions in its comments, project rules that apply to the change,
and `.agent-workflow/contracts/delivery.md`. Keep implementation transcripts
and other reviewers' receipts outside the review.

Require card ID, repository/worktree, base/head SHAs, and reviewer slot (`single`,
`A`, or `B`). Resolve both SHAs, require a non-empty diff, and review exactly
`git diff <base>...<head>` on the first pass. Follow changed behavior into
directly affected callers and tests where needed to judge impact.
For a bounded rework with a verified previous receipt on the same base, inspect
`git diff <previous-head> <head>`, affected callers and tests, and all findings from that slot’s previous receipt. Review the complete card diff if the base changed, the prior receipt
is unavailable, scope or impact is uncertain, or a sensitive contract changes.
Always issue a new receipt for the current head.

On re-review, verify prior blockers, the correction and its induced regressions.
Preserve accepted scope and settled design choices. A newly discovered concrete
defect still blocks under the delivery contract's blocking policy, including on
a required full-diff re-review; explain its scenario and impact. An alternative
design or extra coverage without a demonstrated defect stays optional.

Require successful focused checks on this exact head. Verify required raw
bundles with `delivery-evidence.mjs verify`, and judge whether the evidence
covers the actual change and its binding requirements. Reuse an existing test
or smoke when it covers the case. Request another command only for a concrete
gap or defect that needs proof. The orchestrator can capture that command
when the reviewer cannot retain logs. The final gate belongs to the next phase.

Use one pass to check whether the accepted outcome works and find regressions
introduced by the diff. For a changed domain rule, follow the actual rule into
affected calculations, explanations and proof. Expand the investigation only
when the diff or evidence points to a material impact. Avoid folding unrelated
cleanup, preferred designs, theoretical edge cases or duplicate tests into the
review.

For each blocker, name the scenario, the accepted requirement or existing
behavior it violates, and the concrete consequence. A P2 requires a material
defect or missing binding proof. Combine related defects that share a fix in
one actionable finding. Return suggestions only when useful to the user.
Approve immediately when the required evidence covers the accepted behavior
and no blocker remains. Empty findings and suggestions are valid.

Return the exact-head handoff with `scope: code_and_focused_checks` and the
reviewer slot. End the review there.
