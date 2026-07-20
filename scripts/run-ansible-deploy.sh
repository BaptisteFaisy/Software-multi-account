#!/usr/bin/env bash
set -euo pipefail

ROOT=""
INVENTORY=""
VARS_FILE=""
IDENTITY_FILE=""

while (($#)); do
  case "$1" in
    --root) ROOT="${2:?valeur manquante}"; shift 2 ;;
    --inventory) INVENTORY="${2:?valeur manquante}"; shift 2 ;;
    --vars) VARS_FILE="${2:?valeur manquante}"; shift 2 ;;
    --identity) IDENTITY_FILE="${2:?valeur manquante}"; shift 2 ;;
    *) echo "Option inconnue: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$ROOT/deploy/ansible" ]] || { echo "Racine du projet invalide." >&2; exit 2; }
[[ -f "$INVENTORY" ]] || { echo "Inventaire Ansible introuvable." >&2; exit 2; }
[[ -f "$VARS_FILE" ]] || { echo "Variables Ansible introuvables." >&2; exit 2; }
[[ -f "$IDENTITY_FILE" ]] || { echo "Cle SSH introuvable." >&2; exit 2; }

VENV="${HOME}/.local/share/codex-switch-terminal/ansible-venv"
if [[ ! -x "$VENV/bin/ansible-playbook" ]]; then
  if ! python3 -m venv "$VENV" 2>/dev/null; then
    command -v sudo >/dev/null || {
      echo "python3-venv est requis pour installer Ansible." >&2
      exit 3
    }
    sudo apt-get update
    sudo apt-get install -y python3-venv
    python3 -m venv "$VENV"
  fi
  "$VENV/bin/python" -m pip install --disable-pip-version-check \
    --requirement "$ROOT/deploy/ansible/requirements.txt"
fi

PRIVATE_KEY="$(mktemp)"
cleanup() {
  rm -f "$PRIVATE_KEY"
}
trap cleanup EXIT
cp "$IDENTITY_FILE" "$PRIVATE_KEY"
chmod 0600 "$PRIVATE_KEY"

export ANSIBLE_CONFIG="$ROOT/deploy/ansible/ansible.cfg"
"$VENV/bin/ansible-playbook" \
  --inventory "$INVENTORY" \
  --private-key "$PRIVATE_KEY" \
  --extra-vars "@$VARS_FILE" \
  "$ROOT/deploy/ansible/playbook.yml"
