# Managed Files and Updates

The install manifest distinguishes ownership:

- **workflow-managed:** `.agents/skills`, `.codex/agents`, selected
  `.claude/commands`, and `.agent-workflow` runtime/contracts;
- **project-owned:** `agent-workflow.config.json`, existing project instructions,
  source code, and all other repository files;
- **machine-owned:** `.agent-workflow.local.json`;
- **runtime:** `.delivery`, conflict candidates, and recoverable backups.

Each managed manifest entry records the last content installed by the workflow
and the incoming source checksum. Update replaces a file only when its current
checksum still matches the managed checksum. A mismatch is a conflict, never
implicit consent to overwrite.

To resolve a conflict:

1. compare the preserved file with the `incoming` path named in the manifest;
2. merge or replace deliberately;
3. run `update.sh` again;
4. when the current file equals incoming content, the updater records it as
   managed and clears that conflict.

Obsolete pristine files move to `.agent-workflow/backups/<run>/...`; they are not
permanently deleted by the updater.

## Preparing and consuming 0.7.0

`VERSION`, `package.json` and `package-lock.json` carry the source version. There
is no committed distribution manifest: `buildPayload()` enumerates canonical
files and install/update computes the installed manifest and SHA-256 hashes from
their actual bytes. The website build reads VERSION and is generated/ignored.
Do not commit temporary consumer copies or their manifests into the source.

For a consumer such as Cockpit Egeiro (after 0.7.0 is reviewed and available):

1. Inspect consumer instructions, Git status, active deliveries and local workflow
   edits. Use an isolated consumer update branch/worktree. Do not resume an old
   delivery with new semantics until the delivery contract's legacy rules have
   been checked; preserve its runtime files and tracker evidence.
2. Pull this source checkout, select the reviewed 0.7.0 commit/tag, verify VERSION
   and source checks, then run `./update.sh <consumer-worktree-root>` from it.
   No tag is created by preparing this version.
3. Exit 2 means conflicts: compare the preserved managed file and incoming
   candidate, resolve deliberately, and rerun update. Do not resume with a mixed
   old/new runtime. Config and project instructions stay project-owned.
4. Verify `.agent-workflow/VERSION`, manifest `installedVersion`, no conflicts,
   and each installed file's SHA-256 against `managedSha256`/`sourceSha256`.
   Inspect changes to skills, runtime and contracts together. Do not change
   the project's validation mode or verifier just to adopt the new ordering.
5. Run consumer-mandated validation/build and explicitly stage only the managed
   changes and intended ignore/config edits. Review and deliver the consumer PR
   according to its own CI, human authorization and deployment rules.
6. Resume each old delivery from durable exact-head evidence using the delivery
   contract. Incomplete checks, missing local receipts, a changed pair or lost
   worktree need human reconciliation. Never synthesize a gate or scoped review.
