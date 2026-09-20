---
name: code-review
description: Independently review one card against one fixed Git base/head without implementation context.
disable-model-invocation: true
---

# Independent Card Review

Run in a fresh read-only context. Read project instructions, the full card and
comments, `.agent-workflow/contracts/delivery.md`, repository standards, and the
diff. Do not read implementation transcripts, rationale, or another review.

Require card ID, repository/worktree, base/head SHAs, and reviewer slot (`single`,
`A`, or `B`). Resolve both SHAs, require a non-empty diff, and review exactly
`git diff <base>...<head>` plus affected callers and tests.

Review every changed file on two axes:

1. **Spec:** missing/partial requirements, scope drift, behavior, edge cases, and
   validation gaps. Reference the exact requirement.
2. **Standards:** correctness, security, data integrity, concurrency, project
   rules, architecture, regressions, and tests. Ignore tool-enforced style.

Findings require concrete evidence, tight file/line, P0-P3, and a bounded required
change or test. Do not invent a quota.

Return the exact-head review handoff from the delivery contract, echo the reviewer
slot, and stop. Never edit, commit, rework, ship, or select another card.
