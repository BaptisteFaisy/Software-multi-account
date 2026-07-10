#!/usr/bin/env bash
set -euo pipefail

# Mise a jour SURE d'un noeud Linux deja installe.
#
# Sequence : peupler releases/<v> (Phase 1 : build on-host ; Phase 2 : download
# + verif SHA-256/minisign) -> self-check `--version` -> drain -> attente
# activeTerminals==0 (borne, timeout -> abandon sans tuer les sessions) ->
# bascule atomique de 'current' -> restart -> verification "vraiment revenu"
# -> rollback automatique si echec.
#
# Usage : sudo bash update-node.sh [--commit <sha>] [--drain-timeout <sec>] [--force]

APP_DIR="/opt/codex-switch-terminal"
SOURCE_DIR="/opt/codex-switch-terminal-src"
SOURCE_ARCHIVE="/tmp/cst-source.tar.gz"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
ENV_FILE="/etc/codex-switch-terminal.env"
SERVICE="codex-switch-terminal.service"
CST_GIT_COMMIT="${CST_GIT_COMMIT:-}"
DRAIN_TIMEOUT=300
VERIFY_TIMEOUT=60
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_ARCHIVE="$2"; shift 2 ;;
    --commit) CST_GIT_COMMIT="$2"; shift 2 ;;
    --drain-timeout) DRAIN_TIMEOUT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Argument inconnu: $1" >&2; exit 2 ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || { echo "Lance ce script avec sudo." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE introuvable : noeud non installe ?" >&2; exit 1; }
for tool in curl jq awk sed; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Outil requis introuvable: $tool" >&2; exit 1; }
done

# Charge token + bind depuis l'EnvironmentFile (format KEY="value").
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
ADMIN_TOKEN="${CST_ADMIN_TOKEN:-}"
BIND="${CST_BIND:-127.0.0.1:8080}"
PORT="${BIND##*:}"
BASE="http://127.0.0.1:$PORT"
[[ -n "$ADMIN_TOKEN" ]] || { echo "CST_ADMIN_TOKEN absent de $ENV_FILE." >&2; exit 1; }

log() { echo "[update-node] $*"; }
healthz() { curl -fsS --max-time 3 "$BASE/healthz" 2>/dev/null || true; }
hfield() { jq -r --arg k "$2" '.[$k] // empty' <<<"${1:-}" 2>/dev/null || true; }

# --- Release actuellement active (cible du rollback) ---
PREV_TARGET=""
[[ -L "$CURRENT_LINK" ]] && PREV_TARGET="$(readlink "$CURRENT_LINK")"   # ex: releases/0.1.0

