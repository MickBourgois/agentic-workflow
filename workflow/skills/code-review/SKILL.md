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

On re-review, verify prior blockers, the correction and its induced regressions.
Preserve accepted scope and settled design choices. A newly discovered concrete
defect still blocks under the delivery contract's blocking policy, including on
a required full-diff re-review; explain its scenario and impact. An alternative
design or extra coverage without a demonstrated defect stays optional.

For both initial and rework reviews, require recorded successful focused checks
for this exact head. Inspect actual commands, results and their coverage of the
change, acceptance criteria and project/card requirements. Missing, unavailable,
failing or insufficient required checks block approval, including any build or
early full gate explicitly mandated by stricter instructions. The workflow does
not otherwise require `commands.fullCheck` or a gate binding before review.
Never use a partial or stale gate receipt as evidence of successful validation.
Judge the accepted outcome and regressions introduced by this change. Cite the
accepted criterion, applicable project rule, or previously working behavior for
each blocker, and show the failure and its consequence. Pre-existing defects
outside the change and extra acceptance criteria are optional feedback. An
approval can end with zero findings and zero suggestions.
For new evidence-required deliveries, inspect the raw focused bundles and their
hashes using `delivery-evidence.mjs verify`. Review remains read-only: if another
check is needed and the sandbox cannot retain its raw output, request that exact
command from the orchestrator, then inspect the resulting clean-head capture.
Do not substitute a tool-session identifier or a prose summary for durable logs.
Return `scope: code_and_focused_checks`: this approves code and focused evidence,
not the final gate or delivery. The orchestrator must obtain and verify the
required gate on this exact base/head after all slots approve.

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

Apply the delivery contract's blocking policy. Return only evidenced P0-P2
blockers in `findings`, with tight file/line and a bounded correction or test.
Put optional P2-P3 advice in `suggestions`. Approve when no blocker remains,
including with suggestions or no remarks. Do not invent a quota.

Return the exact-head review handoff from the delivery contract, echo the reviewer
slot, and stop. Never edit, commit, rework, ship, or select another card.
