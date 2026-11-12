#!/usr/bin/env bash
# Sets up the Amazon Vega CLI inside WSL2 Ubuntu (24.04 or 22.04) on Windows.
#
# Amazon officially supports only native Ubuntu x86_64 and macOS as Vega hosts.
# WSL2 is NOT an Amazon-supported setup; this script exists so the PC can
# enable Developer Mode and sideload prebuilt .vpkg files. Building apps is
# done elsewhere (the packages in vega-tv/release were built on native Ubuntu).
#
# What it does:
#   1. installs curl, jq, lz4 and build-essential via apt (asks for sudo);
#   2. runs Amazon's official installer (same command as the Vega docs);
#   3. opts out of Vega SDK telemetry.
set -euo pipefail

if ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "Note: this does not look like WSL. The script still works on native Ubuntu."
fi

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "The Vega SDK only ships for x86_64 Linux. Found $(uname -m)." >&2
  exit 1
fi

echo "==> Installing prerequisites (sudo password may be requested)"
sudo apt-get update -y
sudo apt-get install -y curl jq lz4 build-essential ca-certificates

if [[ "$(command -v curl)" == /snap/* ]]; then
  echo "Snap curl breaks the Vega installer. Run: sudo snap remove curl && sudo apt install curl" >&2
  exit 1
fi

echo "==> Running Amazon's Vega installer (downloads ~5 GB including the SDK)"
echo "    Source: https://developer.amazon.com/docs/vega/2.0/install-vega-sdk.html"
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash
# shellcheck disable=SC1090
source "$HOME/vega/env"

TELEMETRY="$HOME/vega/telemetry/config.json"
if [[ -f "$TELEMETRY" ]]; then
  tmp="$(mktemp)"
  jq '.optIn = false' "$TELEMETRY" > "$tmp" && mv "$tmp" "$TELEMETRY"
  echo "==> Vega telemetry disabled ($TELEMETRY)"
fi

echo
vega --version
echo
echo "Done. Open a new WSL terminal (or run: source ~/vega/env) before using 'vega'."
