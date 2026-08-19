# Duello sidecar on the Google trial VPS

Duello is intentionally outside the Codex Switch Terminal Compose project. It
reuses the Node/Codex runtime captured in the stable local image tag
`duello-runtime:node22-codex`, while keeping its source, data, provider keys and
Codex account homes on the existing persistent disk.

Install or reconcile it without touching CST:

```bash
sudo install -d -m 0755 /opt/duello
sudo install -m 0644 deploy/duello/compose.yaml /opt/duello/compose.yaml
sudo install -m 0644 deploy/duello/google-trial.env /opt/duello/.env
sudo docker compose --file /opt/duello/compose.yaml up --detach --wait
```

The deployed container is labelled
`com.codex-switch-terminal.rebuild-policy=exclude`. The CST Ansible playbook
checks this label before and after every application rebuild and fails if a
protected workload is stopped, recreated, or attached to the CST Compose
project.

This protects Duello from a CST image/container rebuild. It cannot protect it
from deletion of the VM or its persistent disk. Before a provider reimage or VM
replacement, back up the project path from `google-trial.env`, `/opt/duello`,
and the Codex account homes it uses, or migrate Duello to another VPS.

