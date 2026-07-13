# Project agent instructions

<!-- CST-DIRECT-GIT-DELIVERY -->
## Codex Switch Terminal: isolated agent

This process has a private worktree and provider home. Stay inside the current
working directory. Delivery must work with standard Git alone; do not depend on
`workspace_collab` or any `CST_*` environment variable:

- commit a clean, focused change after running the relevant verification;
- fetch the configured remote and rebase on the target branch before publishing;
- push the verified commit directly with a normal, non-forced fast-forward push;
- if the remote advanced, fetch, rebase, re-run affected checks, and retry;
- never edit another agent's worktree or the original checkout by absolute path.

## Delivery

- Always push every completed and verified change to the configured remote.
- Use the repository's normal Git remote/upstream workflow. A merge queue or MCP
  service may be used when explicitly requested, but is never a prerequisite.
- Never force-push a shared branch.
