#!/usr/bin/env bash
set -euo pipefail

PROFILE="CST"
CONFIG_FILE="${HOME}/.oci/config"
OCI_BIN="${HOME}/.local/bin/oci"
COMPARTMENT_NAME="cst"
SHAPE="VM.Standard.A1.Flex"
OCPUS="2"
MEMORY_GB="12"

while (($#)); do
  case "$1" in
    --profile) PROFILE="${2:?valeur manquante}"; shift 2 ;;
    --config-file) CONFIG_FILE="${2:?valeur manquante}"; shift 2 ;;
    --oci-bin) OCI_BIN="${2:?valeur manquante}"; shift 2 ;;
    --compartment-name) COMPARTMENT_NAME="${2:?valeur manquante}"; shift 2 ;;
    --ocpus) OCPUS="${2:?valeur manquante}"; shift 2 ;;
    --memory-gb) MEMORY_GB="${2:?valeur manquante}"; shift 2 ;;
    --help|-h)
      echo "Usage: check-oracle-a1-capacity.sh [--profile CST] [--config-file PATH]"
      exit 0
      ;;
    *) echo "Option inconnue: $1" >&2; exit 2 ;;
  esac
done

[[ "$PROFILE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Profil OCI invalide." >&2; exit 2; }
[[ "$COMPARTMENT_NAME" =~ ^[A-Za-z][A-Za-z0-9_-]{0,99}$ ]] || { echo "Compartiment invalide." >&2; exit 2; }
[[ "$OCPUS" =~ ^[12]$ ]] || { echo "OCPU doit valoir 1 ou 2." >&2; exit 2; }
[[ "$MEMORY_GB" =~ ^([1-9]|1[0-2])$ ]] || { echo "La memoire doit etre comprise entre 1 et 12 Go." >&2; exit 2; }
[[ -f "$CONFIG_FILE" && -x "$OCI_BIN" ]] || { echo "OCI CLI ou configuration introuvable." >&2; exit 2; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

oci() {
  SUPPRESS_LABEL_WARNING=True "$OCI_BIN" "$@" \
    --config-file "$CONFIG_FILE" \
    --profile "$PROFILE"
}

ensure_list_json() {
  local path="$1"
  [[ -s "$path" ]] || printf '%s\n' '{"data":[]}' > "$path"
}

read -r TENANCY_ID CONFIG_REGION < <(python3 - "$CONFIG_FILE" "$PROFILE" <<'PY'
import configparser
import sys

parser = configparser.RawConfigParser()
parser.read(sys.argv[1])
print(parser.get(sys.argv[2], "tenancy"), parser.get(sys.argv[2], "region"))
PY
)

oci iam region-subscription list --all --output json > "$TMP_DIR/regions.json"
ensure_list_json "$TMP_DIR/regions.json"
HOME_REGION="$(python3 - "$TMP_DIR/regions.json" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
homes = [item.get("region-name") for item in items if item.get("is-home-region")]
if len(homes) != 1:
    raise SystemExit("Region d'origine indeterminable.")
print(homes[0])
PY
)"
[[ "$CONFIG_REGION" == "$HOME_REGION" ]] || { echo "Le profil n'utilise pas la region d'origine." >&2; exit 3; }

oci iam compartment list \
  --compartment-id "$TENANCY_ID" \
  --compartment-id-in-subtree true \
  --lifecycle-state ACTIVE \
  --all \
  --output json > "$TMP_DIR/compartments.json"
ensure_list_json "$TMP_DIR/compartments.json"
COMPARTMENT_ID="$(python3 - "$TMP_DIR/compartments.json" "$COMPARTMENT_NAME" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
matches = [item.get("id") for item in items if item.get("name") == sys.argv[2]]
if len(matches) != 1:
    raise SystemExit("Compartiment CST introuvable ou ambigu.")
print(matches[0])
PY
)"

oci iam availability-domain list --compartment-id "$TENANCY_ID" --all --output json > "$TMP_DIR/ads.json"
ensure_list_json "$TMP_DIR/ads.json"
mapfile -t AVAILABILITY_DOMAINS < <(python3 - "$TMP_DIR/ads.json" <<'PY'
import json
import sys

for item in json.load(open(sys.argv[1], encoding="utf-8")).get("data", []):
    if item.get("name"):
        print(item["name"])
PY
)

AVAILABLE=()
for availability_domain in "${AVAILABILITY_DOMAINS[@]}"; do
  oci iam fault-domain list \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$availability_domain" \
    --all \
    --output json > "$TMP_DIR/fault-domains.json"
  ensure_list_json "$TMP_DIR/fault-domains.json"
  mapfile -t FAULT_DOMAINS < <(python3 - "$TMP_DIR/fault-domains.json" <<'PY'
import json
import sys

for item in json.load(open(sys.argv[1], encoding="utf-8")).get("data", []):
    if item.get("name"):
        print(item["name"])
PY
)

  SHAPE_AVAILABILITIES="$(python3 - "$SHAPE" "$OCPUS" "$MEMORY_GB" "${FAULT_DOMAINS[@]}" <<'PY'
import json
import sys

shape, ocpus, memory, *fault_domains = sys.argv[1:]
print(json.dumps([
    {
        "faultDomain": fault_domain,
        "instanceShape": shape,
        "instanceShapeConfig": {"ocpus": float(ocpus), "memoryInGBs": float(memory)},
    }
    for fault_domain in fault_domains
]))
PY
)"

  report_ok=0
  for attempt in 1 2 3; do
    if oci compute compute-capacity-report create \
      --availability-domain "$availability_domain" \
      --compartment-id "$COMPARTMENT_ID" \
      --shape-availabilities "$SHAPE_AVAILABILITIES" \
      --output json > "$TMP_DIR/report.json" 2> "$TMP_DIR/report-error.txt"; then
      report_ok=1
      break
    fi
    if grep -Eqi 'TooManyRequests|too many requests' "$TMP_DIR/report-error.txt"; then
      sleep 20
      continue
    fi
    sed -n '1,12p' "$TMP_DIR/report-error.txt" >&2
    exit 4
  done
  ((report_ok == 1)) || { echo "Rapport de capacite limite apres trois essais." >&2; exit 4; }

  mapfile -t AVAILABLE_IN_AD < <(python3 - "$TMP_DIR/report.json" "$availability_domain" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", {}).get("shape-availabilities", [])
for item in items:
    if item.get("availability-status") == "AVAILABLE" and item.get("fault-domain"):
        print(f"{sys.argv[2]}/{item['fault-domain']}")
PY
)
  AVAILABLE+=("${AVAILABLE_IN_AD[@]}")
done

if ((${#AVAILABLE[@]} == 0)); then
  echo "A1_CAPACITY_AVAILABLE=false"
  exit 75
fi

echo "A1_CAPACITY_AVAILABLE=true"
echo "A1_AVAILABLE_LOCATION_COUNT=${#AVAILABLE[@]}"
exit 0
