#!/usr/bin/env bash
# Connects to a Vega Fire TV stick over the network and installs .vpkg files.
#
# Usage:
#   ./install-apps.sh <stick-ip> [package.vpkg ...]
# With no packages it installs every *_armv7.vpkg next to this repo's
# vega-tv/release folder.
#
# Prerequisites on the stick (one time):
#   - Developer Mode enabled (see vega-tv/README.md, "Enable Developer Mode");
#   - Settings > My Fire TV > About > Developer Options > Connection Mode >
#     "Use standard port 5555" (the stick reboots).
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <stick-ip> [package.vpkg ...]" >&2
  exit 2
fi
IP="$1"
shift
TARGET="$IP:5555"

if ! command -v vega >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  [[ -f "$HOME/vega/env" ]] && source "$HOME/vega/env"
fi
command -v vega >/dev/null 2>&1 || { echo "vega CLI not found. Run setup-vega-cli.sh first." >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE="$(cd "$HERE/../../release" 2>/dev/null && pwd || true)"
PACKAGES=("$@")
if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  mapfile -t PACKAGES < <(ls "$RELEASE"/*_armv7.vpkg 2>/dev/null || true)
fi
[[ ${#PACKAGES[@]} -gt 0 ]] || { echo "No .vpkg files given or found in $RELEASE" >&2; exit 1; }

echo "==> Connecting to $TARGET"
# vda connect exits 0 even when it fails, so check the device list instead.
vega exec vda connect "$TARGET" || true
if ! vega exec vda devices | grep -qE "^${TARGET//./\\.}[[:space:]]+device"; then
  vega exec vda devices
  cat >&2 <<EOF
Could not connect to $TARGET.
Check that:
  - the stick and PC are on the same network and $IP is the stick's address
    (Settings > My Fire TV > About > Network);
  - Developer Mode shows "Enabled" (Settings > My Fire TV > Developer Options);
  - Developer Options > Connection Mode is set to TCP/IP on port 5555;
  - if WSL uses NAT networking and this keeps failing, try mirrored networking
    (vega-tv/scripts/windows/wslconfig.example).
EOF
  exit 1
fi
vega exec vda devices

if [[ -n "$RELEASE" && -f "$RELEASE/SHA256SUMS" ]]; then
  echo "==> Verifying checksums"
  (cd "$RELEASE" && sha256sum -c SHA256SUMS --ignore-missing)
fi

for pkg in "${PACKAGES[@]}"; do
  echo "==> Installing $pkg"
  vega device install-app --device "$TARGET" --packagePath "$pkg"
done

echo "==> Installed packages from this project:"
vega device installed-packages --device "$TARGET" | grep -E '^dev\.vegatv\.' || true
echo
echo "Launch from the Fire TV home screen (Your Apps), or e.g.:"
echo "  vega device launch-app --device $TARGET --appName dev.vegatv.poc.main"
