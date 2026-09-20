---
name: harden-card
description: Red-team, classify, and route explicit Linear implementation cards before delivery.
disable-model-invocation: true
---

# Harden Cards

This is the Product -> Delivery gate. Produce executor-proof cards and a
deterministic route. Planning only: never implement, branch, or start delivery.

Read `.agent-workflow/contracts/delivery.md`,
`.agent-workflow/contracts/tracker-linear.md`, project instructions,
`agent-workflow.config.json`, `references/hardening-rubric.md`, and
`references/card-template.md` completely.

## Intake

1. Require explicit target cards; never select unrelated backlog.
2. Require a configured Linear team and issue CRUD. Fetch each full description,
   comment, label, status, and native relation.
3. Inspect current code, schemas, tests, routes, and relevant project decisions.
   Cite `path:line` evidence.
4. Map owners, callers, data flow, validation seams, dependencies, and blast
   radius. Discoverable facts come from the repository, not questions.

If the ticket set does not exist, stop and direct the user to their planning or
ticket-creation workflow.

## Readiness gate

Apply the rubric. A blocking product, architecture, security, or operator choice
sets the card to the configured needs-info state and blocks hardening. Split work
that cannot fit one reviewable PR. Tracker relations and prose describe the same
blockers.

## Classification and route

Use the critical overrides and score in the delivery contract. Assign exactly one
of `simple`, `standard`, `complex`, or `critical`. Record every dimension and its
evidence. For complex work, mark `high_effort` when score is at least 15 or
ambiguity, test difficulty, or regression risk scores 2+.

Use the installed routing engine for the final route; do not improvise a model:

```bash
node .agent-workflow/bin/agent-workflow.mjs route <complexity> --score <score> --dimensions '<json>'
```

## Approval-first patch

Unless the user already authorized direct edits, first report:

```markdown
Hardening result: <ready | needs edits | blocked>

Must fix before execution:
- <card>: <gap> -> <planned edit>

Suggested but optional:
- <card>: <gap> -> <planned edit>

Proposed routing:
- <card>: <complexity>, <score/override evidence>, <implementation>, <review>

Questions:
- <blocking questions only>
```

After approval, bring the description to the card template. Preserve approved
functional wording. Routing metadata belongs in the routing comment, not the
description.

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
