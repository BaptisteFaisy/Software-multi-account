#!/usr/bin/env bash
set -euo pipefail

# Provisionne une pile OCI minimale pour CST. Ce script est execute dans WSL
# par provision-oracle-free.ps1. Sans --apply, il ne modifie jamais OCI.

PROFILE="CST"
CONFIG_FILE="${HOME}/.oci/config"
OCI_BIN="${HOME}/.local/bin/oci"
COMPARTMENT_NAME="cst"
STACK_NAME="cst-oracle-free"
SSH_PUBLIC_KEY=""
ALLOWED_SSH_CIDR=""
APPLY=0

SHAPE="VM.Standard.A1.Flex"
OCPUS="2"
MEMORY_GB="12"
BOOT_VOLUME_GB="50"
VCN_CIDR="10.42.0.0/16"
SUBNET_CIDR="10.42.1.0/24"

usage() {
  cat <<'EOF'
Usage: provision-oracle-free.sh [options]

  --profile NAME              Profil OCI (defaut: CST)
  --config-file PATH          Configuration OCI
  --oci-bin PATH              Executable OCI CLI
  --compartment-name NAME     Compartiment dedie (defaut: cst)
  --stack-name NAME           Prefixe stable des ressources
  --ssh-public-key PATH       Cle publique SSH a installer
  --allowed-ssh-cidr CIDR     IPv4 autorisee vers SSH, idealement /32
  --ocpus COUNT               OCPU A1 (1 ou 2, defaut: 2)
  --memory-gb COUNT           RAM A1 en Go (1 a 12, defaut: 12)
  --apply                     Cree ou reconcilie les ressources
  --help                      Affiche cette aide

Sans --apply, le script valide l'acces et affiche uniquement le plan.
EOF
}

while (($#)); do
  case "$1" in
    --profile) PROFILE="${2:?valeur manquante pour --profile}"; shift 2 ;;
    --config-file) CONFIG_FILE="${2:?valeur manquante pour --config-file}"; shift 2 ;;
    --oci-bin) OCI_BIN="${2:?valeur manquante pour --oci-bin}"; shift 2 ;;
    --compartment-name) COMPARTMENT_NAME="${2:?valeur manquante pour --compartment-name}"; shift 2 ;;
    --stack-name) STACK_NAME="${2:?valeur manquante pour --stack-name}"; shift 2 ;;
    --ssh-public-key) SSH_PUBLIC_KEY="${2:?valeur manquante pour --ssh-public-key}"; shift 2 ;;
    --allowed-ssh-cidr) ALLOWED_SSH_CIDR="${2:?valeur manquante pour --allowed-ssh-cidr}"; shift 2 ;;
    --ocpus) OCPUS="${2:?valeur manquante pour --ocpus}"; shift 2 ;;
    --memory-gb) MEMORY_GB="${2:?valeur manquante pour --memory-gb}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Option inconnue: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$PROFILE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Nom de profil OCI invalide." >&2; exit 2; }
[[ "$COMPARTMENT_NAME" =~ ^[A-Za-z][A-Za-z0-9_-]{0,99}$ ]] || { echo "Nom de compartiment invalide." >&2; exit 2; }
[[ "$STACK_NAME" =~ ^[a-z][a-z0-9-]{0,39}$ ]] || { echo "Nom de pile invalide." >&2; exit 2; }
[[ "$OCPUS" =~ ^[12]$ ]] || { echo "OCPU doit valoir 1 ou 2." >&2; exit 2; }
[[ "$MEMORY_GB" =~ ^([1-9]|1[0-2])$ ]] || { echo "La memoire doit etre comprise entre 1 et 12 Go." >&2; exit 2; }
[[ -f "$CONFIG_FILE" ]] || { echo "Configuration OCI introuvable: $CONFIG_FILE" >&2; exit 2; }
[[ -x "$OCI_BIN" ]] || { echo "OCI CLI introuvable: $OCI_BIN" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 est requis." >&2; exit 2; }
[[ -n "$SSH_PUBLIC_KEY" && -f "$SSH_PUBLIC_KEY" ]] || { echo "Cle publique SSH introuvable." >&2; exit 2; }

ALLOWED_SSH_CIDR="$(python3 - "$ALLOWED_SSH_CIDR" <<'PY'
import ipaddress
import sys

try:
    network = ipaddress.ip_network(sys.argv[1], strict=False)
except ValueError as exc:
    raise SystemExit(f"CIDR SSH invalide: {exc}")
if network.version != 4:
    raise SystemExit("Le CIDR SSH doit etre une plage IPv4.")
if network.prefixlen < 24:
    raise SystemExit("Le CIDR SSH est trop large; utilisez un prefixe /24 ou plus restrictif.")
print(network)
PY
)"

