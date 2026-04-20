---
name: deploy-prod-auto-skip-ci
description: Auto-approved commit, push, and deploy to production — skips CI gate for fast deploys
disable-model-invocation: true
---

# Deploy to Production (Skip CI)

This skill commits all pending changes, pushes to `main`, and deploys to production immediately — skipping the CI/Security gate. Use this for small, verified changes (config tweaks, copy updates, hotfixes) that have already been tested locally.

**All actions are pre-approved:** commit, push, and deploy will proceed automatically. The only reason to stop is an unrecoverable failure after 3 fix attempts.

---

## Step 1: Commit & Push

1. Run `git status` and `git diff` to review all pending changes.
2. Draft a commit message based on the changes (follow the repo's commit style).
3. Stage relevant files (never stage `.env`, credentials, or secrets).
4. Commit immediately with the drafted message — no need to confirm with the user.
5. Push to `main`. The pre-push hook (`npm run test:run`) will run automatically.
6. If pre-push tests fail:
   - Analyze the failure output.
   - Fix the root cause (do not skip hooks with `--no-verify`).
   - Re-commit the fix and push again.
   - Repeat until push succeeds.

## Step 2: Classify what needs deploying

Two deploy workflows exist:

- `deploy.yml` — Vue PWA at `app.beanies.family`
- `deploy-web.yml` — Astro marketing site at `beanies.family`

Look at each workflow independently: diff HEAD against the SHA that workflow **last shipped successfully**. This catches the case where prior commits touched one side but that workflow wasn't triggered — e.g., you pushed a commit that edits `packages/**` but only ran one of the two deploys. The next skill invocation now notices the gap and catches up.

```bash
# Last SHA successfully deployed by each workflow (empty string if never shipped)
LAST_VUE_SHA=$(gh run list --workflow=deploy.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_WEB_SHA=$(gh run list --workflow=deploy-web.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')

# Files changed since each workflow's last success (fall back to latest commit
# if a workflow has never shipped or the SHA is no longer reachable)
VUE_CHANGES=$( { [ -n "$LAST_VUE_SHA" ] && git diff --name-only "$LAST_VUE_SHA" HEAD 2>/dev/null; } || git show HEAD --name-only --pretty=format: )
WEB_CHANGES=$( { [ -n "$LAST_WEB_SHA" ] && git diff --name-only "$LAST_WEB_SHA" HEAD 2>/dev/null; } || git show HEAD --name-only --pretty=format: )

NEEDS_WEB=$(echo "$WEB_CHANGES" | grep -E '^(web/|packages/|content/blog/|src/content/help/)' || true)
NEEDS_VUE=$(echo "$VUE_CHANGES" | grep -Ev '^(web/|content/blog/|src/content/help/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)' || true)
```

Path rules (applied to each workflow's own change set):

- `web/**` or `content/blog/**` → Astro deploy
- `src/content/help/**` → Astro deploy **only** (per the 2026-04-16 consolidation, help articles are rendered exclusively by the Astro site; the Vue PWA's in-app help links open `beanies.family/help` in a new tab and never import the content modules)
- `packages/**` → BOTH (shared brand tokens are consumed by both apps)
- `src/**`, `public/**`, build configs, root files → Vue deploy (except `src/content/help/**` — see above)
- Only `.claude/**`, `docs/**`, `tasks/**`, `scripts/**`, `infrastructure/**`, or root READMEs touched → skip that workflow

If both `NEEDS_VUE` and `NEEDS_WEB` are empty, report "no runtime changes since last deploy — nothing to ship" and stop.

## Step 3: Deploy (Skip CI Gate)

Fire the matching workflows in parallel. The `skip_gate` flag only applies to `deploy.yml` — `deploy-web.yml` has no CI gate by design.

```bash
# Astro deploy (if needed) — workflow takes no inputs
if [ -n "$NEEDS_WEB" ]; then
  gh workflow run deploy-web.yml --ref main
fi

# Vue deploy (if needed, skipping CI gate)
if [ -n "$NEEDS_VUE" ]; then
  gh workflow run deploy.yml --ref main -f skip_gate=true
fi
```

For each workflow triggered, wait ~10s then watch:

```bash
gh run list --workflow=<workflow-name> --limit=1
gh run watch <run-id> --exit-status
```

If any deploy fails, fetch logs and report to the user. Do not retry automatically.

On success, report: deployed commit SHA, which workflows ran, deploy durations, and the production URL(s) — `https://app.beanies.family` for Vue, `https://beanies.family` for Astro.

**Note:** The CI/Security workflows still run in the background (triggered by the push). They are not waited on, but if they fail, investigate on the next deploy cycle.

---

## GitHub Account

This repo requires the **`gparker97`** GitHub account.

Before pushing or triggering workflows, verify the active account:
```
gh auth status
```

If a different account is authorized, switch first:
```
gh auth switch --user gparker97
```

If `gparker97` is not logged in at all, prompt the user to authenticate:
```
gh auth login
```

---

## Rules

- **Never use `--no-verify` or `--force`** on any git command.
- **Never amend published commits** — always create new fix commits.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures).
- The deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
- The `skip_gate` flag only bypasses the CI/Security wait — the build and S3 deploy still run normally.
