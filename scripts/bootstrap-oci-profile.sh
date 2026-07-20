#!/usr/bin/env bash
set -euo pipefail

PROFILE="CST"
BOOTSTRAP_PROFILE="CST_BOOTSTRAP"
CONFIG_FILE="${HOME}/.oci/config"
OCI_BIN="${HOME}/.local/bin/oci"
PRIVATE_KEY="${HOME}/.oci/cst_oci_api_key.pem"
PUBLIC_KEY="${HOME}/.oci/cst_oci_api_key_public.pem"
EXPECTED_FINGERPRINT=""
APPLY=0
CLEANUP_BOOTSTRAP=0

usage() {
  cat <<'EOF'
Usage: bootstrap-oci-profile.sh --expected-fingerprint FP [options]

  --profile NAME
  --bootstrap-profile NAME
  --config-file PATH
  --oci-bin PATH
  --private-key PATH
  --public-key PATH
  --expected-fingerprint FP
  --apply
  --cleanup-bootstrap       Supprime le profil et les fichiers de session apres validation

Sans --apply, aucune cle n'est ajoutee et le fichier OCI n'est pas modifie.
EOF
}

while (($#)); do
  case "$1" in
    --profile) PROFILE="${2:?valeur manquante}"; shift 2 ;;
    --bootstrap-profile) BOOTSTRAP_PROFILE="${2:?valeur manquante}"; shift 2 ;;
    --config-file) CONFIG_FILE="${2:?valeur manquante}"; shift 2 ;;
    --oci-bin) OCI_BIN="${2:?valeur manquante}"; shift 2 ;;
    --private-key) PRIVATE_KEY="${2:?valeur manquante}"; shift 2 ;;
    --public-key) PUBLIC_KEY="${2:?valeur manquante}"; shift 2 ;;
    --expected-fingerprint) EXPECTED_FINGERPRINT="${2:?valeur manquante}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --cleanup-bootstrap) CLEANUP_BOOTSTRAP=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Option inconnue: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$PROFILE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Profil durable invalide." >&2; exit 2; }
[[ "$BOOTSTRAP_PROFILE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Profil temporaire invalide." >&2; exit 2; }
[[ -f "$CONFIG_FILE" ]] || { echo "Configuration OCI introuvable." >&2; exit 2; }
[[ -x "$OCI_BIN" ]] || { echo "OCI CLI introuvable." >&2; exit 2; }
[[ -f "$PRIVATE_KEY" && -f "$PUBLIC_KEY" ]] || { echo "Paire de cles CST introuvable." >&2; exit 2; }
[[ "$EXPECTED_FINGERPRINT" =~ ^([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}$ ]] || {
  echo "Empreinte attendue invalide." >&2
  exit 2
}

EXPECTED_FINGERPRINT="${EXPECTED_FINGERPRINT,,}"
chmod 600 "$CONFIG_FILE" "$PRIVATE_KEY"

ACTUAL_FINGERPRINT="$(
  openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER 2>/dev/null \
    | openssl md5 -c 2>/dev/null \
    | sed -E 's/^.*= *//' \
    | tr '[:upper:]' '[:lower:]'
)"
if [[ "$ACTUAL_FINGERPRINT" != "$EXPECTED_FINGERPRINT" ]]; then
  echo "L'empreinte de la cle publique ne correspond pas a la valeur attendue." >&2
  exit 3
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

oci_session() {
  "$OCI_BIN" "$@" \
    --config-file "$CONFIG_FILE" \
    --profile "$BOOTSTRAP_PROFILE" \
    --auth security_token
}

oci_durable() {
  "$OCI_BIN" "$@" \
    --config-file "$CONFIG_FILE" \
    --profile "$PROFILE"
}

echo "Validation de la session OCI temporaire..."
"$OCI_BIN" session validate \
  --config-file "$CONFIG_FILE" \
  --profile "$BOOTSTRAP_PROFILE" \
  --auth security_token > /dev/null

IFS=$'\t' read -r USER_ID TENANCY_ID CONFIG_TENANCY REGION BOOTSTRAP_FINGERPRINT < <(
  python3 - "$CONFIG_FILE" "$BOOTSTRAP_PROFILE" <<'PY'
import base64
import configparser
import json
import os
import sys

config_path, profile = sys.argv[1:]
parser = configparser.RawConfigParser()
if not parser.read(config_path) or not parser.has_section(profile):
    raise SystemExit("Profil temporaire OCI introuvable.")
token_path = os.path.expanduser(parser.get(profile, "security_token_file"))
with open(token_path, encoding="utf-8") as handle:
    token = handle.read().strip()
parts = token.split(".")
if len(parts) < 2:
    raise SystemExit("Jeton OCI temporaire invalide.")
payload = parts[1] + "=" * (-len(parts[1]) % 4)
claims = json.loads(base64.urlsafe_b64decode(payload))
values = (
    claims["sub"],
    claims["tenant"],
    parser.get(profile, "tenancy"),
    parser.get(profile, "region"),
    parser.get(profile, "fingerprint", fallback="").lower(),
)
print("\t".join(values))
PY
)

[[ -n "$USER_ID" && "$TENANCY_ID" == "$CONFIG_TENANCY" ]] || {
  echo "L'identite du jeton ne correspond pas a la tenancy configuree." >&2
  exit 3
}

oci_session iam region-subscription list --all --output json > "$TMP_DIR/regions.json"
HOME_REGION="$(python3 - "$TMP_DIR/regions.json" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
homes = [item.get("region-name") for item in items if item.get("is-home-region")]
if len(homes) != 1:
    raise SystemExit("Region d'origine OCI indeterminable.")
print(homes[0])
PY
)"
[[ "$REGION" == "$HOME_REGION" ]] || {
  echo "Le bootstrap utilise $REGION au lieu de la region d'origine $HOME_REGION." >&2
  exit 3
}

