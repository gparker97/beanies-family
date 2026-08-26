#!/usr/bin/env bash
#
# Assert the SHIPPED iOS binaries actually carry the app-group entitlement (#64).
#
# WHY. `containerURL(forSecurityApplicationGroupIdentifier:)` returns nil when the
# entitlement is missing, and nil is indistinguishable at runtime from "nothing was
# shared". Three TestFlight builds went out before CloudWatch identified this, because
# nothing between the entitlements FILE and the user's phone ever checks that the
# entitlement survived signing — and it can be lost in two independent ways:
#
#   1. the archive is built with CODE_SIGN_ENTITLEMENTS='' (gym's skip_codesigning), so
#      xcodebuild never learns the app needs app groups when it provisions; or
#   2. the App ID in the Developer portal does not have App Groups enabled with this
#      group assigned, so the profile cannot grant it however the archive is built.
#
# This prints BOTH the binary's entitlements and the embedded profile's, which is what
# separates those two causes, and then fails the build if the group is absent.
set -euo pipefail

IPA="${1:-build/beanies.ipa}"
REQUIRED_GROUP="group.family.beanies.app"

[ -f "$IPA" ] || { echo "✖ no IPA at $IPA"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$IPA" -d "$WORK"

APP="$(find "$WORK/Payload" -maxdepth 1 -name '*.app' | head -1)"
[ -n "$APP" ] || { echo "✖ no .app inside $IPA"; exit 1; }

# The app and every extension it embeds. The extension needs the SAME group: it is the
# only channel between the two processes, and one side having it is no use at all.
TARGETS=("$APP")
while IFS= read -r appex; do TARGETS+=("$appex"); done < <(find "$APP/PlugIns" -maxdepth 1 -name '*.appex' 2>/dev/null || true)

missing=()
for target in "${TARGETS[@]}"; do
  name="$(basename "$target")"
  echo ""
  echo "── $name ────────────────────────────────────────────"

  ents="$(codesign -d --entitlements - --xml "$target" 2>/dev/null | plutil -convert xml1 -o - - 2>/dev/null || true)"
  echo "  signed entitlements:"
  if [ -n "$ents" ]; then echo "$ents" | sed 's/^/    /'; else echo "    (none — the binary carries NO entitlements)"; fi

  profile="$WORK/$name.profile.plist"
  if security cms -D -i "$target/embedded.mobileprovision" -o "$profile" 2>/dev/null; then
    echo "  provisioning profile grants:"
    /usr/libexec/PlistBuddy -c 'Print :Entitlements' "$profile" 2>/dev/null | sed 's/^/    /' || echo "    (unreadable)"
  else
    echo "  provisioning profile: (absent or unreadable)"
  fi

  case "$ents" in
    *"$REQUIRED_GROUP"*) echo "  ✓ $REQUIRED_GROUP present" ;;
    *) echo "  ✖ $REQUIRED_GROUP MISSING"; missing+=("$name") ;;
  esac
done

if [ ${#missing[@]} -gt 0 ]; then
  cat >&2 <<MSG

✖ ${#missing[@]} shipped binary/binaries do NOT carry $REQUIRED_GROUP:
$(printf '    %s\n' "${missing[@]}")

Sharing to beanies CANNOT work in this build: the app group is the only channel between
the Share Extension and the app, and without the entitlement the container is nil on both
sides. It fails silently on device — the share sheet accepts the item and nothing happens.

Read the two dumps above to tell the causes apart:
  - profile GRANTS the group but the binary lacks it  → a signing/export problem here.
  - profile does NOT grant it                          → the App ID in the Developer portal
    needs App Groups enabled with $REQUIRED_GROUP assigned, for BOTH
    family.beanies.app and family.beanies.app.ShareExtension.
MSG
  exit 1
fi

echo ""
echo "✓ all ${#TARGETS[@]} shipped binary/binaries carry $REQUIRED_GROUP"
