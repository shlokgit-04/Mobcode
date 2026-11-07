#!/usr/bin/env bash
# Mobcode Android release packaging.
# Verifies signatures & badging, and copies deliverables into
# dist/android/{debug,release,playstore} + store artwork into dist/meta.
# Web assets are re-synced from public/ every run.
#
# Requires: JAVA_HOME (21) + ANDROID_HOME set, Android build-tools 36.0.0.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/dist/android"
mkdir -p "$OUT/debug" "$OUT/release" "$OUT/playstore" "$ROOT/dist/meta"

# 1. web assets fresh from public/
node scripts/prepare-android.mjs
npx cap sync android >/dev/null

# 2. builds — default: android/gradlew (downloads Gradle once on first run).
# Override for offline/cached environments, e.g.:
#   GRADLE_BIN=/opt/gradle/bin/gradle GRADLE_ARGS="-g /path/to/gradle-home" bash scripts/package-android.sh
GRADLE_BIN="${GRADLE_BIN:-./gradlew}"
(
  cd android
  # shellcheck disable=SC2086
  "$GRADLE_BIN" --no-daemon ${GRADLE_ARGS:-} assembleDebug assembleRelease bundleRelease
)
cd "$ROOT"

DEB="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
REL="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
AAB="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
for f in "$DEB" "$REL" "$AAB"; do
  [ -s "$f" ] || { echo "MISSING BUILD OUTPUT: $f"; exit 1; }
done

# 3. verification
BT="${ANDROID_HOME:-$HOME/android-sdk}/build-tools/36.0.0"
echo "== signature checks =="
"$BT/apksigner" verify --print-certs "$REL" | grep -E "Signer #1 certificate DN"
keytool -printcert -jarfile "$AAB" | grep -m1 "Owner:"
"$BT/apksigner" verify --print-certs "$DEB" | grep -m1 "certificate DN"

echo "== badging =="
"$BT/aapt2" dump badging "$REL" | grep -E "^package|targetSdkVersion|minSdkVersion" | head -3

# 4. named deliverables
cp -f "$DEB" "$OUT/debug/Mobcode-debug.apk"
cp -f "$REL" "$OUT/release/Mobcode-release.apk"
cp -f "$AAB" "$OUT/playstore/Mobcode-release.aab"

# 5. store artwork
bash "$ROOT/scripts/play-artwork.sh" || cp -f "$ROOT/assets/icon.png" "$ROOT/dist/meta/icon-512.png"

echo "dist/ ready:"
find "$OUT" "$ROOT/dist/meta" -type f -printf "%-62p %s bytes\n"