oci_session iam user api-key list \
  --user-id "$USER_ID" \
  --all \
  --output json > "$TMP_DIR/keys-before.json"
if [[ ! -s "$TMP_DIR/keys-before.json" ]]; then
  printf '%s\n' '{"data":[]}' > "$TMP_DIR/keys-before.json"
fi

read -r KEY_COUNT TARGET_PRESENT BOOTSTRAP_PRESENT < <(
  python3 - "$TMP_DIR/keys-before.json" "$EXPECTED_FINGERPRINT" "$BOOTSTRAP_FINGERPRINT" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
fingerprints = {(item.get("fingerprint") or "").lower() for item in items}
print(len(items), str(sys.argv[2] in fingerprints).lower(), str(bool(sys.argv[3]) and sys.argv[3] in fingerprints).lower())
PY
)

echo "Region d'origine: $HOME_REGION"
echo "Cles API presentes: $KEY_COUNT/3"
if [[ "$TARGET_PRESENT" == "true" ]]; then
  echo "La cle durable CST est deja enregistree."
elif ((KEY_COUNT >= 3)); then
  echo "La limite de trois cles API est atteinte; aucune cle n'a ete modifiee." >&2
  exit 4
else
  echo "La cle durable CST doit etre ajoutee."
fi

if ((APPLY == 0)); then
  echo "Preflight valide; relancez avec --apply pour creer le profil durable."
  exit 0
fi

if [[ "$(tail -n 1 "$PRIVATE_KEY")" != "OCI_API_KEY" ]]; then
  printf '\n%s\n' 'OCI_API_KEY' >> "$PRIVATE_KEY"
  chmod 600 "$PRIVATE_KEY"
fi

if [[ "$TARGET_PRESENT" != "true" ]]; then
  echo "Ajout de la cle publique CST au compte Oracle..."
  oci_session iam user api-key upload \
    --user-id "$USER_ID" \
    --key-file "$PUBLIC_KEY" \
    --output json > "$TMP_DIR/uploaded-key.json"
fi

oci_session iam user api-key list \
  --user-id "$USER_ID" \
  --all \
  --output json > "$TMP_DIR/keys-after.json"
if [[ ! -s "$TMP_DIR/keys-after.json" ]]; then
  printf '%s\n' '{"data":[]}' > "$TMP_DIR/keys-after.json"
