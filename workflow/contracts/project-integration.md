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
  against an explicit base/head. It is not required for initial or rework code
  reviews. After all `reviews_approved` receipts move the delivery to VALIDATING,
  the orchestrator runs the required gate and binds its immutable receipt.
  Before `review_approved`, the state CLI invokes
  `node <script> verify --card <CARD> --base <SHA> --head <SHA>` in the card
  worktree, adding `--binding <path>` when supplied in the event or state; it must emit JSON `{result,card,head,binding}`. The binding JSON must
  identify `result`, `card`, `base`, `head`, `receipt` and `receiptSha256`; both
  paths must resolve inside the worktree. The verifier must be tracked in a clean
  worktree at the expected head, with base an ancestor; hidden index flags such
  as assume-unchanged and skip-worktree are refused. Failure blocks approval. The state
  records SHA-256 hashes of binding and receipt for the completion check.
  The event also records `kind: required_gate`, passing result, base/head,
  profile/reason, executed checks and receipt (see delivery contract). Verifier
  output supplies verified paths/hashes; it does not replace those gate records.
  The project verifier must reject failed, expired or policy-inadequate receipts,
  including reduced profiles not permitted by its tested policy. At
  `start_shipping` it verifies again and the CLI refuses changed hashes; this
  does not rerun the gate. `validation_refreshed` records a deliberate real refresh.
- `completionCheck`: receives `{state,payload,config}` on stdin before `shipped`,
  exits nonzero on missing/contradictory project evidence, or returns
  `{result:"passed",head,base,mergeCommit,...}`. Its public reconciled fields
  become the terminal state and generated checkpoint. Project evidence travels
  through `event --payload-file <path>`, not shell interpolation.

Without `validationProof`, the same final gate record is mandatory, but its
authenticity, freshness and policy coverage are enforced by the project process,
not independently verified by the CLI. Missing `commands.fullCheck` is not a pass:
the phase must identify and execute the project's required validation or stop.
Project/card instructions may require additional checks or a full gate before
commit/review; this workflow never relaxes those explicit requirements.
