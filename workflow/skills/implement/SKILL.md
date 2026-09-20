---
name: implement
description: Implement, validate, and commit exactly one prepared card in its existing worktree.
disable-model-invocation: true
---

# Implement One Card

Run in a fresh implementation context. Read project instructions, the explicit
card, relevant domain docs, `agent-workflow.config.json`, and
`.agent-workflow/contracts/delivery.md`. The card, repository, and Git state are
authoritative; do not consume earlier-agent transcripts.

Require card ID, worktree/branch, base SHA, and model/reasoning route. Stop as
`needs_human` if inputs are missing, isolation is shared, or the card is not
hardened and in the configured implementing state.

1. Confirm worktree, branch, base, and clean starting state. Preserve unrelated
   user work.
2. Map acceptance criteria to tests and the smallest changes.
3. Use TDD at declared seams where practical; prove required regression tests fail
   before the fix.
4. Implement only the card.
5. Run focused proof, card validation, then configured `commands.fullCheck`. An
   unavailable required check is a blocker, not a pass.
6. Review the staged diff for scope and secrets, create one card-referencing
   commit, and record its SHA.
7. Persist objective validation and transition the checkpoint to `REVIEWING`.

Return the implementation handoff from the delivery contract and stop. Do not
review, rework, push/merge a PR, or select another card.
