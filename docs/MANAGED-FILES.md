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
