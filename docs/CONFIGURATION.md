# Configuration

`agent-workflow.config.json` is the project-owned override. The installer creates
it once and never overwrites it. `.agent-workflow.local.json` has higher
precedence, is gitignored, and is suitable for machine-only command overrides.

```json
{
  "$schema": ".agent-workflow/config.schema.json",
  "tracker": {
    "provider": "linear",
    "team": "Your Team",
    "cardPattern": "^[A-Z][A-Z0-9]*-[0-9]+$",
    "statuses": {
      "ready": "Todo",
      "implementing": "In Progress",
      "reviewing": "In Review",
      "rework": "Rework",
      "merging": "Merging",
      "done": "Done"
    },
    "labels": {
      "hardened": "hardened",
      "readyForAgent": "ready-for-agent",
      "needsInfo": "needs-info",
      "complexityPrefix": "complexity:"
    }
  },
  "git": {
    "remote": "origin",
    "baseBranch": "auto",
    "branchPattern": "<type>/<card-lower>-<slug>"
  },
  "commands": {
    "install": "auto",
    "fullCheck": "auto",
    "validationProof": null,
    "completionCheck": null
  },
  "worktree": {
    "root": ".delivery/worktrees"
  },
  "environment": {
    "copyFiles": [],
    "warnings": []
  },
  "delivery": {
    "validationMode": "full",
    "maxReworkCycles": 2,
    "maxEscalations": 1
  }
}
```

`auto` base-branch detection tries `origin/HEAD`, then local `main`, local
`master`, then the current branch. Package command detection uses lockfiles and
the first available package script among `check`, `verify`, `ci`, and `test`.

`environment.copyFiles` contains file names, never contents. Use it only when an
isolated worktree truly needs an ignored local file. Pair risky targets with a
clear `environment.warnings` message in project config.

Routing models are workflow behavior, not project configuration. They remain in
the versioned central defaults so the classification contract has one source of
truth.

`delivery.validationMode` defaults to `full`. Set it to `project` in the
project configuration only after the project has a tested fail-closed impact
policy, matching CI and evidence verification. Unknown or sensitive impact
must use the full gate. Local configuration cannot enable project mode alone.

`commands.validationProof` and `commands.completionCheck` optionally name
project-owned Node entry points. The former binds/verifies immutable required-gate
receipts. The latter receives state, shipping evidence and resolved config on
stdin; failure blocks `DONE`. See the project integration contract for the
protocol. These defaults are null, so existing consumers retain their behavior.


## Delivery evidence

New CLI-initialized deliveries record `policy.evidenceRequired` in runtime state.
This is not a project configuration switch. The installed
`delivery-evidence.mjs` helper captures raw command logs and explicit artifacts;
see the [protocol](../workflow/contracts/delivery.md#prepared-isolation-and-raw-evidence).
Every focused/gate check supplies its returned command, exitCode and receipt.
Supplementary red, precommit and browser/comparison receipts belong in
`validation.artifacts`. Shipping supplies the durable `evidenceArchive` directory
before DONE. Existing deliveries retain their old policy; updates never rewrite
runtime or manufacture logs. Project-specific validation/completion hooks still
own coverage, freshness and deployment requirements.
