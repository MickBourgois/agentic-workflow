# Card Hardening Rubric

Find what the card forgot. Apply relevant branches; this is not a mandatory
expansion checklist.

## Severity

- **Must fix:** hidden decision, likely drift, data/security/privacy risk,
  ambiguous partial failure, impossible validation, missing true dependency.
- **Should fix:** weak acceptance criteria, unclear UX state, edge-case gap,
  vague validation, missing guardrail.
- **Optional:** polish and additional low-risk proof.

## Universal

- What problem is solved, and what is the smallest observable success?
- Which files/modules own it, who calls them, and what must remain untouched?
- Can an executor start from the card and repository with zero chat context?
- Is it one reviewable PR with exact validation and bounded guardrails?
- Which score or critical override is supported by repository evidence?

## Product and interface

Entry point, defaults, loading/disabled/error/empty states, cancel/back behavior,
success destination, duplicate prevention, append/replace/delete semantics,
responsive behavior, keyboard/focus/labels, localization and overflow.

## Data and persistence

Request/response shape, limits, source of truth, transaction and partial-success
semantics, idempotency, ordering, timestamps/time zones, migration/backfill and
rollback, optimistic identifiers, integrity, locking, corruption, and data loss.

For access-controlled storage, name the caller identity, policy changes,
cross-account behavior, privileged clients, and read/write scope.

## Async and providers

Success, timeout, validation failure, retry/replay, restart, rate limit,
out-of-order delivery, duplicate prevention, rollback scope, user-visible pending
state, cost amplification, signatures, and sandbox/manual proof.

## Security, billing, privacy

Authorization and privilege changes, server-side enforcement, payment/credit
state, PII in logs/events, consent, secret handling, and irreversible effects.
Any changed safety-sensitive contract is a critical-override candidate.

## Tests and delivery

Regression test red-before/fix-after where appropriate; focused versus full
checks; concrete browser smoke; proof without production mutation; layers,
coupling, ambiguity, regression probability, test difficulty, and blast radius.

## Dependencies

Every blocker is a true execution blocker. Parallel work stays parallel. Prose
and native tracker relations agree.