read -r ssh_key_line < "$SSH_PUBLIC_KEY"
[[ "$ssh_key_line" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))[[:space:]] ]] || {
  echo "Format de cle publique SSH non reconnu." >&2
  exit 2
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

oci() {
  "$OCI_BIN" --config-file "$CONFIG_FILE" --profile "$PROFILE" "$@"
}

ensure_list_json() {
  local path="$1"
  if [[ ! -s "$path" ]]; then
    printf '%s\n' '{"data":[]}' > "$path"
  fi
}

profile_value() {
  python3 - "$CONFIG_FILE" "$PROFILE" "$1" <<'PY'
import configparser
import sys

path, profile, key = sys.argv[1:]
parser = configparser.RawConfigParser()
if not parser.read(path):
    raise SystemExit(1)
section = profile if parser.has_section(profile) else "DEFAULT" if profile == "DEFAULT" else None
if section is None or not parser.has_option(section, key):
    raise SystemExit(1)
print(parser.get(section, key).strip())
PY
}

json_scalar() {
  local path="$1"
  local expression="$2"
  python3 - "$path" "$expression" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    if part:
        value = value[part]
if value is not None:
    print(value)
PY
}

resource_id_by_name() {
  local path="$1"
  local display_name="$2"
  python3 - "$path" "$display_name" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
matches = [
    item for item in items
    if item.get("display-name") == sys.argv[2]
    and item.get("lifecycle-state") not in {"TERMINATED", "TERMINATING", "DELETED", "DELETING"}
]
if len(matches) > 1:
    raise SystemExit(f"Plusieurs ressources portent le nom {sys.argv[2]!r}; intervention manuelle requise.")
if matches:
    tags = matches[0].get("freeform-tags") or {}
    if tags.get("cst-managed") != "true":
        raise SystemExit(f"La ressource {sys.argv[2]!r} existe mais n'est pas geree par CST.")
    print(matches[0]["id"])
PY
}

TENANCY_ID="$(profile_value tenancy)" || { echo "Le profil OCI ne contient pas tenancy." >&2; exit 2; }
CONFIG_REGION="$(profile_value region)" || { echo "Le profil OCI ne contient pas region." >&2; exit 2; }

echo "Validation de l'authentification OCI ($PROFILE)..."
oci iam region-subscription list --all --output json > "$TMP_DIR/regions.json"
ensure_list_json "$TMP_DIR/regions.json"
HOME_REGION="$(python3 - "$TMP_DIR/regions.json" <<'PY'
import json
import sys

regions = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
homes = [item.get("region-name") for item in regions if item.get("is-home-region")]
if len(homes) != 1:
    raise SystemExit("Impossible de determiner une region d'origine unique.")
print(homes[0])
PY
)"

if [[ "$CONFIG_REGION" != "$HOME_REGION" ]]; then
  echo "Le profil pointe vers $CONFIG_REGION, mais Always Free Compute doit etre cree dans $HOME_REGION." >&2
  exit 3
fi

