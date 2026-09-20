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
