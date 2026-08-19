# VPS deployment safeguards

- Duello is an external production workload. A Codex Switch Terminal rebuild must never stop, recreate, remove, rebuild, or prune it.
- Keep Duello in its own Docker Compose project (`duello`) under `/opt/duello`. Its containers must carry the label `com.codex-switch-terminal.rebuild-policy=exclude`.
- Before and after a CST deployment, verify that every container carrying that label is still running with the same container ID.
- Never use project-agnostic cleanup commands such as `docker compose down` without an explicit file/project, `docker system prune --all`, or bulk container/image deletion on the VPS.
- Rebuilding the CST application is distinct from recreating the VM. A VM deletion, disk replacement, or provider reimage cannot preserve Duello in place; back it up and migrate it to separate storage or another VPS before such an operation.

