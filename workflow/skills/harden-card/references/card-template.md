# Hardened Card Template

Keep the card's existing structure when the outcome and how to verify it are
clear. Use these prompts only for missing content. Reference applicable project
rules instead of copying their checklists.

```markdown
## Context
<Current files, routes, schemas, tests, behavior owner, blast radius, pitfalls.>

## Goal
<One user-value sentence.>

## Scope
<The bounded change and expected modules.>

## Out of scope
<Adjacent work and tempting shortcuts excluded from this card.>

## Acceptance criteria
<Observable and verifiable statements.>

## Validation
<Observable evidence or the focused command when it matters to the outcome.
For UI changes, give the browser action and expected result if necessary.>
```

Add `Risks / dependencies`, `Agent guardrails` or `Human validation required`
only when a concrete risk, dependency, unsafe shortcut or human-only proof applies.
State migration/rollout order, partial failures, identity/access boundaries and
provider limits when they change. Omit irrelevant sections instead of adding
`Not applicable` boilerplate. Optional ideas stay outside acceptance criteria.

Provider work uses fixtures, sandbox, or documented manual proof. CI does not
depend on live production providers. Keep complexity and routing in the marked
routing comment.
