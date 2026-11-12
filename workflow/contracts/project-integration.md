# Project Integration Contract

The installed workflow reads three configuration layers:

1. versioned workflow defaults in `.agent-workflow/config/defaults.mjs`;
2. project-owned `agent-workflow.config.json`;
3. optional machine-owned `.agent-workflow.local.json` (gitignored).

Project instructions remain authoritative for code conventions, safety rules,
deployment requirements, and required validation. Keep those in the project's
existing `AGENTS.md` and/or `CLAUDE.md`; the installer does not replace them.

Automatic detection resolves:

- Git base branch from `origin/HEAD`, then `main`, `master`, or current branch;
- package manager from lockfiles;
- install command from the package manager;
- full check from `check`, `verify`, `ci`, or `test` package scripts.

Configure only values detection cannot know: Linear team, nonstandard statuses or
labels, environment files that a worktree may copy, and project-specific safety
warnings. Environment file names may be configured; their contents are never
copied into the workflow source, manifest, logs, or reports.

`delivery.validationMode` defaults to `full`. Projects may explicitly set it to
`project` only when `commands.fullCheck` executes a documented, tested impact
policy that records profile, reason, base, head and executed checks and falls
back to full for missing, ambiguous or sensitive coverage. Project CI and proof
verification must enforce the same policy; otherwise retain `full` mode. The
legacy command key is retained for compatibility.

Optional project Node entry points in `commands`:

- `validationProof`: binds/verifies the project's immutable validation receipt
  against an explicit base/head. Before `review_approved`, the state CLI invokes
  `node <script> verify --card <CARD> --base <SHA> --head <SHA>` in the card
  worktree, adding `--binding <path>` when supplied in the event or state; it must emit JSON `{result,card,head,binding}`. The binding JSON must
  identify `result`, `card`, `base`, `head`, `receipt` and `receiptSha256`; both
  paths must resolve inside the worktree. The verifier must be tracked in a clean
  worktree at the expected head, with base an ancestor; hidden index flags such
  as assume-unchanged and skip-worktree are refused. Failure blocks approval. The state
  records SHA-256 hashes of binding and receipt for the completion check.
- `completionCheck`: receives `{state,payload,config}` on stdin before `shipped`,
  exits nonzero on missing/contradictory project evidence, or returns
  `{result:"passed",head,base,mergeCommit,...}`. Its public reconciled fields
  become the terminal state and generated checkpoint. Project evidence travels
  through `event --payload-file <path>`, not shell interpolation.
