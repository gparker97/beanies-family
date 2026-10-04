#!/usr/bin/env bash
# Classify which deploy + release pipelines need to run, by diffing HEAD against
# the SHA each pipeline last shipped from. Designed to be called from the deploy
# skills as a single pre-approved command, replacing inline shell expansions that
# would otherwise trigger permission prompts.
#
# Output: human-readable summary followed by a machine-readable block:
#
#     === Deploy targets ===
#     VUE: yes|no
#     WEB: yes|no
#     MOBILE_IOS: yes|no
#     MOBILE_ANDROID: yes|no
#
# Exit is always 0. The caller branches on the flags.
#
# ── Four independent distributables, four baselines ──────────────────────────
# beanies ships the SAME app four ways, and each lags the others until it is
# rebuilt from a newer SHA. This script answers, per distributable, "is it behind
# HEAD?" by diffing against the last SHA IT shipped from:
#
#   VUE          the Vue PWA at app.beanies.family        (deploy.yml)
#   WEB          the Astro marketing site at the apex      (deploy-web.yml)
#   MOBILE_IOS   the iOS app on TestFlight / App Store      (mobile-ios-release.yml)
#   MOBILE_ANDROID  the Android app on Google Play          (mobile-android-release.yml)
#
# ── Why the native apps must track the WEB BUNDLE, not just native files ──────
# The iOS/Android apps EMBED the built Vue bundle (`npm run build` → dist/ →
# `npx cap sync`). capacitor.config.ts has no `server.url`, so the WebView serves
# that LOCAL bundle — there is no over-the-air web layer. Consequence: a change to
# `src/**` / `index.html` (a "web-only" fix) reaches app-store users ONLY through a
# new signed app build. So a native release is warranted when, since that platform's
# last release, EITHER the embedded web bundle changed OR its native shell changed.
# The old classifier counted only native-shell files and so reported MOBILE:no for
# exactly the web fixes that most needed a rebuild.
#
# ── Why NOT the debug-APK lane for the mobile baseline ───────────────────────
# `mobile-android-build.yml` (free unsigned debug APK) auto-runs on EVERY push to
# main, so its last-success SHA equals HEAD moments after any push — using it as the
# baseline made MOBILE read "no" even right after a native change with no signed
# release. The signed-release lanes are the true "last shipped to a store/TestFlight"
# markers. iOS and Android ship INDEPENDENTLY (this repo has released iOS while
# holding Android back and vice-versa), so each has its own baseline + flag.
#
# ── Path rules (must stay in sync with the deploy skill docs) ────────────────
#   Web bundle (→ VUE + embedded in both native apps):
#       src/**, public/**, root build files (index.html, vite/ts/tailwind/postcss
#       config, package*.json) — i.e. everything NOT in the exclude set below.
#   Astro marketing (→ WEB only, NOT embedded in the native apps):
#       web/**, packages/**, content/** (blog + guides), src/content/help/**
#   iOS native shell:     ios/**  + shared-native
#   Android native shell: android/**  + shared-native
#   Shared-native (→ both apps): capacitor.config.*, patches/** (patch-package
#       diffs applied on npm ci), scripts/build-native-app-assets* (icon/splash gen)
#   Ships nothing (excluded everywhere): .claude/**, .github/**, docs/**, tasks/**,
#       scripts/** (except build-native-app-assets*), infrastructure/**, README,
#       CHANGELOG, LICENSE, SECURITY, TRADEMARK, POSTMORTEM
#
# packages/** feeds BOTH web workflows (brand tokens each app consumes).
#
# ── Baselines that are not in this clone ─────────────────────────────────────
# A pipeline's last-shipped SHA can be missing locally: after a history rewrite
# (2026-10-03: every pre-rewrite SHA vanished) or a force-push. The old fallback
# diffed only the tip commit, so on 2026-10-04 a `web/public/` floor change two
# commits back read WEB: no and the Astro deploy was skipped. Now each baseline
# walks back through recent successful runs to the newest SHA this clone has
# (diffing from an OLDER ship is a superset, so it can over-deploy, never
# under-deploy). If none of them exist here, the target reads "yes" with a warning.

set -euo pipefail

HEAD_SHA=$(git rev-parse --short HEAD)

