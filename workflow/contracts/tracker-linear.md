# Linear Tracker Adapter

Version 0.1 supports Linear. Project-specific team, status, label, and card-ID
values live in `agent-workflow.config.json`.

## Capability gate

Probe for issue read/write, comments, labels, statuses, and native relations
before changing Git. A generic connected indicator is insufficient. If the
session lacks issue CRUD, name the unavailable provider/capability and stop.

Every query is scoped to the configured team. A null `tracker.team` is an
incomplete project setup and blocks hardening, start-card, and backlog selection.

## Roles

- statuses represent delivery progress;
- labels represent triage/readiness and may coexist with any status;
- native blocker relations are the authoritative dependency graph;
- routing and checkpoint comments hold structured workflow state.

Never create a missing label automatically. Apply existing labels, report missing
ones, and stop only when the missing label is essential. The routing comment is
authoritative when optional complexity labels are absent.

## Completion

A card reaches the configured `done` status only after the merge is confirmed on
the configured base branch and required deployment checks pass. An open or green
PR is not completion.
