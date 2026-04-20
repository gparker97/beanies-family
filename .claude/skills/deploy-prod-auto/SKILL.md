---
name: deploy-prod-auto
description: Auto-approved commit, push, CI monitor, and deploy to production
disable-model-invocation: true
---

# Deploy to Production (Auto-Approved)

This skill commits all pending changes, pushes to `main`, monitors CI pipelines, fixes any failures, and deploys to production — all without pausing for user confirmation.

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

- `deploy.yml` — Vue PWA at `app.beanies.family` (gated on CI + security)
- `deploy-web.yml` — Astro marketing site at `beanies.family` (no CI gate)

Look at each workflow independently: diff HEAD against the SHA that workflow **last shipped successfully**. This catches the case where prior commits touched one side but that workflow wasn't triggered — the next skill invocation notices the gap and catches up.

```bash
LAST_VUE_SHA=$(gh run list --workflow=deploy.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')
LAST_WEB_SHA=$(gh run list --workflow=deploy-web.yml --status=success --limit=1 --json headSha --jq '.[0].headSha // ""')

VUE_CHANGES=$( { [ -n "$LAST_VUE_SHA" ] && git diff --name-only "$LAST_VUE_SHA" HEAD 2>/dev/null; } || git show HEAD --name-only --pretty=format: )
WEB_CHANGES=$( { [ -n "$LAST_WEB_SHA" ] && git diff --name-only "$LAST_WEB_SHA" HEAD 2>/dev/null; } || git show HEAD --name-only --pretty=format: )

NEEDS_WEB=$(echo "$WEB_CHANGES" | grep -E '^(web/|packages/|content/blog/|src/content/help/)' || true)
NEEDS_VUE=$(echo "$VUE_CHANGES" | grep -Ev '^(web/|content/blog/|src/content/help/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)' || true)
```

Path rules (applied to each workflow's own change set):

- `web/**` or `content/blog/**` → Astro deploy
- `src/content/help/**` → Astro deploy **only** (per the 2026-04-16 consolidation, help articles are rendered exclusively by the Astro site; the Vue PWA's in-app help links open `beanies.family/help` in a new tab and never import the content modules)
- `packages/**` → BOTH (shared brand tokens consumed by both apps)
- `src/**`, `public/**`, build configs, root files → Vue deploy (except `src/content/help/**` — see above)
- Only `.claude/**`, `docs/**`, `tasks/**`, `scripts/**`, `infrastructure/**`, or root READMEs touched → skip that workflow

If both empty, report "no runtime changes since last deploy — nothing to ship" and stop.

## Step 3: Deploy the Astro site (if NEEDS_WEB, fires immediately)

Astro has its own build-and-test inside the deploy workflow — no external CI gate. Trigger it now in parallel with the Vue CI wait below:

```bash
if [ -n "$NEEDS_WEB" ]; then
  gh workflow run deploy-web.yml --ref main -f target=production
fi
```

Wait ~10s, then watch:

```bash
gh run list --workflow=deploy-web.yml --limit=1
gh run watch <run-id>
```

If it fails, report logs and move on — it doesn't block the Vue deploy.

## Step 4: Monitor CI (only if NEEDS_VUE; skip otherwise)

After push, two CI workflows run automatically on `main`:

| Workflow | File | What it checks |
|----------|------|----------------|
| **Main Branch CI** | `main-ci.yml` | Type-check, lint, format, unit tests, build, E2E (Chromium + Firefox) |
| **Security Scanning** | `security.yml` | npm audit, SAST, secrets detection, CodeQL |

Monitor both:

1. Wait ~30 seconds after push, then check:
   ```
   gh run list --workflow=main-ci.yml --branch=main --limit=1
   gh run list --workflow=security.yml --branch=main --limit=1
   ```
2. Poll every 30 seconds until both complete:
   ```
   gh run watch <run-id>
   ```
3. If a workflow **fails**:
   - Fetch the failed job logs: `gh run view <run-id> --log-failed`
   - Analyze the error and fix the root cause.
   - Commit the fix, push, and restart monitoring from the beginning of Step 4.
   - Maximum 3 fix attempts. If still failing after 3 rounds, stop and report.
4. If both pass, proceed immediately to Step 5.

## Step 5: Deploy the Vue app (only if NEEDS_VUE)

Once CI and Security are green, deploy the Vue PWA — no user confirmation needed:

```bash
gh workflow run deploy.yml
gh run list --workflow=deploy.yml --limit=1
gh run watch <run-id>
```

The deploy workflow has its own gate that re-verifies CI/Security passed for the commit. If it fails, report logs. Do not retry automatically.

## Step 6: Report

Summarize: deployed commit SHA, which workflows ran, deploy durations, production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro).

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
- **Never skip or silence CI failures** — always fix the root cause.
- **Never amend published commits** — always create new fix commits.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures).
- The deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