have_commit() {
  [ -n "$1" ] && git rev-parse --quiet --verify "${1}^{commit}" >/dev/null 2>&1
}

# Resolve one pipeline's baseline. Prints "<sha> <state>":
#   exact        the latest successful run's SHA exists here
#   older        the latest is missing; <sha> is the newest earlier ship that exists
#   unreachable  no recent ship exists here; <sha> is the latest (for display)
#   never        the pipeline has never succeeded; <sha> is "-"
resolve_baseline() {
  local workflow="$1" shas sha latest=""
  shas=$(gh run list --workflow="$workflow" --status=success --limit=30 --json headSha --jq '.[].headSha')
  for sha in $shas; do
    [ -z "$latest" ] && latest="$sha"
    if have_commit "$sha"; then
      if [ "$sha" = "$latest" ]; then echo "$sha exact"; else echo "$sha older"; fi
      return
    fi
  done
  if [ -z "$latest" ]; then echo "- never"; else echo "$latest unreachable"; fi
}

read -r LAST_VUE_SHA VUE_BASE <<<"$(resolve_baseline deploy.yml)"
read -r LAST_WEB_SHA WEB_BASE <<<"$(resolve_baseline deploy-web.yml)"
read -r LAST_IOS_SHA IOS_BASE <<<"$(resolve_baseline mobile-ios-release.yml)"
read -r LAST_ANDROID_SHA ANDROID_BASE <<<"$(resolve_baseline mobile-android-release.yml)"
[ "$LAST_VUE_SHA" = "-" ] && LAST_VUE_SHA=""
[ "$LAST_WEB_SHA" = "-" ] && LAST_WEB_SHA=""
[ "$LAST_IOS_SHA" = "-" ] && LAST_IOS_SHA=""
[ "$LAST_ANDROID_SHA" = "-" ] && LAST_ANDROID_SHA=""

# Only a baseline that exists here is diffed. A missing one yields no file list and
# forces "yes" below (no baseline means we cannot prove the target is current).
diff_since() {
  local sha="$1"
  if have_commit "$sha"; then
    git diff --name-only "$sha" HEAD
  fi
}

commits_behind() {
  local sha="$1"
  if have_commit "$sha"; then
    git rev-list --count "${sha}..HEAD"
  else
    echo "?"
  fi
}

VUE_CHANGES=$(diff_since "$LAST_VUE_SHA" || true)
WEB_CHANGES=$(diff_since "$LAST_WEB_SHA" || true)
IOS_CHANGES=$(diff_since "$LAST_IOS_SHA" || true)
ANDROID_CHANGES=$(diff_since "$LAST_ANDROID_SHA" || true)

WEB_PATTERNS='^(web/|packages/|content/|src/content/help/)'
# The embedded web bundle = everything NOT excluded. Native-shell paths are excluded
# here (they are matched separately, per platform, below) so they are not double-counted.
BUNDLE_EXCLUDE='^(web/|content/|src/content/help/|android/|ios/|capacitor\.config\.|patches/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)'
IOS_NATIVE='^(ios/|capacitor\.config\.|patches/|scripts/build-native-app-assets)'
ANDROID_NATIVE='^(android/|capacitor\.config\.|patches/|scripts/build-native-app-assets)'

count_lines() {
  # Counts non-empty lines; returns 0 for empty input.
  printf '%s' "$1" | grep -c . || true
}

# Union of the embedded-bundle changes and the platform's native-shell changes, since
# that platform's last release. `sort -u` dedupes (a file matches at most one pattern,
# but the union stays defensive).
platform_hits() {
  local changes="$1" native="$2"
  {
    printf '%s\n' "$changes" | grep -Ev "$BUNDLE_EXCLUDE" || true
    printf '%s\n' "$changes" | grep -E "$native" || true
  } | grep -v '^$' | sort -u || true
}

WEB_HITS=$(printf '%s\n' "$WEB_CHANGES" | grep -E "$WEB_PATTERNS" || true)
VUE_HITS=$(printf '%s\n' "$VUE_CHANGES" | grep -Ev "$BUNDLE_EXCLUDE" || true)
IOS_HITS=$(platform_hits "$IOS_CHANGES" "$IOS_NATIVE")
ANDROID_HITS=$(platform_hits "$ANDROID_CHANGES" "$ANDROID_NATIVE")

