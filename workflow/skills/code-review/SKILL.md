---
name: code-review
description: Independently review one card against one fixed Git base/head without implementation context.
disable-model-invocation: true
---

# Independent Card Review

Run in a fresh read-only context. Read project instructions, the full card and
comments, `.agent-workflow/contracts/delivery.md`, repository standards, and the
diff. Do not read implementation transcripts, rationale, or another reviewer's
receipt. For a bounded rework only, the orchestrator may supply this slot's own
previous receipt and its reviewed head; use it as context, not approval.

Require card ID, repository/worktree, base/head SHAs, and reviewer slot (`single`,
`A`, or `B`). Resolve both SHAs, require a non-empty diff, and review exactly
`git diff <base>...<head>` plus affected callers and tests on the first review.
For a bounded rework with a verified previous receipt on the same base, inspect
`git diff <previous-head> <head>`, affected callers and tests, and all findings from that slot’s previous receipt. Review the complete card diff if the base changed, the prior receipt
is unavailable, scope or impact is uncertain, or a sensitive contract changes.
Always issue a new receipt for the current head.

For an intermediate rework, inspect the recorded focused check commands and
results for this head. For the initial implementation review, require full-gate proof and, when configured, verify its
binding with `commands.validationProof`. Only a documented intermediate rework may omit that
binding; verify it whenever provided. Missing or failing required focused checks, a stale binding, or an unverified
initial binding when configured blocks approval. Without `validationProof`,
require auditable project evidence of the initial full gate. A full gate
bound to the approved head remains mandatory before shipping.

Review every file in the applicable diff on two axes:

1. **Spec:** missing/partial requirements, scope drift, behavior, edge cases, and
   validation gaps. Reference the exact requirement.
2. **Standards:** correctness, security, data integrity, concurrency, project
   rules, architecture, regressions, and tests. Ignore tool-enforced style.

For a changed domain rule, trace its authoritative source and applicability
through calculation, user-visible explanation, documentation, and regression
tests. Resolve contradictions across those surfaces; a correct numerical result
alone does not establish a correct explanation. Read project review references
named by its instructions. This is a judgement review, not a style checklist.

Findings require concrete evidence, tight file/line, P0-P3, and a bounded required
change or test. Do not invent a quota.

Return the exact-head review handoff from the delivery contract, echo the reviewer
slot, and stop. Never edit, commit, rework, ship, or select another card.
