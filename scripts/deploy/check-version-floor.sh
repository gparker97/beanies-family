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

# `|| true` then an explicit check: under `set -euo pipefail` a grep miss would
# otherwise kill the script mid-pipeline with no output, and a deploy gate that
# dies silently is a deploy gate that gets skipped.
floor=$(grep -o '"promptBelowVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$FLOOR_FILE" \
  | sed 's/.*"\([^"]*\)"$/\1/' || true)
shipping=$(grep -o "APP_VERSION = '[^']*'" "$VERSION_FILE" | sed "s/.*'\([^']*\)'/\1/" || true)

if [ -z "$floor" ] || [ -z "$shipping" ]; then
  echo "ERROR: could not read the floor ($FLOOR_FILE) or APP_VERSION ($VERSION_FILE)." >&2
  echo "Do not skip the floor question — read both files by hand." >&2
  exit 1
fi

echo "update floor (promptBelowVersion): ${floor}"
echo "version being shipped (APP_VERSION): ${shipping}"

if [ "$floor" = "$shipping" ]; then
  echo "floor is current — nothing to ask."
  exit 0
fi

echo
echo "The floor differs from the shipping version. A NORMAL RELEASE DOES NOT RAISE IT"
echo "(docs/runbooks/native-store-submission.md section 7)."
echo
echo "Propose raising it ONLY if BOTH are true, and say which:"
echo "  1. ${shipping} is already LIVE ON BOTH STORES. Not TestFlight. Not Play open"
echo "     testing. Live. Prompting people to fetch a version Apple has not finished"
echo "     reviewing sends them to a listing that still offers the old one."
echo "     ⚠️ THIS IS THE ONE THAT GETS SKIPPED. It was skipped on 2026-09-08."
echo "  2. A device below the floor can DAMAGE THE FAMILY'S DATA, not merely miss a"
echo "     feature. Live example: a pre-compaction device can overwrite a compacted"
echo "     pod, and the edits made on it in between are not recoverable."
echo
echo "If either fails, leave it and say so in one line. The floor prompts rather than"
echo "blocks, so it is cheap to raise later and there is no cost to waiting."
echo
echo "⚠️ The file reaches users only via deploy-web.yml. On an app-only deploy,"
echo "raising it commits a change that publishes nothing."
