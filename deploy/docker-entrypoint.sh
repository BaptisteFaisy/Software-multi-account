#!/bin/sh
set -eu

install -d -m 0700 -o cst -g cst /srv/cst /srv/cst/codex-homes /srv/cst/workspaces
chmod 0700 /srv/cst /srv/cst/codex-homes /srv/cst/workspaces

# Corrige a cout constant par workspace les anciens deploiements Ansible qui
# recreaient leur racine en root:root. Sans le droit de parcours sur cette
# racine, le lancement de Codex echoue avec EACCES avant meme son demarrage.
find /srv/cst/workspaces -mindepth 1 -maxdepth 1 -type d -exec chown cst:cst {} +

# Les archives de seed sont extraites par Ansible en root avant le premier
# demarrage. Une seule correction recursive remet les comptes et le workspace
# au compte non privilegie du conteneur ; les redemarrages suivants restent O(1).
ownership_marker=/srv/cst/.container-ownership-v1
if [ ! -e "$ownership_marker" ]; then
  chown -R cst:cst /srv/cst
  chmod -R go-rwx /srv/cst
  : > "$ownership_marker"
  chown cst:cst "$ownership_marker"
  chmod 0600 "$ownership_marker"
fi

# Pont SSH retour depuis les terminaux Switch vers le PC fixe. En production,
# le PC maintient un reverse-forward Tailscale vers l'hote VPS ; le conteneur
# atteint son extremite via host.docker.internal. Les alias explicites evitent
# qu'un agent conclue a tort que le pont est absent faute de daemon Tailscale
# dans le conteneur.
ssh_dir=/srv/cst/ssh
if [ -s "$ssh_dir/id_back" ]; then
  local_host=${CST_SSH_LOCAL_HOST:-host.docker.internal}
  local_port=${CST_SSH_LOCAL_PORT:-22}
  local_user=${CST_SSH_LOCAL_USER:-jeanp}

  install -d -m 0700 -o cst -g cst /home/cst/.ssh
  if [ ! -e "$ssh_dir/known_hosts" ]; then
    : > "$ssh_dir/known_hosts"
  fi
  chown cst:cst "$ssh_dir/id_back" "$ssh_dir/known_hosts"
  chmod 0600 "$ssh_dir/id_back" "$ssh_dir/known_hosts"

  cat > /home/cst/.ssh/config <<EOF
# PC -> Tailscale -> VPS -> conteneur -> PC.
# Le transport Tailscale tourne hors du conteneur.
Host local pc pc-fixe pc-fixe-tailscale
  HostName $local_host
  Port $local_port
  User $local_user
  IdentityFile $ssh_dir/id_back
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
  UserKnownHostsFile $ssh_dir/known_hosts
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ConnectTimeout 10
EOF
  chown cst:cst /home/cst/.ssh/config
  chmod 0600 /home/cst/.ssh/config
fi

exec /usr/sbin/gosu cst "$@"
