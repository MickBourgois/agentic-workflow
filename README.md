# agentic-workflow

A portable, risk-adaptive delivery workflow for agentic coding. It turns one
hardened tracker card into one isolated implementation, independently reviewed at
the card's actual risk level, reworked in bounded fresh contexts, and shipped
through normal repository gates.

The repository is the source of truth. Consumer projects receive managed copies
plus a small project-owned configuration file. Updates are checksum-aware and do
not silently overwrite local edits.

## Presentation website

Run `npm run site:dev` to open the French presentation and documentation website
at `http://127.0.0.1:4173`. Build the static files with `npm run site:build`.
See [website/README.md](website/README.md) for hosting and configuration.

## What is it?

The workflow packages:

- `/harden-card` and the legacy `/harden-project-cards` alias;
- `/start-card`, `/implement`, `/code-review`, `/rework`, and
  `/ship-production-change`;
- Codex custom agents for implementation, review, rework, and shipping;
- Claude Code command adapters for the same phase contracts;
- a deterministic `simple / standard / complex / critical` classifier and model
  router;
- state, retry, exact-head review, resume, and clean-context contracts;
- a one-card runner and an optional outer backlog loop;
- an idempotent installer/updater with a managed-file manifest.

Version 0.1 uses Linear as its tracker adapter and the Codex CLI for automated
fresh-context orchestration. The cards and codebase may belong to any product or
technology stack.

## Architecture

```text
explicit card
    |
    v
/harden-card
    |
    +--> critical safety override?
    |         |
    |         +--> critical
    |
    +--> evidence score --> simple | standard | complex
                              |
                              v
                    persisted routing comment
                              |
                              v
                     /start-card orchestrator
                              |
                   fresh implementation agent
                              |
                 exact-head independent review(s)
                       |                 |
                    approved          findings
                       |                 |
                       |          fresh /rework
                       |                 |
                       +<--- fresh review on new head
                              |
                        fresh shipper
                              |
                      PR -> CI -> merge
                              |
                    deployment proof -> DONE
```

The core seam is small: project config + a card ID enter; durable Git/tracker
evidence and a terminal result leave. Agent conversations are deliberately not
shared between implementation, review, rework, and shipping.

Repository layout:

```text
workflow/
  skills/             canonical skill contracts
  agents/codex/       custom-agent definitions
  commands/claude/    thin Claude Code adapters
  config/             generic defaults and schema
  contracts/          delivery, tracker, project integration
  orchestrator/       state machine and Codex runners
  schemas/            structured runner output
scripts/
  agent-workflow.mjs  installer/updater
  smoke-test.mjs
  scan-secrets.mjs
tests/
```

## Requirements

- Git
- Node.js 20+
- Codex CLI for automated card/backlog runs
- Linear issue CRUD exposed to the agent session
- the routed model names available on the Codex host

There are no runtime npm dependencies.

## Installation

Clone this repository, then install into a Git repository root:

```bash
./install.sh /path/to/project
```

The installer:

- verifies the target is a Git repository root;
- installs skills under `.agents/skills/`;
- installs Codex agents under `.codex/agents/`;
- installs Claude commands under `.claude/commands/`;
- installs the runtime and contracts under `.agent-workflow/`;
- creates `agent-workflow.config.json` only when absent;
- adds a marked ignore block without replacing the project's `.gitignore`;
- writes `.agent-workflow/manifest.json` with SHA-256 checksums and version.

It never reads or copies `.env`, credentials, user-level Codex/Claude settings,
or any file outside the explicit managed payload.

After installation, set the Linear team:

```json
{
  "tracker": {
    "provider": "linear",
    "team": "Your Linear Team"
  }
}
```

Commit the managed workflow files and `agent-workflow.config.json` in the consumer
project. Keep `.agent-workflow.local.json` uncommitted for machine-only overrides.

## Update

Update this source checkout, then apply the new version:

```bash
git pull --rebase
./update.sh /path/to/project
```

For each managed path, the updater compares:

1. the current file checksum;
2. the checksum recorded when it was installed;
3. the incoming source checksum.

Pristine managed files update atomically. Manually modified files remain in place;
incoming content is written under `.agent-workflow/conflicts/<run>/...` and the
command exits with status 2. Obsolete pristine managed files are moved to a
recoverable `.agent-workflow/backups/<run>/...` path. Project config, local config,
and user files are never treated as managed payload.

