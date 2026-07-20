#!/usr/bin/env bash
set -euo pipefail

case "$(uname -m)" in
  x86_64) sdk_arch="x86_64" ;;
  aarch64|arm64) sdk_arch="arm" ;;
  *)
    echo "Architecture WSL non prise en charge: $(uname -m)" >&2
    exit 2
    ;;
esac

target="${HOME}/.local/share/codex-switch-terminal/google-cloud-sdk"
launcher="${HOME}/.local/bin/gcloud"

if [[ ! -x "${target}/bin/gcloud" ]]; then
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf -- "${tmp_dir}"' EXIT

  curl -fL --retry 3 --connect-timeout 20 \
    "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-${sdk_arch}.tar.gz" \
    -o "${tmp_dir}/google-cloud-cli.tar.gz"
  tar -xzf "${tmp_dir}/google-cloud-cli.tar.gz" -C "${tmp_dir}"
  mkdir -p "$(dirname "${target}")" "$(dirname "${launcher}")"
  mv "${tmp_dir}/google-cloud-sdk" "${target}"
fi

ln -sfn "${target}/bin/gcloud" "${launcher}"
CLOUDSDK_CORE_DISABLE_PROMPTS=1 "${launcher}" version
