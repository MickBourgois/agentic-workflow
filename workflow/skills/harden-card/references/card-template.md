# Hardened Card Template

Keep the card's existing structure when the outcome and how to verify it are
clear. Use these prompts only for missing content. Reference applicable project
rules instead of copying their checklists.

```markdown
## Expected outcome
<Observable behavior and the scope needed to understand it.>

## Acceptance
<The smallest observable cases needed to decide whether the change is done.>

## Proof
<A focused check or smoke if the way to verify acceptance is unclear.>
```

Add `Risks / dependencies`, `Agent guardrails` or `Human validation required`
only when a concrete risk, dependency, unsafe shortcut or human-only proof applies.
State migration/rollout order, partial failures, identity/access boundaries and
provider limits when they change. Omit irrelevant sections instead of adding
`Not applicable` boilerplate. Optional ideas stay outside acceptance criteria.

Provider work uses fixtures, sandbox, or documented manual proof. CI does not
depend on live production providers. Keep complexity and routing in the marked
routing comment.
