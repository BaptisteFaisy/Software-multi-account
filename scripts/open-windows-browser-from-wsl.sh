#!/usr/bin/env bash
set -euo pipefail

url="${1:?URL Google manquante}"
launcher="/mnt/c/Windows/System32/rundll32.exe"

if [[ ! -x "$launcher" ]]; then
  echo "Le navigateur Windows ne peut pas etre ouvert depuis WSL." >&2
  exit 2
fi

exec "$launcher" url.dll,FileProtocolHandler "$url"
