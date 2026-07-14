#!/usr/bin/env bash
# Classify which deploy workflows need to run, by diffing HEAD against the
# SHA each workflow last shipped successfully. Designed to be called from
# the deploy skills as a single pre-approved command, replacing the inline
# shell expansions that previously triggered permission prompts.
#
# Output: human-readable summary followed by a machine-readable block:
#
#     === Deploy targets ===
#     VUE: yes|no
#     WEB: yes|no
#     MOBILE: yes|no
#
# Exit is always 0. The caller branches on the flags.
#
# Path rules (must stay in sync with deploy skill docs):
#   Web-triggering:    web/**, packages/**, content/blog/**, src/content/help/**
#   Vue-triggering:    src/**, public/**, root build files — minus the paths
#                      below that are docs/infra/tooling/native-only
#   Mobile-triggering: android/**, ios/**, capacitor.config.*, patches/** (native
#                      plugin patch-package diffs, e.g. the @capgo iOS PRF patch),
#                      scripts/build-native-app-assets* (icon/splash generator) —
#                      native inputs NEITHER web workflow ships. Reaches users only
#                      via a native app build + store release (mobile-* workflows).
#   Skipped-all:       .claude/**, .github/**, docs/**, tasks/**, scripts/**,
#                      infrastructure/**, README, CHANGELOG, LICENSE, SECURITY,
#                      TRADEMARK, POSTMORTEM
#
# Shared packages/** go to BOTH web workflows (brand tokens consumed by each app).
#
# IMPORTANT — why MOBILE is its own category: android/** and ios/** are the
# native Capacitor wrappers. The deployed web app (deploy.yml) and the Astro
# site (deploy-web.yml) do NOT contain them, so a native-only change (e.g. an
# AndroidManifest <queries> entry, an Info.plist usage string) ships NOTHING via
# the prod web deploys. It reaches users through mobile-android-build.yml (free
# unsigned debug APK, auto-runs on push) + mobile-{android,ios}-release.yml
# (signed store release, manual). Before this category existed, such changes
# were mis-bucketed as VUE and triggered a no-op web redeploy.

set -euo pipefail

HEAD_SHA=$(git rev-parse --short HEAD)

LAST_VUE_SHA=$(gh run list --workflow=deploy.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_WEB_SHA=$(gh run list --workflow=deploy-web.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
# Native wrapper baseline: the free debug-APK lane auto-builds on every push to
# main, so its last success is the most recent SHA the native shell was rebuilt
# from. Used only to scope the MOBILE diff — the deploy skills don't dispatch it.
LAST_MOBILE_SHA=$(gh run list --workflow=mobile-android-build.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')

diff_since() {
  local sha="$1"
  if [ -n "$sha" ] && git rev-parse --quiet --verify "${sha}^{commit}" >/dev/null 2>&1; then
    git diff --name-only "$sha" HEAD
  else
    # No prior deploy on record, or SHA no longer reachable (history rewrite).
    # Fall back to the files in the tip commit so we don't silently skip.
    git show HEAD --name-only --pretty=format:
  fi
}

VUE_CHANGES=$(diff_since "$LAST_VUE_SHA" || true)
WEB_CHANGES=$(diff_since "$LAST_WEB_SHA" || true)
MOBILE_CHANGES=$(diff_since "$LAST_MOBILE_SHA" || true)

WEB_PATTERNS='^(web/|packages/|content/blog/|src/content/help/)'
NATIVE_PATTERNS='^(android/|ios/|capacitor\.config\.|patches/|scripts/build-native-app-assets)'
# Native paths are excluded from VUE so a native-only change doesn't trigger a
# no-op web redeploy — it's a MOBILE change, classified below.
VUE_EXCLUDE='^(web/|content/blog/|src/content/help/|android/|ios/|capacitor\.config\.|patches/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)'

WEB_HITS=$(printf '%s\n' "$WEB_CHANGES" | grep -E "$WEB_PATTERNS" || true)
VUE_HITS=$(printf '%s\n' "$VUE_CHANGES" | grep -Ev "$VUE_EXCLUDE" || true)
MOBILE_HITS=$(printf '%s\n' "$MOBILE_CHANGES" | grep -E "$NATIVE_PATTERNS" || true)

count_lines() {
  # Counts non-empty lines; returns 0 for empty input.
  printf '%s' "$1" | grep -c . || true
}

VUE_COUNT=$(count_lines "$VUE_HITS")
WEB_COUNT=$(count_lines "$WEB_HITS")
MOBILE_COUNT=$(count_lines "$MOBILE_HITS")

echo "HEAD:              $HEAD_SHA"
echo "Last Vue deploy:   ${LAST_VUE_SHA:-(never shipped)}"
echo "Last Web deploy:   ${LAST_WEB_SHA:-(never shipped)}"
echo "Last Mobile build: ${LAST_MOBILE_SHA:-(never built)}"
echo

echo "Vue files needing redeploy (${VUE_COUNT}):"
if [ "$VUE_COUNT" -gt 0 ]; then
  printf '%s\n' "$VUE_HITS" | head -10 | sed 's/^/  /'
  if [ "$VUE_COUNT" -gt 10 ]; then
    echo "  ...and $((VUE_COUNT - 10)) more"
  fi
else
  echo "  (none)"
fi
echo

echo "Web files needing redeploy (${WEB_COUNT}):"
if [ "$WEB_COUNT" -gt 0 ]; then
  printf '%s\n' "$WEB_HITS" | head -10 | sed 's/^/  /'
  if [ "$WEB_COUNT" -gt 10 ]; then
    echo "  ...and $((WEB_COUNT - 10)) more"
  fi
else
  echo "  (none)"
fi
echo

echo "Native (mobile) files changed since last build (${MOBILE_COUNT}):"
if [ "$MOBILE_COUNT" -gt 0 ]; then
  printf '%s\n' "$MOBILE_HITS" | head -10 | sed 's/^/  /'
  if [ "$MOBILE_COUNT" -gt 10 ]; then
    echo "  ...and $((MOBILE_COUNT - 10)) more"
  fi
  echo "  NOTE: native-only — NOT shipped by the prod web deploys. The debug"
  echo "        APK auto-builds on push (mobile-android-build.yml); a signed"
  echo "        store release is manual (mobile-{android,ios}-release.yml)."
else
  echo "  (none)"
fi
echo

echo "=== Deploy targets ==="
if [ "$VUE_COUNT" -gt 0 ]; then echo "VUE: yes"; else echo "VUE: no"; fi
if [ "$WEB_COUNT" -gt 0 ]; then echo "WEB: yes"; else echo "WEB: no"; fi
if [ "$MOBILE_COUNT" -gt 0 ]; then echo "MOBILE: yes"; else echo "MOBILE: no"; fi
