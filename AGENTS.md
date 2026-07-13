# Project agent instructions

<!-- CST-ISOLATED-AGENT -->
## Codex Switch Terminal: isolated agent

This process has a private worktree and provider home. Stay inside the current
working directory. Use the `workspace_collab` MCP tools to coordinate real work:

- claim the task before starting shared work;
- commit a clean, focused change before submitting it for merge;
- use merge status and landed-change checks, and rebase from the announced base
  when needed;
- never edit another agent's worktree or the original checkout by absolute path.

## Delivery

- Always push every completed and verified change to the configured remote.
- From an isolated worktree, submit the commit through the merge queue, wait for
  it to land, then push the landed target branch. Do not stop at a local commit.
- Synchronize and retry through the merge flow if the remote advanced. Never
  force-push a shared branch.