fi

python3 - "$TMP_DIR/keys-after.json" "$EXPECTED_FINGERPRINT" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
matches = [item for item in items if (item.get("fingerprint") or "").lower() == sys.argv[2]]
if len(matches) != 1:
    raise SystemExit("La cle durable CST n'est pas presente une seule fois apres l'ajout.")
state = matches[0].get("lifecycle-state")
if state and state != "ACTIVE":
    raise SystemExit(f"La cle durable CST n'est pas ACTIVE: {state}")
PY

python3 - \
  "$CONFIG_FILE" \
  "$PROFILE" \
  "$USER_ID" \
  "$EXPECTED_FINGERPRINT" \
  "$PRIVATE_KEY" \
  "$TENANCY_ID" \
  "$HOME_REGION" <<'PY'
import configparser
import os
import sys
import tempfile

path, profile, user, fingerprint, key_file, tenancy, region = sys.argv[1:]
parser = configparser.RawConfigParser()
parser.read(path)
if not parser.has_section(profile):
    parser.add_section(profile)
desired = {
    "user": user,
    "fingerprint": fingerprint,
    "key_file": key_file,
    "tenancy": tenancy,
    "region": region,
}
for key in list(parser[profile]):
    if key not in desired:
        parser.remove_option(profile, key)
for key, value in desired.items():
    parser.set(profile, key, value)

directory = os.path.dirname(os.path.abspath(path))
fd, temporary = tempfile.mkstemp(prefix="config.", dir=directory, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        parser.write(handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

echo "Validation du profil API durable $PROFILE..."
durable_valid=0
for attempt in 1 2 3 4 5 6; do
  if SUPPRESS_LABEL_WARNING=True oci_durable iam region-subscription list --all --output json > /dev/null 2>&1; then
    durable_valid=1
    break
  fi
  if ((attempt < 6)); then
    sleep 5
  fi
done
if ((durable_valid == 0)); then
  echo "Le profil durable n'est pas encore accepte apres le delai de propagation OCI." >&2
  exit 5
fi

if ((CLEANUP_BOOTSTRAP == 1)); then
  python3 - "$CONFIG_FILE" "$BOOTSTRAP_PROFILE" <<'PY'
import configparser
import os
import sys
import tempfile

path, profile = sys.argv[1:]
parser = configparser.RawConfigParser()
parser.read(path)
if not parser.has_section(profile):
    raise SystemExit("Le profil temporaire a deja ete supprime.")

session_root = os.path.realpath(os.path.expanduser("~/.oci/sessions"))
key_file = os.path.realpath(os.path.expanduser(parser.get(profile, "key_file")))
token_file = os.path.realpath(os.path.expanduser(parser.get(profile, "security_token_file")))
session_dir = os.path.dirname(key_file)
for candidate in (key_file, token_file, session_dir):
    if os.path.commonpath((session_root, candidate)) != session_root:
        raise SystemExit("Refus de nettoyer un chemin hors de ~/.oci/sessions.")
if os.path.basename(session_dir) != profile or os.path.dirname(token_file) != session_dir:
    raise SystemExit("Les fichiers temporaires ne sont pas isoles dans le profil attendu.")

parser.remove_section(profile)
directory = os.path.dirname(os.path.abspath(path))
fd, temporary = tempfile.mkstemp(prefix="config.", dir=directory, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        parser.write(handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)

for candidate in (key_file, token_file, os.path.join(session_dir, "oci_api_key_public.pem")):
    if os.path.isfile(candidate):
        os.unlink(candidate)
try:
    os.rmdir(session_dir)
except OSError as exc:
    raise SystemExit(f"Le repertoire de session contient un fichier inattendu: {exc}")
print("BOOTSTRAP_SESSION_REMOVED=true")
PY
fi

echo "DURABLE_PROFILE_VALID=true"
echo "DURABLE_PROFILE=$PROFILE"
echo "HOME_REGION=$HOME_REGION"
echo "BOOTSTRAP_KEY_REGISTERED=$BOOTSTRAP_PRESENT"
