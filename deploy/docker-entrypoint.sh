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

exec /usr/sbin/gosu cst "$@"