The installed version is available in `.agent-workflow/VERSION` and
`.agent-workflow/manifest.json`.

## Configuration

Configuration has three layers:

1. generic defaults managed by this repository;
2. `agent-workflow.config.json`, owned and versioned by the consumer project;
3. `.agent-workflow.local.json`, owned by one machine/user and gitignored.

The workflow auto-detects the base branch, package manager, install command, and a
standard full-check script. Configure only values that differ: Linear team,
nonstandard status/label names, worktree location, validation command, or the
names of local environment files that an isolated worktree must carry.

See [Configuration](docs/CONFIGURATION.md) for the complete shape and precedence.

## Daily workflow

1. Harden and route an explicit card:

   ```text
   /harden-card PROJ-123
   ```

2. Deliver exactly that card in a new top-level Codex process:

   ```bash
   node .agent-workflow/bin/run-card.mjs PROJ-123
   ```

3. Preview the command without launching Codex:

   ```bash
   node .agent-workflow/bin/run-card.mjs PROJ-123 --dry-run
   ```

4. Optional outer backlog traversal:

   ```bash
   node .agent-workflow/bin/backlog-loop.mjs --max-cards 3
   ```

The backlog loop starts a separate top-level process per card. It stops on
`needs_human`, `failed`, an empty eligible backlog, or the safety limit.

Manual phase commands remain available when deliberately bypassing orchestration:

```text
/implement PROJ-123 in <worktree>, base <sha>, route <model/reasoning>
/code-review PROJ-123, base <sha>, head <sha>, slot <single|A|B>
/rework PROJ-123 at <head> using <structured findings>
/ship-production-change PROJ-123 at approved head <sha>
```

Each manual phase still runs in a new task/context and stops at its contract.

## Agents

- **Orchestrator (`/start-card`)** reconciles durable state and dispatches phases;
  it does not implement.
- **Implementer** changes one card in one worktree, validates, commits, and stops.
- **Reviewer** is read-only and sees the card plus fixed base/head, not the
  implementation conversation.
- **Reworker** receives confirmed structured findings only, commits the smallest
  corrections, and stops before fresh review.
- **Shipper** accepts exact-head approvals, owns PR/CI/merge/deployment/cleanup,
  and never edits application code.

## Skills and commands

- `/harden-card`: red-team readiness, score evidence, apply critical overrides,
  and persist the exact route. `/harden-project-cards` is a compatibility alias.
- `/rework`: reproduces and fixes only confirmed findings. It never self-approves
  or continues into shipping.
- `/start-card`: the one-card orchestrator and resume entry point.
- `/code-review`: independent exact-head spec + standards review.
- `/ship-production-change`: the final protected integration gate.

Codex discovers the canonical skills in `.agents/skills`. Claude Code commands
are thin adapters that read those same files, avoiding two drifting copies.

## Models and reasoning

| Complexity | Implementation | Review |
|---|---|---|
| simple | Sol / medium | 1 × Sol / medium |
| standard | Sol / high | 1 × Sol / high |
| complex | Sol / medium; Sol / high for score ≥15 or high-risk dimensions | 1 × Sol / high |
| critical | Astra / high | Astra / high + Sol / high, independent |

Rework follows implementation routing. A repeated matching blocker gets at most
one escalation to Sol / high. Astra / high and Sol / high routes do not escalate.
The orchestrator and shipper use Sol / medium; the backlog selector uses Luna /
low. The executable routing source is
`workflow/config/defaults.mjs` and is covered by tests.

## Tests and security

```bash
npm test
npm run smoke
npm run scan:secrets
npm run check
```

The smoke test installs into a temporary Git repository, runs a second install,
updates it, verifies expected files, and confirms user files/config survive. The
test suite also exercises conflicts, source-independent runtime execution,
classification routes, exact-head review receipts, bounded rework, and escalation.

The repository intentionally excludes environment files, credentials, caches,
logs, sessions, runtime state, conflict payloads, and backups. Run the secret scan
before release.

## Versioning

The current release is `0.2.0`. Releases use SemVer tags such as `v0.2.0` and
`v1.0.0`.

## Current limitations

- Linear is the only tracker adapter in v0.1.
- Automated phase dispatch depends on Codex custom agents and the Codex CLI.
  Claude Code receives equivalent manual commands, but the outer automated runner
  is not a Claude runner.
- Smoke tests verify installation and orchestration logic without mutating a live
  tracker, opening a PR, or deploying.

## License

MIT