# --- 0. Nouvelle source (push deploy). En Phase 2, remplace par un download +
# verif SHA-256/minisign avant extraction. ---
if [[ -f "$SOURCE_ARCHIVE" ]]; then
  log "Extraction de la nouvelle source dans $SOURCE_DIR"
  install -d -o cst -g cst "$SOURCE_DIR"
  rm -rf "${SOURCE_DIR:?}"/*
  tar -xzf "$SOURCE_ARCHIVE" -C "$SOURCE_DIR"
  chown -R cst:cst "$SOURCE_DIR"
fi

# --- 1. Peupler la nouvelle release (Phase 1 : build sur l'hote) ---
log "Build de la nouvelle release depuis $SOURCE_DIR"
runuser -u cst -- env \
  HOME=/home/cst \
  PATH=/home/cst/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
  CST_GIT_COMMIT="$CST_GIT_COMMIT" \
  bash -c "cd '$SOURCE_DIR' && cargo +1.88.0 build --manifest-path src-tauri/Cargo.toml --release --bin cst-server"

BUILT_BIN="$SOURCE_DIR/src-tauri/target/release/cst-server"
# --- 2. Self-check : le binaire repond a --version ---
VLINE="$("$BUILT_BIN" --version)"
VERSION="$(awk '{print $2}' <<<"$VLINE")"
[[ -n "$VERSION" ]] || { echo "Version illisible via 'cst-server --version'." >&2; exit 1; }
log "Nouvelle release : $VLINE"

RELEASE_DIR="$RELEASES_DIR/$VERSION"
install -d -o cst -g cst "$RELEASES_DIR" "$RELEASE_DIR"
install -m 0755 "$BUILT_BIN" "$RELEASE_DIR/cst-server"
rm -rf "$RELEASE_DIR/dist"
cp -a "$SOURCE_DIR/dist" "$RELEASE_DIR/dist"
chown -R cst:cst "$RELEASE_DIR"

# --- 3. Drain ---
log "Passage du noeud en drain"
curl -fsS --max-time 5 -X POST "$BASE/api/admin/drain" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"draining":true}' >/dev/null || { echo "Drain impossible (serveur injoignable ?)." >&2; exit 1; }

# --- 4. Attente activeTerminals==0 (borne) ---
log "Attente des sessions ouvertes (timeout ${DRAIN_TIMEOUT}s)"
deadline=$(( $(date +%s) + DRAIN_TIMEOUT ))
while :; do
  active="$(hfield "$(healthz)" activeTerminals)"; active="${active:-0}"
  [[ "$active" == "0" ]] && break
  if [[ "$(date +%s)" -ge "$deadline" ]]; then
    if [[ "$FORCE" == "1" ]]; then
      log "Timeout atteint ; --force : on poursuit malgre $active session(s)."
      break
    fi
    log "Timeout : $active session(s) encore actives. Noeud LAISSE EN DRAIN, MAJ abandonnee (sera retentee)."
    exit 3
  fi
  sleep 3
done

# --- 5. Bascule atomique de 'current' ---
log "Bascule current -> releases/$VERSION"
ln -sfnT "releases/$VERSION" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$CURRENT_LINK"
chown -h cst:cst "$CURRENT_LINK"

# --- 6. Redemarrage (efface aussi le drain, etat en memoire) ---
log "Redemarrage de $SERVICE"
systemctl restart "$SERVICE"

# --- 7. Verification "vraiment revenu" ---
verify() {
  local want="$1" hz ver rdy drn code
  local vdeadline=$(( $(date +%s) + VERIFY_TIMEOUT ))
  while :; do
    hz="$(healthz)"
    ver="$(hfield "$hz" version)"; rdy="$(hfield "$hz" ready)"; drn="$(hfield "$hz" draining)"
    if [[ "$ver" == "$want" && "$rdy" == "true" && "$drn" == "false" ]]; then
      # Sonde d'acceptation : POST /api/terminals avec un compte bidon. Un noeud
      # sain repond 400/500 (compte introuvable) ; un noeud draine repondrait
      # 503, un token invalide 401. On accepte donc tout sauf 503/401/000.
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST "$BASE/api/terminals" \
        -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
        -d '{"accountId":"__cst_update_probe__","repoUrl":"","cols":80,"rows":24}' 2>/dev/null || echo 000)"
      case "$code" in
        503|401|000) : ;;    # pas encore pret / probleme -> on continue d'attendre
        *) return 0 ;;
      esac
    fi
    [[ "$(date +%s)" -ge "$vdeadline" ]] && return 1
    sleep 2
  done
}

if verify "$VERSION"; then
  log "OK : noeud en version $VERSION, pret et non draine."
  exit 0
fi

# --- 8. Rollback ---
log "ECHEC de la verification en $VERSION."
if [[ -n "$PREV_TARGET" && "$PREV_TARGET" != "releases/$VERSION" ]]; then
  PREV_VERSION="${PREV_TARGET##*/}"
  log "Rollback -> $PREV_TARGET"
  ln -sfnT "$PREV_TARGET" "$APP_DIR/current.tmp"
  mv -Tf "$APP_DIR/current.tmp" "$CURRENT_LINK"
  chown -h cst:cst "$CURRENT_LINK"
  systemctl restart "$SERVICE"
  if verify "$PREV_VERSION"; then
    log "Rollback OK : noeud restaure en $PREV_VERSION."
  else
    log "ALERTE : rollback n'a pas restaure un etat sain, intervention manuelle requise."
  fi
else
  log "ALERTE : pas de release precedente pour le rollback."
fi
exit 1