echo "Region d'origine validee: $HOME_REGION"

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
((${#AVAILABILITY_DOMAINS[@]} > 0)) || { echo "Aucun domaine de disponibilite accessible." >&2; exit 3; }

oci iam compartment list \
  --compartment-id "$TENANCY_ID" \
  --compartment-id-in-subtree true \
  --include-root \
  --access-level ACCESSIBLE \
  --all \
  --output json > "$TMP_DIR/compartments.json"
ensure_list_json "$TMP_DIR/compartments.json"

mapfile -t ACCESSIBLE_COMPARTMENTS < <(python3 - "$TMP_DIR/compartments.json" "$TENANCY_ID" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
ids = {sys.argv[2]}
for item in items:
    if item.get("lifecycle-state") == "ACTIVE" and item.get("id"):
        ids.add(item["id"])
for value in sorted(ids):
    print(value)
PY
)

TARGET_COMPARTMENT_ID="$(python3 - "$TMP_DIR/compartments.json" "$COMPARTMENT_NAME" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
matches = [item for item in items if item.get("name") == sys.argv[2] and item.get("lifecycle-state") == "ACTIVE"]
if len(matches) > 1:
    raise SystemExit(f"Plusieurs compartiments actifs portent le nom {sys.argv[2]!r}.")
if matches:
    print(matches[0]["id"])
PY
)"

echo "Inventaire des ressources Compute et Block Volume accessibles..."
mkdir -p "$TMP_DIR/instances" "$TMP_DIR/boot-volumes" "$TMP_DIR/block-volumes"
index=0
for compartment_id in "${ACCESSIBLE_COMPARTMENTS[@]}"; do
  index=$((index + 1))
  oci compute instance list --compartment-id "$compartment_id" --all --output json > "$TMP_DIR/instances/$index.json"
  ensure_list_json "$TMP_DIR/instances/$index.json"
  oci bv volume list --compartment-id "$compartment_id" --all --output json > "$TMP_DIR/block-volumes/$index.json"
  ensure_list_json "$TMP_DIR/block-volumes/$index.json"
  ad_index=0
  for availability_domain in "${AVAILABILITY_DOMAINS[@]}"; do
    ad_index=$((ad_index + 1))
    oci bv boot-volume list \
      --compartment-id "$compartment_id" \
      --availability-domain "$availability_domain" \
      --all \
      --output json > "$TMP_DIR/boot-volumes/${index}-${ad_index}.json"
    ensure_list_json "$TMP_DIR/boot-volumes/${index}-${ad_index}.json"
  done
done

read -r USED_A1_OCPUS USED_A1_MEMORY ACTIVE_A1_COUNT USED_VOLUME_GB < <(
  python3 - "$TMP_DIR" <<'PY'
import glob
import json
import os
import sys

root = sys.argv[1]
ocpus = 0.0
memory = 0.0
instances = 0
storage = 0
inactive = {"TERMINATED", "TERMINATING", "DELETED", "DELETING"}

for path in glob.glob(os.path.join(root, "instances", "*.json")):
    for item in json.load(open(path, encoding="utf-8")).get("data", []):
        if item.get("lifecycle-state") in inactive or item.get("shape") != "VM.Standard.A1.Flex":
            continue
        config = item.get("shape-config") or {}
        ocpus += float(config.get("ocpus") or 0)
        memory += float(config.get("memory-in-gbs") or 0)
        instances += 1

for directory in ("boot-volumes", "block-volumes"):
    for path in glob.glob(os.path.join(root, directory, "*.json")):
        for item in json.load(open(path, encoding="utf-8")).get("data", []):
            if item.get("lifecycle-state") in inactive:
                continue
            storage += int(item.get("size-in-gbs") or 0)

def clean(number):
    return str(int(number)) if number == int(number) else str(number)

print(clean(ocpus), clean(memory), instances, storage)
PY
)

echo "Usage A1 actif: ${USED_A1_OCPUS}/2 OCPU, ${USED_A1_MEMORY}/12 Go, ${ACTIVE_A1_COUNT} instance(s)."
echo "Volumes actifs accessibles: ${USED_VOLUME_GB}/200 Go."

INSTANCE_NAME="${STACK_NAME}-vm"
EXISTING_INSTANCE_ID=""
EXISTING_INSTANCE_STATE=""
if [[ -n "$TARGET_COMPARTMENT_ID" ]]; then
  oci compute instance list \
    --compartment-id "$TARGET_COMPARTMENT_ID" \
    --display-name "$INSTANCE_NAME" \
    --all \
    --output json > "$TMP_DIR/target-instances.json"
  ensure_list_json "$TMP_DIR/target-instances.json"
  EXISTING_INSTANCE_ID="$(resource_id_by_name "$TMP_DIR/target-instances.json" "$INSTANCE_NAME")"
  if [[ -n "$EXISTING_INSTANCE_ID" ]]; then
    oci compute instance get --instance-id "$EXISTING_INSTANCE_ID" --output json > "$TMP_DIR/existing-instance.json"
    EXISTING_INSTANCE_STATE="$(python3 - "$TMP_DIR/existing-instance.json" "$SHAPE" "$OCPUS" "$MEMORY_GB" <<'PY'
import json
import sys

item = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
expected_shape, expected_cpu, expected_memory = sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
config = item.get("shape-config") or {}
actual_cpu = float(config.get("ocpus") or 0)
actual_memory = float(config.get("memory-in-gbs") or 0)
if item.get("shape") != expected_shape or actual_cpu != expected_cpu or actual_memory != expected_memory:
    raise SystemExit(
        "La VM CST existante ne correspond pas au gabarit Always Free attendu "
        f"({expected_shape}, {expected_cpu:g} OCPU, {expected_memory:g} Go)."
    )
print(item.get("lifecycle-state") or "UNKNOWN")
PY
)"
  fi
fi

if [[ -z "$EXISTING_INSTANCE_ID" ]]; then
  python3 - "$USED_A1_OCPUS" "$USED_A1_MEMORY" "$USED_VOLUME_GB" "$OCPUS" "$MEMORY_GB" "$BOOT_VOLUME_GB" <<'PY'
import sys

used_cpu, used_mem, used_disk, add_cpu, add_mem, add_disk = map(float, sys.argv[1:])
if used_cpu + add_cpu > 2:
    raise SystemExit("Le projet depasserait la limite Always Free de 2 OCPU A1.")
if used_mem + add_mem > 12:
    raise SystemExit("Le projet depasserait la limite Always Free de 12 Go A1.")
if used_disk + add_disk > 200:
    raise SystemExit("Le projet depasserait les 200 Go de volumes Always Free.")
PY
fi

oci limits value list \
  --compartment-id "$TENANCY_ID" \
  --service-name compute \
  --all \
  --output json > "$TMP_DIR/compute-limits.json"
ensure_list_json "$TMP_DIR/compute-limits.json"

python3 - "$TMP_DIR/compute-limits.json" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
relevant = [item for item in items if "a1" in (item.get("name") or "").lower()]
if relevant:
    summary = ", ".join(f"{item.get('name')}={item.get('value')}" for item in relevant)
    print(f"Limites OCI A1 annoncees: {summary}")
else:
    print("Aucune limite nommee A1 n'est exposee; les plafonds Always Free conservateurs restent appliques.")
PY

oci compute image list \
  --compartment-id "$TENANCY_ID" \
  --operating-system "Canonical Ubuntu" \
  --operating-system-version "24.04" \
  --shape "$SHAPE" \
  --lifecycle-state AVAILABLE \
  --sort-by TIMECREATED \
  --sort-order DESC \
  --all \
  --output json > "$TMP_DIR/images.json"
ensure_list_json "$TMP_DIR/images.json"

IMAGE_ID="$(python3 - "$TMP_DIR/images.json" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
if not items:
    raise SystemExit("Aucune image Ubuntu 24.04 compatible A1 n'est disponible.")
items.sort(key=lambda item: item.get("time-created") or "", reverse=True)
print(items[0]["id"])
PY
)"

