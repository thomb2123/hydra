#!/usr/bin/env bash
# Builds Amazon's Vega-patched Shaka Player (needed for HLS/DASH, i.e. live TV)
# and copies the compiled player plus Amazon's polyfills into
#   shared/src/player/shaka/vendor/   (git-ignored: Amazon Program Materials)
#
# Source: https://developer.amazon.com/docs/vega/2.0/media-player-shaka-player.html
# Needs: git, python3, node/npm, Java 21+.
#
# Workarounds baked in (verified 17 Nov 2026):
# - Shaka's git-hosted dev dependencies (eslint config, jsdoc, karma, ua-parser)
#   are only for linting/docs/tests and are dropped; Closure Library is cloned.
# - JAVA_TOOL_OPTIONS makes `java -version` print an extra first line that
#   breaks Shaka's version check, so it is unset for the compile.
set -euo pipefail

SHAKA_VERSION=4.16.13
PATCH_URL="https://amzndevresources.com/vega/media-player/shaka-rel-v${SHAKA_VERSION}-r1.2-devices_scope.tar.gz"
CLOSURE_SHA=74db0395c2bef5fee6eef754d85ccf824b5fde45

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$ROOT/shared/src/player/shaka/vendor"
WORK="${SHAKA_WORK:-$(mktemp -d)}"
echo "Working in $WORK"
cd "$WORK"

curl -fsSL -o shaka-rel.tar.gz "$PATCH_URL"
tar xzf shaka-rel.tar.gz --warning=no-unknown-keyword --exclude='._*' 2>/dev/null || tar xzf shaka-rel.tar.gz --exclude='._*'

rm -rf shaka-player closure-library
git clone -q --branch "v${SHAKA_VERSION}" --depth 1 https://github.com/shaka-project/shaka-player.git
(cd shaka-player && git checkout -q -b "amz_${SHAKA_VERSION}" \
  && git -c user.name=build -c user.email=build@localhost am -3 ../shaka-rel/shaka-patch/*.patch)

mkdir closure-library
(cd closure-library && git init -q && git remote add origin https://github.com/joeyparrish/closure-library.git \
  && git fetch -q --depth 1 origin "$CLOSURE_SHA" && git checkout -q FETCH_HEAD && rm -rf .git)

cd shaka-player
python3 - <<'EOF'
import json
p = json.load(open('package.json'))
for k in ['eslint-config-google', 'jsdoc', 'karma', 'ua-parser-js', 'google-closure-library']:
    p.get('devDependencies', {}).pop(k, None)
json.dump(p, open('package.json', 'w'), indent=2)
EOF
rm -f package-lock.json
npm install --no-audit --no-fund --legacy-peer-deps --ignore-scripts
cp -r ../closure-library node_modules/google-closure-library
sleep 1 && touch node_modules/.last_update

env -u JAVA_TOOL_OPTIONS python3 build/build.py --name compiled +@complete -@ui -@polyfillForUI --force --mode release

mkdir -p "$OUT/polyfills"
cp dist/shaka-player.compiled.js "$OUT/shaka-player.compiled.js"
cp ../shaka-rel/src/polyfills/*.ts "$OUT/polyfills/"
echo "Shaka ${SHAKA_VERSION} (Vega patches r1.2) -> $OUT"
