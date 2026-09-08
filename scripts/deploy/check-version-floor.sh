#!/usr/bin/env bash
# Print the update floor next to the version being shipped, so the deploy
# decision gate can ask about raising it.
#
# WHY THIS EXISTS. `web/public/min-app-version.json` sets `promptBelowVersion`,
# which is what asks a native user to update. It is edited by hand and lags
# APP_VERSION indefinitely, because nothing ever prompts anyone to think about
# it. That was harmless until pod compaction shipped: a device below the floor
# can overwrite a compacted pod with its own pre-compaction copy, and the edits
# it made in between are not recoverable (see
# docs/investigations/2026-09-08-compaction-fallout.md).
#
# It PROMPTS, it does not block: `versionPolicy.ts` has no hard-block field.
# Raising it is therefore cheap and reversible, which is the argument for asking
# every time rather than only when someone remembers.
set -euo pipefail

FLOOR_FILE="web/public/min-app-version.json"
VERSION_FILE="src/constants/appVersion.ts"

floor=$(grep -o '"promptBelowVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$FLOOR_FILE" \
  | sed 's/.*"\([^"]*\)"$/\1/')
shipping=$(grep -o "APP_VERSION = '[^']*'" "$VERSION_FILE" | sed "s/.*'\([^']*\)'/\1/")

echo "update floor (promptBelowVersion): ${floor}"
echo "version being shipped (APP_VERSION): ${shipping}"

if [ "$floor" = "$shipping" ]; then
  echo "floor is current — nothing to ask."
else
  echo "floor LAGS the shipping version."
  echo "ASK GREG: raise promptBelowVersion to ${shipping}? (default: no)"
  echo "Raise it when this release fixes something a stale device can do to the"
  echo "family's data. Leave it when the release is additive."
fi
