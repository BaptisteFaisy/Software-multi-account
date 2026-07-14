#!/usr/bin/env bash
set -euo pipefail

# Installation initiale d'un noeud Codex Switch Terminal sur Ubuntu/Debian.
# Le service reste lie a l'interface loopback : l'acces client passe par un
# tunnel SSH cree par scripts/connect-vps.ps1.

SOURCE_ARCHIVE="/tmp/cst-source.tar.gz"
DATA_ARCHIVE="/tmp/cst-data.tar.gz"
ENV_FILE="/tmp/codex-switch-terminal.env"
SERVICE_FILE="/tmp/codex-switch-terminal.service"
APP_DIR="/opt/codex-switch-terminal"
SOURCE_DIR="/opt/codex-switch-terminal-src"
DATA_DIR="/srv/cst"
WORKSPACES_DIR="$DATA_DIR/workspaces"
RELEASES_DIR="$APP_DIR/releases"
BUILD_CACHE="$APP_DIR/build-cache"
CST_GIT_COMMIT="${CST_GIT_COMMIT:-unknown}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_ARCHIVE="$2"; shift 2 ;;
    --data) DATA_ARCHIVE="$2"; shift 2 ;;
    --env) ENV_FILE="$2"; shift 2 ;;
    --service) SERVICE_FILE="$2"; shift 2 ;;
    --commit) CST_GIT_COMMIT="$2"; shift 2 ;;
    *) echo "Argument inconnu: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

for path in "$SOURCE_ARCHIVE" "$ENV_FILE" "$SERVICE_FILE"; do
  if [[ ! -f "$path" ]]; then
    echo "Fichier requis introuvable: $path" >&2
    exit 1
  fi
done

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Cet installateur cible Ubuntu/Debian (apt-get requis)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  build-essential ca-certificates curl file git jq libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev patchelf pkg-config sudo

if ! id cst >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/cst --shell /bin/bash cst
fi

install -d -o cst -g cst \
  "$APP_DIR" "$RELEASES_DIR" "$SOURCE_DIR" "$DATA_DIR" "$WORKSPACES_DIR"
# Migre le cache des premieres versions avant de rafraichir les sources. Une
# relance apres echec ou une mise a jour ne recompilera pas toutes les crates.
if [[ -d "$SOURCE_DIR/src-tauri/target" && ! -e "$BUILD_CACHE" ]]; then
  mv "$SOURCE_DIR/src-tauri/target" "$BUILD_CACHE"
fi
install -d -o cst -g cst "$BUILD_CACHE"
rm -rf "${SOURCE_DIR:?}"/*
tar -xzf "$SOURCE_ARCHIVE" -C "$SOURCE_DIR"
ln -sfn "$BUILD_CACHE" "$SOURCE_DIR/src-tauri/target"
chown -R cst:cst "$SOURCE_DIR"
chown -h cst:cst "$SOURCE_DIR/src-tauri/target"

if [[ ! -x /home/cst/.cargo/bin/cargo ]]; then
  runuser -u cst -- env HOME=/home/cst bash -c \
    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.88.0'
fi

runuser -u cst -- env \
  HOME=/home/cst \
  PATH=/home/cst/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
  CARGO_TARGET_DIR="$BUILD_CACHE" \
  CST_GIT_COMMIT="$CST_GIT_COMMIT" \
  bash -c "cd '$SOURCE_DIR' && cargo +1.88.0 build --manifest-path src-tauri/Cargo.toml --release --bin cst-server"

BUILT_BIN="$BUILD_CACHE/release/cst-server"
VERSION="$($BUILT_BIN --version | awk '{print $2}')"
if [[ -z "$VERSION" ]]; then
  echo "Impossible de lire la version via 'cst-server --version'." >&2
  exit 1
fi

# La version Cargo peut rester stable entre deux deploiements. Le commit rend
# le dossier de release immutable et compatible avec update-node.sh.
SAFE_COMMIT="$(sed 's/[^A-Za-z0-9._-]/-/g' <<<"$CST_GIT_COMMIT")"
RELEASE_ID="$VERSION-$SAFE_COMMIT"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
if [[ -e "$RELEASE_DIR" ]]; then
  RELEASE_ID="$RELEASE_ID-$(date +%s)-$$"
  RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
fi

install -d -o cst -g cst "$RELEASE_DIR"
install -m 0755 "$BUILT_BIN" "$RELEASE_DIR/cst-server"
cp -a "$SOURCE_DIR/dist" "$RELEASE_DIR/dist"
ln -sfnT "releases/$RELEASE_ID" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
chown -R cst:cst "$APP_DIR"

install -m 0640 -o root -g cst "$ENV_FILE" /etc/codex-switch-terminal.env
install -m 0644 "$SERVICE_FILE" /etc/systemd/system/codex-switch-terminal.service

# Le seed est optionnel. S'il est fourni, il ne remplace jamais l'etat d'un
# noeud deja initialise (tokens OAuth rafraichis, comptes et historiques).
if [[ -f "$DATA_ARCHIVE" ]]; then
  if [[ ! -e "$DATA_DIR/settings.json" ]]; then
    tar -xzf "$DATA_ARCHIVE" -C "$DATA_DIR"
    echo "Donnees initiales seedees dans $DATA_DIR."
  else
    echo "settings.json existe deja: seed ignore, donnees distantes preservees."
  fi
fi
chown -R cst:cst "$DATA_DIR"
chmod 0700 "$DATA_DIR" "$DATA_DIR/codex-homes" "$WORKSPACES_DIR" 2>/dev/null || true

if ! runuser -u cst -- env HOME=/home/cst PATH=/home/cst/.local/bin:/usr/local/bin:/usr/bin:/bin \
  bash -c 'cd "$HOME" && command -v codex >/dev/null 2>&1'; then
  runuser -u cst -- env HOME=/home/cst bash -c \
    'cd "$HOME" && curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'
fi

systemctl daemon-reload
systemctl enable --now codex-switch-terminal.service

# Verifie le service depuis le VPS, sans ouvrir son port au reseau public.
set -a
# shellcheck disable=SC1090
source /etc/codex-switch-terminal.env
set +a
BIND="${CST_BIND:-127.0.0.1:8080}"
PORT="${BIND##*:}"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [[ "$READY" != "1" ]]; then
  echo "Le service n'a pas repondu sur 127.0.0.1:$PORT." >&2
  systemctl --no-pager --full status codex-switch-terminal.service >&2 || true
  exit 1
fi

# Ce marqueur n'existe qu'apres une installation entierement validee. Le
# deploiement SSH peut ainsi reprendre proprement une tentative interrompue au
# lieu de la confondre avec un noeud eligible au chemin de mise a jour.
install -m 0644 -o cst -g cst /dev/null "$APP_DIR/.installed"

echo
systemctl --no-pager --full status codex-switch-terminal.service | sed -n '1,12p'
echo
echo "Installation VPS terminee; acces disponible uniquement via tunnel SSH."
