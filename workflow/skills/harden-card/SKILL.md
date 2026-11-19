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
`agent-workflow.config.json`, `references/hardening-rubric.md`, and
`references/card-template.md` completely.

## Intake

1. Require explicit target cards; never select unrelated backlog.
2. Require a configured Linear team and issue CRUD. Fetch each full description,
   comment, label, status, and native relation.
3. Inspect the relevant code and project decisions needed to resolve a gap or
   classify impact. Cite `path:line` for non-obvious claims.

If the ticket set does not exist, stop and direct the user to their planning or
ticket-creation workflow.

## Readiness gate

Apply relevant rubric branches to the smallest observable success. Each mandatory
addition must cite an accepted requirement, applicable project rule or credible
failure mode in the changed scope. Keep polish, alternative designs, speculative
future needs and unrelated cleanup optional, outside acceptance criteria.

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

After approval, patch only unresolved gaps. Keep the existing structure and
wording where they already explain the outcome and its proof. Use the template
for missing content. A ready card's description may need no change. Optional
suggestions require explicit scope approval before becoming acceptance criteria.
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
