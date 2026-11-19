---
name: harden-card
description: Resolve concrete readiness gaps and route an explicit Linear implementation card.
disable-model-invocation: true
---

# Harden Cards

Use this when a card needs clarification. An executable card goes directly to
`/start-card`. This skill only prepares the card and its route.

Read `.agent-workflow/contracts/delivery.md`,
`.agent-workflow/contracts/tracker-linear.md`, project instructions,
`agent-workflow.config.json`. Use the rubric only to resolve an identified
gap or assess a concrete risk. Use the template only if the card lacks a
usable description.

## Intake

1. Require explicit target cards; never select unrelated backlog.
2. Require a configured Linear team and issue CRUD. Fetch each full description,
   comment, label, status, and native relation.
3. Inspect the relevant code and project decisions needed to resolve a gap or
   classify impact. Cite `path:line` for non-obvious claims.

If the ticket set does not exist, stop and direct the user to their planning or
ticket-creation workflow.

## Readiness gate

Stop expanding the card as soon as it has an observable outcome, a bounded
change and a practical way to verify it. A concise existing description is
enough. Leave routine implementation choices to the implementer.

Add a criterion only when its omission could make the accepted behavior
ambiguous, leave a material regression unchecked, or violate a binding project
rule. State the observable outcome or invariant in one sentence. Link to
existing requirements and test conventions instead of copying them. Treat
polish, speculative edge cases and alternative designs as out of scope.

A blocking product, architecture, security, or operator choice
sets the card to the configured needs-info state and blocks hardening. Split work
that cannot fit one coherent reviewable PR; keep behavior and its proof together.
Avoid splitting merely by file count or creating extra gates for dependent
fragments. Tracker relations and prose describe the same blockers.

## Classification and route

Use the critical overrides and score in the delivery contract. Assign exactly one
of `simple`, `standard`, `complex`, or `critical`. Record every dimension and its
evidence. For complex work, mark `high_effort` when score is at least 15 or
ambiguity, test difficulty, or regression risk scores 2+.

Use the installed routing engine for the final route; do not improvise a model:

```bash
node .agent-workflow/bin/agent-workflow.mjs route <complexity> --score <score> --dimensions '<json>'
```

## Minimal patch

A ready card needs only routing. If an edit is needed, give the specific gap
and the smallest proposed wording. Ask before changing the card description
unless the user already authorized editing it. Ask only decisions that block
execution. Keep the existing structure and wording when possible. Optional
suggestions require scope approval before becoming acceptance criteria.
Store routing metadata in its marked comment.

## Persist

For each ready card:

1. Apply configured hardened and ready-for-agent labels; remove needs-info when
   resolved. Never create labels automatically.
2. Update the existing comment containing `<!-- delivery-routing:v1 -->`, or
   create one when absent. Never duplicate it.
3. Store compact YAML with: complexity, score, `high_effort`, critical override,
   risk factors, every scored dimension and reason, implementation route, and
   reviewer count/routes.
4. If all four configured complexity labels exist, apply exactly one; otherwise
   report the missing labels. The comment remains authoritative.

Re-read the final card, relations, labels, and routing comment. Return changed
cards, evidence, classifications, missing labels, and the fact that application
tests did not run because no application code changed. Then stop.
