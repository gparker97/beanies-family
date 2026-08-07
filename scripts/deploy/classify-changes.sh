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
#       web/**, packages/**, content/blog/**, src/content/help/**
#   iOS native shell:     ios/**  + shared-native
#   Android native shell: android/**  + shared-native
#   Shared-native (→ both apps): capacitor.config.*, patches/** (patch-package
#       diffs applied on npm ci), scripts/build-native-app-assets* (icon/splash gen)
#   Ships nothing (excluded everywhere): .claude/**, .github/**, docs/**, tasks/**,
#       scripts/** (except build-native-app-assets*), infrastructure/**, README,
#       CHANGELOG, LICENSE, SECURITY, TRADEMARK, POSTMORTEM
#
# packages/** feeds BOTH web workflows (brand tokens each app consumes).

set -euo pipefail

HEAD_SHA=$(git rev-parse --short HEAD)

# Last SHA each distributable shipped from. `// ""` yields empty when a pipeline has
# never had a successful run (a never-released platform), handled as "yes" below.
LAST_VUE_SHA=$(gh run list --workflow=deploy.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_WEB_SHA=$(gh run list --workflow=deploy-web.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_IOS_SHA=$(gh run list --workflow=mobile-ios-release.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_ANDROID_SHA=$(gh run list --workflow=mobile-android-release.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')

diff_since() {
  local sha="$1"
  if [ -n "$sha" ] && git rev-parse --quiet --verify "${sha}^{commit}" >/dev/null 2>&1; then
    git diff --name-only "$sha" HEAD
  else
    # No prior ship on record, or SHA no longer reachable (history rewrite).
    # Fall back to the files in the tip commit so we don't silently skip.
    git show HEAD --name-only --pretty=format:
  fi
}

commits_behind() {
  local sha="$1"
  if [ -n "$sha" ] && git rev-parse --quiet --verify "${sha}^{commit}" >/dev/null 2>&1; then
    git rev-list --count "${sha}..HEAD"
  else
    echo "?"
  fi
}

VUE_CHANGES=$(diff_since "$LAST_VUE_SHA" || true)
WEB_CHANGES=$(diff_since "$LAST_WEB_SHA" || true)
IOS_CHANGES=$(diff_since "$LAST_IOS_SHA" || true)
ANDROID_CHANGES=$(diff_since "$LAST_ANDROID_SHA" || true)

WEB_PATTERNS='^(web/|packages/|content/blog/|src/content/help/)'
# The embedded web bundle = everything NOT excluded. Native-shell paths are excluded
# here (they are matched separately, per platform, below) so they are not double-counted.
BUNDLE_EXCLUDE='^(web/|content/blog/|src/content/help/|android/|ios/|capacitor\.config\.|patches/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)'
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

echo "HEAD:                $HEAD_SHA"
echo "Last Vue deploy:     ${LAST_VUE_SHA:-(never shipped)}  ($(commits_behind "$LAST_VUE_SHA") commit(s) behind)"
echo "Last Web deploy:     ${LAST_WEB_SHA:-(never shipped)}  ($(commits_behind "$LAST_WEB_SHA") commit(s) behind)"
echo "Last iOS release:    ${LAST_IOS_SHA:-(never released)}  ($(commits_behind "$LAST_IOS_SHA") commit(s) behind)"
echo "Last Android release:${LAST_ANDROID_SHA:-(never released)}  ($(commits_behind "$LAST_ANDROID_SHA") commit(s) behind)"
echo

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

# A never-released platform (empty marker) reports "yes": there is no build at all, so
# a first release is warranted regardless of the (fallback) diff.
echo "=== Deploy targets ==="
if [ "$VUE_COUNT" -gt 0 ]; then echo "VUE: yes"; else echo "VUE: no"; fi
if [ "$WEB_COUNT" -gt 0 ]; then echo "WEB: yes"; else echo "WEB: no"; fi
if [ -z "$LAST_IOS_SHA" ] || [ "$IOS_COUNT" -gt 0 ]; then echo "MOBILE_IOS: yes"; else echo "MOBILE_IOS: no"; fi
if [ -z "$LAST_ANDROID_SHA" ] || [ "$ANDROID_COUNT" -gt 0 ]; then echo "MOBILE_ANDROID: yes"; else echo "MOBILE_ANDROID: no"; fi