echo "Plan: ${SHAPE}, ${OCPUS} OCPU, ${MEMORY_GB} Go RAM, Ubuntu 24.04, disque ${BOOT_VOLUME_GB} Go."
echo "Plan reseau: ${VCN_CIDR}, sous-reseau ${SUBNET_CIDR}, SSH depuis ${ALLOWED_SSH_CIDR}, aucun port CST public."

if ((APPLY == 0)); then
  if [[ -z "$TARGET_COMPARTMENT_ID" ]]; then
    echo "Plan: creation du compartiment ${COMPARTMENT_NAME}."
  fi
  if [[ -z "$EXISTING_INSTANCE_ID" ]]; then
    echo "Plan valide; relancez avec --apply pour provisionner."
  else
    echo "La VM geree existe deja; --apply reconciliera son reseau et son etat."
  fi
  exit 0
fi

TAGS='{"cst-managed":"true","cst-stack":"oracle-free"}'

if [[ -z "$TARGET_COMPARTMENT_ID" ]]; then
  echo "Creation du compartiment ${COMPARTMENT_NAME}..."
  oci iam compartment create \
    --compartment-id "$TENANCY_ID" \
    --name "$COMPARTMENT_NAME" \
    --description "Ressources CST gerees automatiquement" \
    --freeform-tags "$TAGS" \
    --wait-for-state ACTIVE \
    --max-wait-seconds 300 \
    --output json > "$TMP_DIR/created-compartment.json"
  TARGET_COMPARTMENT_ID="$(json_scalar "$TMP_DIR/created-compartment.json" data.id)"
  sleep 5
