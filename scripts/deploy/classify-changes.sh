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
#
# Exit is always 0. The caller branches on the flags.
#
# Path rules (must stay in sync with deploy skill docs):
#   Web-triggering:   web/**, packages/**, content/blog/**, src/content/help/**
#   Vue-triggering:   src/**, public/**, root build files — minus the paths
#                     below that are docs/infra/tooling only
#   Skipped-both:     .claude/**, .github/**, docs/**, tasks/**, scripts/**,
#                     infrastructure/**, README, CHANGELOG, LICENSE, SECURITY,
#                     TRADEMARK, POSTMORTEM
#
# Shared packages/** go to BOTH workflows (brand tokens consumed by each app).

set -euo pipefail

HEAD_SHA=$(git rev-parse --short HEAD)

LAST_VUE_SHA=$(gh run list --workflow=deploy.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_WEB_SHA=$(gh run list --workflow=deploy-web.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')

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

WEB_PATTERNS='^(web/|packages/|content/blog/|src/content/help/)'
VUE_EXCLUDE='^(web/|content/blog/|src/content/help/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)'

WEB_HITS=$(printf '%s\n' "$WEB_CHANGES" | grep -E "$WEB_PATTERNS" || true)
VUE_HITS=$(printf '%s\n' "$VUE_CHANGES" | grep -Ev "$VUE_EXCLUDE" || true)

count_lines() {
  # Counts non-empty lines; returns 0 for empty input.
  printf '%s' "$1" | grep -c . || true
}

VUE_COUNT=$(count_lines "$VUE_HITS")
WEB_COUNT=$(count_lines "$WEB_HITS")

echo "HEAD:              $HEAD_SHA"
echo "Last Vue deploy:   ${LAST_VUE_SHA:-(never shipped)}"
echo "Last Web deploy:   ${LAST_WEB_SHA:-(never shipped)}"
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

echo "=== Deploy targets ==="
if [ "$VUE_COUNT" -gt 0 ]; then echo "VUE: yes"; else echo "VUE: no"; fi
if [ "$WEB_COUNT" -gt 0 ]; then echo "WEB: yes"; else echo "WEB: no"; fi