VUE_COUNT=$(count_lines "$VUE_HITS")
WEB_COUNT=$(count_lines "$WEB_HITS")
IOS_COUNT=$(count_lines "$IOS_HITS")
ANDROID_COUNT=$(count_lines "$ANDROID_HITS")

print_hits() {
  local label="$1" count="$2" hits="$3"
  echo "$label (${count}):"
  if [ "$count" -gt 0 ]; then
    printf '%s\n' "$hits" | head -10 | sed 's/^/  /'
    if [ "$count" -gt 10 ]; then
      echo "  ...and $((count - 10)) more"
    fi
  else
    echo "  (none)"
  fi
  echo
}

base_note() {
  case "$1" in
    older) echo "  [latest ship not in this clone; diffing from an older ship]" ;;
    unreachable) echo "  [NO recent ship in this clone; baseline unknown]" ;;
    *) echo "" ;;
  esac
}

echo "HEAD:                $HEAD_SHA"
echo "Last Vue deploy:     ${LAST_VUE_SHA:-(never shipped)}  ($(commits_behind "$LAST_VUE_SHA") commit(s) behind)$(base_note "$VUE_BASE")"
echo "Last Web deploy:     ${LAST_WEB_SHA:-(never shipped)}  ($(commits_behind "$LAST_WEB_SHA") commit(s) behind)$(base_note "$WEB_BASE")"
echo "Last iOS release:    ${LAST_IOS_SHA:-(never released)}  ($(commits_behind "$LAST_IOS_SHA") commit(s) behind)$(base_note "$IOS_BASE")"
echo "Last Android release:${LAST_ANDROID_SHA:-(never released)}  ($(commits_behind "$LAST_ANDROID_SHA") commit(s) behind)$(base_note "$ANDROID_BASE")"
echo

for pair in "Vue:$VUE_BASE" "Web:$WEB_BASE" "iOS:$IOS_BASE" "Android:$ANDROID_BASE"; do
  if [ "${pair#*:}" = "unreachable" ]; then
    echo "WARNING: ${pair%%:*} last shipped from a commit this clone does not have (history"
    echo "         rewrite or force-push?), and no older ship is here either. Reporting"
    echo "         \"yes\" because there is no baseline to prove it is current."
    echo
  fi
done

print_hits "Vue-app files needing redeploy" "$VUE_COUNT" "$VUE_HITS"
print_hits "Astro-site files needing redeploy" "$WEB_COUNT" "$WEB_HITS"
print_hits "Changes not in the last iOS build (web bundle + iOS native)" "$IOS_COUNT" "$IOS_HITS"
print_hits "Changes not in the last Android build (web bundle + Android native)" "$ANDROID_COUNT" "$ANDROID_HITS"

if [ "$IOS_COUNT" -gt 0 ] || [ "$ANDROID_COUNT" -gt 0 ] || [ -z "$LAST_IOS_SHA" ] || [ -z "$LAST_ANDROID_SHA" ]; then
  echo "NOTE: mobile targets embed the built Vue bundle, so a web-only change still"
  echo "      needs a signed app build to reach store/TestFlight users. A signed"
  echo "      release is manual + review-gated (mobile-{ios,android}-release.yml);"
  echo "      the debug APK that auto-builds on push does NOT reach store users."
  echo
fi

# "yes" when files changed since the baseline, OR when there is no usable baseline:
# a never-shipped pipeline (a first release is warranted) or one whose recent ships
# are all missing from this clone (we cannot prove it is current).
target_flag() {
  local count="$1" state="$2"
  if [ "$count" -gt 0 ] || [ "$state" = "never" ] || [ "$state" = "unreachable" ]; then
    echo yes
  else
    echo no
  fi
}

echo "=== Deploy targets ==="
echo "VUE: $(target_flag "$VUE_COUNT" "$VUE_BASE")"
echo "WEB: $(target_flag "$WEB_COUNT" "$WEB_BASE")"
echo "MOBILE_IOS: $(target_flag "$IOS_COUNT" "$IOS_BASE")"
echo "MOBILE_ANDROID: $(target_flag "$ANDROID_COUNT" "$ANDROID_BASE")"