fi

VCN_NAME="${STACK_NAME}-vcn"
oci network vcn list --compartment-id "$TARGET_COMPARTMENT_ID" --display-name "$VCN_NAME" --all --output json > "$TMP_DIR/vcns.json"
ensure_list_json "$TMP_DIR/vcns.json"
VCN_ID="$(resource_id_by_name "$TMP_DIR/vcns.json" "$VCN_NAME")"
if [[ -z "$VCN_ID" ]]; then
  echo "Creation du VCN..."
  oci network vcn create \
    --compartment-id "$TARGET_COMPARTMENT_ID" \
    --cidr-block "$VCN_CIDR" \
    --display-name "$VCN_NAME" \
    --dns-label cst \
    --freeform-tags "$TAGS" \
    --wait-for-state AVAILABLE \
    --max-wait-seconds 300 \
    --output json > "$TMP_DIR/created-vcn.json"
  VCN_ID="$(json_scalar "$TMP_DIR/created-vcn.json" data.id)"
fi

oci network vcn get --vcn-id "$VCN_ID" --output json > "$TMP_DIR/vcn.json"
DEFAULT_ROUTE_TABLE_ID="$(json_scalar "$TMP_DIR/vcn.json" data.default-route-table-id)"

IGW_NAME="${STACK_NAME}-igw"
oci network internet-gateway list --compartment-id "$TARGET_COMPARTMENT_ID" --vcn-id "$VCN_ID" --all --output json > "$TMP_DIR/igws.json"
ensure_list_json "$TMP_DIR/igws.json"
IGW_ID="$(resource_id_by_name "$TMP_DIR/igws.json" "$IGW_NAME")"
if [[ -z "$IGW_ID" ]]; then
  echo "Creation de la passerelle Internet..."
  oci network internet-gateway create \
    --compartment-id "$TARGET_COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --is-enabled true \
    --display-name "$IGW_NAME" \
    --freeform-tags "$TAGS" \
    --wait-for-state AVAILABLE \
    --max-wait-seconds 300 \
    --output json > "$TMP_DIR/created-igw.json"
  IGW_ID="$(json_scalar "$TMP_DIR/created-igw.json" data.id)"
fi

ROUTE_RULES="[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"${IGW_ID}\",\"description\":\"Sortie Internet CST\"}]"
oci network route-table update \
  --rt-id "$DEFAULT_ROUTE_TABLE_ID" \
  --route-rules "$ROUTE_RULES" \
  --force \
  --wait-for-state AVAILABLE \
  --max-wait-seconds 300 \
  --output json > /dev/null

SECURITY_LIST_NAME="${STACK_NAME}-subnet-sl"
oci network security-list list --compartment-id "$TARGET_COMPARTMENT_ID" --vcn-id "$VCN_ID" --all --output json > "$TMP_DIR/security-lists.json"
ensure_list_json "$TMP_DIR/security-lists.json"
SECURITY_LIST_ID="$(resource_id_by_name "$TMP_DIR/security-lists.json" "$SECURITY_LIST_NAME")"
EGRESS_RULES='[{"destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK","protocol":"all","isStateless":false,"description":"Sortie Internet CST"}]'
if [[ -z "$SECURITY_LIST_ID" ]]; then
  echo "Creation de la liste de securite sans entree publique..."
  oci network security-list create \
    --compartment-id "$TARGET_COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --display-name "$SECURITY_LIST_NAME" \
    --ingress-security-rules '[]' \
    --egress-security-rules "$EGRESS_RULES" \
    --freeform-tags "$TAGS" \
    --wait-for-state AVAILABLE \
    --max-wait-seconds 300 \
    --output json > "$TMP_DIR/created-security-list.json"
  SECURITY_LIST_ID="$(json_scalar "$TMP_DIR/created-security-list.json" data.id)"
