# Hardened Card Template

Every section is present. Use `Not applicable: <reason>` instead of an empty
section.

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
<Exact focused commands and the project full-check command.>

## Browser / app validation
<Setup, actions, functional/visual result, console/network checks, pass/fail;
or `Not applicable: <reason>`.>

## Tests
<Named tests to add/update, or the strongest practical alternative.>

## Regression proof
<Test or smoke path; or `Not added: <reason>` and alternative proof.>

## Risks / dependencies
<Native tracker relations, migration order, rollout, provider constraints.>

## Agent guardrails
<Explicit shortcuts the executor must avoid, with reasons.>

## Human validation required
<Yes/no and the exact evidence an agent cannot legitimately obtain.>
```

Provider work uses fixtures, sandbox, or documented manual proof. CI does not
depend on live production providers. Keep complexity and routing in the marked
routing comment.
