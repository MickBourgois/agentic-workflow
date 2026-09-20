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
    "fullCheck": "auto"
  },
  "worktree": {
    "root": ".delivery/worktrees"
  },
  "environment": {
    "copyFiles": [],
    "warnings": []
  },
  "delivery": {
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