else
  oci network security-list update \
    --security-list-id "$SECURITY_LIST_ID" \
    --ingress-security-rules '[]' \
    --egress-security-rules "$EGRESS_RULES" \
    --force \
    --wait-for-state AVAILABLE \
    --max-wait-seconds 300 \
    --output json > /dev/null
fi

SUBNET_NAME="${STACK_NAME}-subnet"
oci network subnet list --compartment-id "$TARGET_COMPARTMENT_ID" --vcn-id "$VCN_ID" --display-name "$SUBNET_NAME" --all --output json > "$TMP_DIR/subnets.json"
ensure_list_json "$TMP_DIR/subnets.json"
SUBNET_ID="$(resource_id_by_name "$TMP_DIR/subnets.json" "$SUBNET_NAME")"
if [[ -z "$SUBNET_ID" ]]; then
  echo "Creation du sous-reseau public controle..."
  oci network subnet create \
    --compartment-id "$TARGET_COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --cidr-block "$SUBNET_CIDR" \
    --display-name "$SUBNET_NAME" \
    --dns-label apps \
    --route-table-id "$DEFAULT_ROUTE_TABLE_ID" \
    --security-list-ids "[\"${SECURITY_LIST_ID}\"]" \
    --prohibit-public-ip-on-vnic false \
    --prohibit-internet-ingress false \
    --freeform-tags "$TAGS" \
    --wait-for-state AVAILABLE \
    --max-wait-seconds 300 \
    --output json > "$TMP_DIR/created-subnet.json"
  SUBNET_ID="$(json_scalar "$TMP_DIR/created-subnet.json" data.id)"
fi

NSG_NAME="${STACK_NAME}-nsg"
oci network nsg list --compartment-id "$TARGET_COMPARTMENT_ID" --vcn-id "$VCN_ID" --all --output json > "$TMP_DIR/nsgs.json"
ensure_list_json "$TMP_DIR/nsgs.json"
NSG_ID="$(resource_id_by_name "$TMP_DIR/nsgs.json" "$NSG_NAME")"
if [[ -z "$NSG_ID" ]]; then
  echo "Creation du groupe de securite reseau..."
  oci network nsg create \
    --compartment-id "$TARGET_COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --display-name "$NSG_NAME" \
    --freeform-tags "$TAGS" \
    --wait-for-state AVAILABLE \
    --max-wait-seconds 300 \
    --output json > "$TMP_DIR/created-nsg.json"
  NSG_ID="$(json_scalar "$TMP_DIR/created-nsg.json" data.id)"
fi

oci network nsg rules list --nsg-id "$NSG_ID" --all --output json > "$TMP_DIR/nsg-rules.json"
ensure_list_json "$TMP_DIR/nsg-rules.json"
RULES_MATCH="$(python3 - "$TMP_DIR/nsg-rules.json" "$ALLOWED_SSH_CIDR" <<'PY'
import json
import sys

rules = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
source = str(__import__("ipaddress").ip_network(sys.argv[2], strict=False))

def is_ssh(rule):
    ports = (rule.get("tcp-options") or {}).get("destination-port-range") or {}
    return (
        rule.get("direction") == "INGRESS"
        and str(rule.get("protocol")) == "6"
        and rule.get("source-type") == "CIDR_BLOCK"
        and rule.get("source") == source
        and ports.get("min") == 22
        and ports.get("max") == 22
    )

def is_egress(rule):
    return (
        rule.get("direction") == "EGRESS"
        and str(rule.get("protocol")) == "all"
        and rule.get("destination-type") == "CIDR_BLOCK"
        and rule.get("destination") == "0.0.0.0/0"
    )

print("true" if len(rules) == 2 and sum(map(is_ssh, rules)) == 1 and sum(map(is_egress, rules)) == 1 else "false")
PY
)"

