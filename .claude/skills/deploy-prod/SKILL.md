---
name: deploy-prod
description: Commit, push, monitor CI, and deploy to production
disable-model-invocation: true
---

# Deploy to Production

This skill commits all pending changes, pushes to `main`, monitors CI pipelines, fixes any failures, and deploys to production once everything is green.

**CRITICAL:** This is a destructive, externally-visible action. Confirm each major step with the user before proceeding.

---

## Step 1: Commit & Push

1. Run `git status` and `git diff` to review all pending changes.
2. Present a summary of changes to the user and draft a commit message.
3. Stage relevant files (never stage `.env`, credentials, or secrets).
4. Commit with the drafted message (get user approval on the message first).
5. Push to `main`. The pre-push hook (`npm run test:run`) will run automatically.
6. If pre-push tests fail:
   - Analyze the failure output.
   - Fix the root cause (do not skip hooks with `--no-verify`).
   - Re-commit the fix and push again.
   - Repeat until push succeeds.

## Step 2: Classify what needs deploying

Two deploy workflows exist:

- `deploy.yml` — Vue PWA at `app.beanies.family` (gated on CI + security)
- `deploy-web.yml` — Astro marketing site at `beanies.family` (no external CI gate)

Determine which are needed from the files pushed:

```bash
CHANGED=$(git show HEAD --name-only --pretty=format: | sort -u)
NEEDS_WEB=$(echo "$CHANGED" | grep -E '^(web/|packages/|content/blog/)' || true)
NEEDS_VUE=$(echo "$CHANGED" | grep -Ev '^(web/|content/blog/|\.claude/|\.github/|docs/|tasks/|scripts/|infrastructure/|README|CHANGELOG|LICENSE|SECURITY|TRADEMARK|POSTMORTEM)' || true)
```

Rules:

- `web/**` or `content/blog/**` → Astro deploy (web only)
- `packages/**` → BOTH (shared brand tokens consumed by both apps)
- `src/**`, `public/**`, build configs, root files → Vue deploy
- Only `.claude/**`, `docs/**`, `tasks/**`, `scripts/**`, `infrastructure/**`, or root READMEs touched → skip all deploys

Report the classification to the user ("Vue needed: yes/no, Astro needed: yes/no") and pause for acknowledgement before proceeding. If both are empty, stop with "no runtime changes — no deploy needed".

## Step 3: Deploy the Astro site (if NEEDS_WEB)

Astro has its own build inside the deploy workflow — no external CI gate is required. Confirm with the user, then:

```bash
gh workflow run deploy-web.yml --ref main -f target=production
```

Wait ~10s and watch:

```bash
gh run list --workflow=deploy-web.yml --limit=1
gh run watch <run-id>
```

If it fails, report logs to the user. The Astro deploy doesn't block the Vue deploy path below.

## Step 4: Monitor CI (only if NEEDS_VUE; skip otherwise)

After a successful push, two CI workflows run automatically on `main`:

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
   - Fetch failed job logs: `gh run view <run-id> --log-failed`
   - Fix the root cause, commit, push, restart Step 4.
   - Maximum 3 fix attempts. If still failing, stop and report.
4. If both pass, proceed to Step 5.

## Step 5: Deploy the Vue app (only if NEEDS_VUE)

Once CI and Security show green:

1. Confirm with the user: "CI and Security are green. Ready to deploy the Vue app to production?"
2. Only after explicit user approval, trigger the deploy:
   ```
   gh workflow run deploy.yml
   gh run list --workflow=deploy.yml --limit=1
   gh run watch <run-id>
   ```
3. The deploy workflow has its own gate that re-verifies CI/Security passed for the commit.
4. If deploy fails, fetch logs and report. Do not retry automatically.

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
- **Never trigger `deploy.yml` without explicit user confirmation** that CI is green.
- **Never amend published commits** — always create new fix commits.
- **Stop and ask the user** if anything unexpected happens (merge conflicts, unknown failures, flaky tests).
- The deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
- For a fully autonomous deploy without confirmation prompts, use `/deploy-prod-auto` instead.
