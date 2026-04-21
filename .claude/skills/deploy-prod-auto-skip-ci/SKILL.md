---
name: deploy-prod-auto-skip-ci
description: Auto-approved commit, push, and deploy to production — skips CI gate for fast deploys
disable-model-invocation: true
---

# Deploy to Production (Skip CI)

Commits all pending changes, pushes to `main`, and deploys to production immediately — skipping the CI/Security gate. Use this for small, verified changes (config tweaks, copy updates, hotfixes) that have already been tested locally.

**All actions are pre-approved:** commit, push, and deploy will proceed automatically. The only reason to stop is an unrecoverable failure after 3 fix attempts.

---

## Design principle: minimise permission prompts

Each Bash invocation below is a **single, simple command** — no inline `$(...)` subshells, no `&&` / `||` / `;` chains, no `$?` exit-code inspection, no heredoc commit messages. Complex classification work lives in `scripts/deploy/classify-changes.sh`. Commit bodies use multiple `-m` flags rather than heredocs.

If a step genuinely needs a chained command, stop and add a dedicated script under `scripts/deploy/` instead of writing the chain inline. Skills should invoke scripts, not orchestrate shells.

---

## Step 1: Verify GitHub account

```
gh auth status
```

The active account must be **`gparker97`**. If a different account is active, run `gh auth switch --user gparker97`. If `gparker97` isn't logged in at all, prompt the user to run `gh auth login`.

## Step 2: Review & commit pending changes

```
git status --short
```
```
git diff
```

Draft a commit message. Follow the repo's conventional-commit style. **Never stage** `.env`, credentials, or secrets. Per `CLAUDE.md` guidance, stage files by explicit path — avoid `git add -A` / `git add .`.

```
git add <path> <path>
```

Commit using separate `-m` flags for subject + body paragraphs — NEVER a heredoc or `$(cat <<EOF ... EOF)`:
```
git commit -m "feat(area): subject line" -m "First paragraph of the body explaining why." -m "Second paragraph if needed." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Step 3: Push

```
git push
```

The pre-push hook runs `npm run test:run` automatically. If it fails:
1. Read the failure output.
2. Fix the root cause — do NOT use `--no-verify`.
3. Stage the fix, create a new commit (never amend), push again.
4. Repeat up to 3 attempts. After 3 failures, stop and report.

## Step 4: Classify what needs deploying

Single command — all classification logic lives in the script:
```
bash scripts/deploy/classify-changes.sh
```

The final block of the output is machine-readable:
```
=== Deploy targets ===
VUE: yes|no
WEB: yes|no
```

Record `VUE` and `WEB` flags. If both are `no`, report "no runtime changes since last deploy — nothing to ship" and stop.

## Step 5: Deploy (skip-CI gate)

Fire each matching workflow, wait, list, watch. `skip_gate=true` only applies to `deploy.yml` — `deploy-web.yml` has no external CI gate by design.

**If `WEB: yes`:**
```
gh workflow run deploy-web.yml --ref main
```
```
sleep 10
```
```
gh run list --workflow=deploy-web.yml --limit=1
```
```
gh run watch <web-run-id> --exit-status
```

**If `VUE: yes`:**
```
gh workflow run deploy.yml --ref main -f skip_gate=true
```
```
sleep 10
```
```
gh run list --workflow=deploy.yml --limit=1
```
```
gh run watch <vue-run-id> --exit-status
```

`--exit-status` makes the process exit non-zero on failure, which the tool reports — no need to print `$?` yourself.

If a deploy fails, fetch logs (`gh run view <id> --log-failed`) and report to the user. Do not auto-retry.

## Step 6: Report

Summarise:
- Deployed commit SHA
- Which workflows ran
- Deploy durations (from `gh run view --json startedAt,updatedAt`)
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)

**Note:** The CI and Security workflows still run in the background (triggered by the push). They are not awaited here, but if they fail, investigate on the next deploy cycle.

---

## Rules

- **Never use `--no-verify` or `--force`** on any git command.
- **Never amend published commits** — always create new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash commands run through the tool — they trigger permission prompts. If you need compound logic, add a script under `scripts/deploy/` and invoke it.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures).
- The Vue deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
- The Astro deploy workflow name is exactly `deploy-web.yml`.
- The `skip_gate` flag only bypasses the CI/Security wait — the build and S3 deploy still run normally.