if [[ "$RULES_MATCH" != "true" ]]; then
  mapfile -t OLD_RULE_IDS < <(python3 - "$TMP_DIR/nsg-rules.json" <<'PY'
import json
import sys

for item in json.load(open(sys.argv[1], encoding="utf-8")).get("data", []):
    if item.get("id"):
        print(item["id"])
PY
)
  if ((${#OLD_RULE_IDS[@]} > 0)); then
    OLD_RULE_IDS_JSON="$(printf '%s\n' "${OLD_RULE_IDS[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
    oci network nsg rules remove --nsg-id "$NSG_ID" --security-rule-ids "$OLD_RULE_IDS_JSON" --output json > /dev/null
  fi
  NSG_RULES="[{\"direction\":\"INGRESS\",\"protocol\":\"6\",\"source\":\"${ALLOWED_SSH_CIDR}\",\"sourceType\":\"CIDR_BLOCK\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}},\"description\":\"SSH depuis le poste CST\"},{\"direction\":\"EGRESS\",\"protocol\":\"all\",\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"isStateless\":false,\"description\":\"Sortie Internet CST\"}]"
  oci network nsg rules add --nsg-id "$NSG_ID" --security-rules "$NSG_RULES" --output json > /dev/null
fi

if [[ -z "$EXISTING_INSTANCE_ID" ]]; then
  echo "Creation de la VM A1 (essai des domaines de disponibilite disponibles)..."
  SHAPE_CONFIG="{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}"
  NSG_IDS="[\"${NSG_ID}\"]"
  for availability_domain in "${AVAILABILITY_DOMAINS[@]}"; do
    oci iam fault-domain list \
      --compartment-id "$TARGET_COMPARTMENT_ID" \
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

    CAPACITY_SHAPES="$(python3 - "$SHAPE" "$OCPUS" "$MEMORY_GB" "${FAULT_DOMAINS[@]}" <<'PY'
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

    capacity_report_ok=0
    for report_attempt in 1 2 3; do
      if oci compute compute-capacity-report create \
        --availability-domain "$availability_domain" \
        --compartment-id "$TARGET_COMPARTMENT_ID" \
        --shape-availabilities "$CAPACITY_SHAPES" \
        --output json > "$TMP_DIR/capacity-report.json" 2> "$TMP_DIR/capacity-error.txt"; then
        capacity_report_ok=1
        break
      fi
      if grep -Eqi 'TooManyRequests|too many requests' "$TMP_DIR/capacity-error.txt"; then
        sleep 20
        continue
      fi
      sed -n '1,12p' "$TMP_DIR/capacity-error.txt" >&2
      exit 4
    done
    if ((capacity_report_ok == 0)); then
      echo "Le rapport de capacite OCI reste limite apres trois essais." >&2
      exit 4
    fi

    mapfile -t AVAILABLE_FAULT_DOMAINS < <(python3 - "$TMP_DIR/capacity-report.json" <<'PY'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", {}).get("shape-availabilities", [])
for item in items:
    if item.get("availability-status") == "AVAILABLE" and item.get("fault-domain"):
        print(item["fault-domain"])
PY
)
    launch_args=(
      compute instance launch
      --availability-domain "$availability_domain"
      --compartment-id "$TARGET_COMPARTMENT_ID"
      --display-name "$INSTANCE_NAME"
      --hostname-label cst
      --shape "$SHAPE"
      --shape-config "$SHAPE_CONFIG"
      --image-id "$IMAGE_ID"
      --boot-volume-size-in-gbs "$BOOT_VOLUME_GB"
      --subnet-id "$SUBNET_ID"
      --assign-public-ip true
      --nsg-ids "$NSG_IDS"
      --ssh-authorized-keys-file "$SSH_PUBLIC_KEY"
      --is-pv-encryption-in-transit-enabled true
      --freeform-tags "$TAGS"
      --output json
    )
    if ((${#AVAILABLE_FAULT_DOMAINS[@]} == 0)); then
      echo "Capacite A1 indisponible dans tous les fault domains de ${availability_domain}." >&2
      echo "Essai sans fault domain afin de laisser OCI choisir le meilleur placement..." >&2
      for request_attempt in 1 2 3; do
        if oci "${launch_args[@]}" > "$TMP_DIR/launched-instance.json" 2> "$TMP_DIR/launch-error.txt"; then
          EXISTING_INSTANCE_ID="$(json_scalar "$TMP_DIR/launched-instance.json" data.id)"
          break 2
        fi
        if grep -Eqi 'TooManyRequests|too many requests' "$TMP_DIR/launch-error.txt"; then
          sleep 20
          continue
        fi
        if grep -Eqi 'out of host capacity|OutOfHostCapacity' "$TMP_DIR/launch-error.txt"; then
          break
        fi
        sed -n '1,12p' "$TMP_DIR/launch-error.txt" >&2
        exit 4
      done
      continue
    fi

    for fault_domain in "${AVAILABLE_FAULT_DOMAINS[@]}"; do
      fault_launch_args=("${launch_args[@]}")
      fault_launch_args+=(--fault-domain "$fault_domain")
      for request_attempt in 1 2 3; do
        if oci "${fault_launch_args[@]}" > "$TMP_DIR/launched-instance.json" 2> "$TMP_DIR/launch-error.txt"; then
          EXISTING_INSTANCE_ID="$(json_scalar "$TMP_DIR/launched-instance.json" data.id)"
          break 3
        fi
        if grep -Eqi 'TooManyRequests|too many requests' "$TMP_DIR/launch-error.txt"; then
          sleep 20
          continue
        fi
        if grep -Eqi 'out of host capacity|OutOfHostCapacity' "$TMP_DIR/launch-error.txt"; then
          echo "La capacite de ${availability_domain}/${fault_domain} a disparu entre le rapport et le lancement." >&2
          break
        fi
        sed -n '1,12p' "$TMP_DIR/launch-error.txt" >&2
        exit 4
      done
    done
  done
  [[ -n "$EXISTING_INSTANCE_ID" ]] || { echo "Aucune capacite A1 disponible actuellement." >&2; exit 5; }
elif [[ "$EXISTING_INSTANCE_STATE" == "STOPPED" ]]; then
  echo "Demarrage de la VM CST existante..."
  oci compute instance action \
    --instance-id "$EXISTING_INSTANCE_ID" \
    --action START \
    --output json > /dev/null
elif [[ "$EXISTING_INSTANCE_STATE" != "RUNNING" &&
        "$EXISTING_INSTANCE_STATE" != "STARTING" &&
        "$EXISTING_INSTANCE_STATE" != "PROVISIONING" ]]; then
  echo "Etat de VM non reconciliable automatiquement: $EXISTING_INSTANCE_STATE" >&2
  exit 4
fi

oci compute instance get \
  --instance-id "$EXISTING_INSTANCE_ID" \
  --wait-for-state RUNNING \
  --wait-interval-seconds 10 \
  --max-wait-seconds 1200 \
  --output json > "$TMP_DIR/running-instance.json"

oci compute instance list-vnics --instance-id "$EXISTING_INSTANCE_ID" --all --output json > "$TMP_DIR/vnics.json"
ensure_list_json "$TMP_DIR/vnics.json"
PUBLIC_IP="$(python3 - "$TMP_DIR/vnics.json" <<'PY'
import ipaddress
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8")).get("data", [])
addresses = [item.get("public-ip") for item in items if item.get("lifecycle-state") == "AVAILABLE" and item.get("public-ip")]
if len(addresses) != 1:
    raise SystemExit("Impossible de determiner une adresse IPv4 publique unique pour la VM.")
print(ipaddress.ip_address(addresses[0]))
PY
)"

echo "Pile OCI prete. Le service CST restera lie a 127.0.0.1 sur la VM."
echo "CST_ORACLE_INSTANCE_ID=${EXISTING_INSTANCE_ID}"
echo "CST_ORACLE_PUBLIC_IP=${PUBLIC_IP}"
echo "CST_ORACLE_SSH_TARGET=ubuntu@${PUBLIC_IP}"
