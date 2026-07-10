#!/usr/bin/env bash
set -euo pipefail

SOURCE_ARCHIVE="/tmp/cst-source.tar.gz"
DATA_ARCHIVE="/tmp/cst-data.tar.gz"
ENV_FILE="/tmp/codex-switch-terminal.env"
SERVICE_FILE="/tmp/codex-switch-terminal.service"
APP_DIR="/opt/codex-switch-terminal"
SOURCE_DIR="/opt/codex-switch-terminal-src"
DATA_DIR="/srv/cst"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_ARCHIVE="$2"; shift 2 ;;
    --data) DATA_ARCHIVE="$2"; shift 2 ;;
    --env) ENV_FILE="$2"; shift 2 ;;
    --service) SERVICE_FILE="$2"; shift 2 ;;
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

install -d -o cst -g cst "$APP_DIR" "$SOURCE_DIR" "$DATA_DIR"
rm -rf "${SOURCE_DIR:?}"/*
tar -xzf "$SOURCE_ARCHIVE" -C "$SOURCE_DIR"
chown -R cst:cst "$SOURCE_DIR"

if [[ ! -x /home/cst/.cargo/bin/cargo ]]; then
  runuser -u cst -- env HOME=/home/cst bash -c \
    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.88.0'
fi

runuser -u cst -- env \
  HOME=/home/cst \
  PATH=/home/cst/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
  bash -c "cd '$SOURCE_DIR' && cargo +1.88.0 build --manifest-path src-tauri/Cargo.toml --release --bin cst-server"

install -m 0755 "$SOURCE_DIR/src-tauri/target/release/cst-server" "$APP_DIR/cst-server"
rm -rf "$APP_DIR/dist"
cp -a "$SOURCE_DIR/dist" "$APP_DIR/dist"
chown -R cst:cst "$APP_DIR"

install -m 0640 -o root -g cst "$ENV_FILE" /etc/codex-switch-terminal.env
install -m 0644 "$SERVICE_FILE" /etc/systemd/system/codex-switch-terminal.service

if [[ -f "$DATA_ARCHIVE" ]]; then
  tar -xzf "$DATA_ARCHIVE" -C "$DATA_DIR"
fi
chown -R cst:cst "$DATA_DIR"
chmod 0700 "$DATA_DIR" "$DATA_DIR/codex-homes" 2>/dev/null || true

if ! runuser -u cst -- env HOME=/home/cst PATH=/home/cst/.local/bin:/usr/local/bin:/usr/bin:/bin \
  bash -c 'command -v codex >/dev/null 2>&1'; then
  runuser -u cst -- env HOME=/home/cst bash -c \
    'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
fi

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

systemctl daemon-reload
systemctl enable --now codex-switch-terminal.service

if tailscale status --json 2>/dev/null | jq -e '.BackendState == "Running"' >/dev/null; then
  tailscale serve --bg http://127.0.0.1:8080
else
  echo
  echo "Tailscale est installe mais pas encore connecte."
  echo "Lance: sudo tailscale up --hostname=oracle-free-cst"
fi

rm -f "$ENV_FILE" "$DATA_ARCHIVE"

echo
systemctl --no-pager --full status codex-switch-terminal.service | sed -n '1,12p'
echo
echo "Installation Oracle terminee."
