---
name: deploy-prod-auto
description: Auto-approved commit, push, CI monitor, and deploy to production
disable-model-invocation: true
---

# Deploy to Production (Auto-Approved)

Commits all pending changes, pushes to `main`, monitors CI pipelines, fixes any failures, and deploys to production — all without pausing for user confirmation.

**All actions are pre-approved:** commit, push, and deploy will proceed automatically. The only reason to stop is an unrecoverable failure after 3 fix attempts.

---

## Design principle: minimise permission prompts

Each Bash invocation below is a **single, simple command** — no inline `$(...)` subshells, no `&&` / `||` / `;` chains, no `$?` exit-code inspection, no heredoc commit messages. Complex classification work lives in `scripts/deploy/classify-changes.sh`. Commit bodies use multiple `-m` flags rather than heredocs.

If a step genuinely needs a chained command, stop and add a dedicated script under `scripts/deploy/` instead of writing the chain inline. Skills should invoke scripts, not orchestrate shells.

---

## Step 1: Verify GitHub account

Run:
```
gh auth status
```

The active account must be **`gparker97`**. If a different account is active, run `gh auth switch --user gparker97`. If `gparker97` isn't logged in at all, prompt the user to run `gh auth login`.

## Step 2: Review & commit pending changes

Check the working tree:
```
git status --short
```
```
git diff
```

Draft a commit message. Follow the repo's conventional-commit style (e.g. `feat(area): summary`, `fix(...)`, `chore(...)`). **Never stage** `.env`, credentials, or secrets. Per `CLAUDE.md` guidance, stage files by explicit path — avoid `git add -A` / `git add .`.

Stage files:
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
MOBILE: yes|no
```

Record `VUE`, `WEB`, and `MOBILE` flags.

**`MOBILE` is the native Capacitor wrapper** (`android/**`, `ios/**`, `capacitor.config.*`). These files are NOT in the deployed web app or the Astro site, so **neither web deploy ships them** — a native-only change reaches users only through a mobile app build + store release. This skill deploys the **web targets only**; it never builds or releases the mobile app. So:

- **If `MOBILE: yes`** — note it in your report and tell greg how it actually ships: the **free unsigned debug APK auto-builds on every push** to `main` (`mobile-android-build.yml`, published to the `spike-android-latest` rolling prerelease for on-device testing); a **signed store release is manual** (`mobile-android-release.yml` / `mobile-ios-release.yml`, currently DUNS-gated until ~early July). Do **not** dispatch those workflows from this skill unless greg explicitly asks. The push you already made (Step 3) triggers the debug-APK build automatically.
- **If `VUE: no` and `WEB: no` and `MOBILE: no`** — report "no runtime changes since last deploy — nothing to ship" and stop.
- **If `VUE: no` and `WEB: no` but `MOBILE: yes`** — there is nothing for this skill to deploy (it's native-only). Report that the change ships via the mobile lane (per the note above), confirm the auto-triggered APK build, and stop — do NOT run `deploy.yml` or `deploy-web.yml` (they would be no-ops that mislead).

## Step 4b: Author the release note + bump the product version (only if `VUE: yes`)

Every Vue-app deploy ships a brief, user-facing release note — it becomes the
in-app `whats-new` notification (the bell) when clients update — **and** bumps
the in-app product version (`APP_VERSION`). **Follow
`scripts/deploy/release-note-guide.md` in full**: judge significance, draft the
message in greg's voice (no em-dashes; en + lowercase beanie), compute the
`YYYY.MM.DD[.N]` note version, propose the next `APP_VERSION` (§3b — patch by
default, `R<n>` for a same-release hotfix), and **propose all of it to greg for
approval**.

> **The one allowed pause.** This skill is otherwise no-pause, but greg has
> explicitly asked to approve the wording before it ships. Present the drafted
> note (✨, version, month, en + beanie lines, spotlight?, one-line rationale)
> **and the proposed `APP_VERSION` bump** (current → next, with the
> patch-vs-revision reason) and wait for approval / edits before continuing.

On approval, prepend the entry to `src/content/release-notes/deploys.ts` AND edit
`src/constants/appVersion.ts` to the approved `APP_VERSION` (Edit tool for both),
then commit them together and push so both ride this deploy:
```
git add src/content/release-notes/deploys.ts src/constants/appVersion.ts
```
```
git commit -m "docs(release): note <version> (app v<APP_VERSION>) for prod deploy" -m "<the en summary>" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
```
git push
```
This re-triggers CI; Step 6 below watches the latest run (this commit), and the
Step 7 deploy gate re-verifies CI for HEAD. Skip this entire step if `VUE: no`.

## Step 5: Deploy the Astro site (fires immediately)

Astro has no external CI gate — trigger in parallel with the Vue flow below.

**Only if `WEB: yes`:**
```
gh workflow run deploy-web.yml --ref main
```

`deploy-web.yml` accepts no `workflow_dispatch` inputs — passing `-f target=production` (or any other `-f` flag) fails with HTTP 422 "Unexpected inputs provided". If the workflow ever grows inputs, update both this command and the workflow's `on.workflow_dispatch.inputs` block together.

Wait, then list + watch:
```
sleep 10
```
```
gh run list --workflow=deploy-web.yml --limit=1
```
```
gh run watch <web-run-id> --exit-status
```

`--exit-status` makes the process exit non-zero on failure, which the tool reports — no need to print `$?` yourself. If it fails, fetch logs (`gh run view <id> --log-failed`) and move on; it doesn't block the Vue deploy.

## Step 6: Monitor CI (only if `VUE: yes`)

Two workflows run automatically on every push to `main`:

| Workflow | File | What it checks |
|---|---|---|
| **Main Branch CI** | `main-ci.yml` | Type-check, lint, format, unit tests, build, E2E (Chromium + Firefox) |
| **Security Scanning** | `security.yml` | npm audit, SAST, secrets detection, CodeQL |

Wait ~30 seconds, then locate the runs:
```
sleep 30
```
```
gh run list --workflow=main-ci.yml --branch=main --limit=1
```
```
gh run list --workflow=security.yml --branch=main --limit=1
```

Watch each in turn (they run in parallel, so watching sequentially is fine — you start watching after they've already begun):
```
gh run watch <ci-run-id> --exit-status
```
```
gh run watch <security-run-id> --exit-status
```

If a workflow fails:
1. Fetch logs: `gh run view <run-id> --log-failed`
2. Fix the root cause.
3. Commit the fix (new commit, not amend), push.
4. Restart Step 6 from the top.
5. Max 3 rounds; after that, stop and report.

## Step 7: Deploy the Vue app (only if `VUE: yes`)

Once CI + Security are green:
```
gh workflow run deploy.yml --ref main
```
```
sleep 10
```
```
gh run list --workflow=deploy.yml --limit=1
```
```
gh run watch <deploy-run-id> --exit-status
```

The deploy workflow has its own gate that re-verifies CI/Security passed for the commit. If it fails, report logs — do not auto-retry.

## Step 8: Report

Summarise:
- Deployed commit SHA
- Which workflows ran (Main CI, Security, Vue Deploy, Astro Deploy)
- Deploy durations (from `gh run view --json startedAt,updatedAt`)
- The release note that shipped (if `VUE: yes`) — the `en` line + version
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)

---

## Rules

- **Never use `--no-verify` or `--force`** on any git command.
- **Never skip or silence CI failures** — always fix the root cause.
- **Never amend published commits** — always create new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash commands run through the tool — they trigger permission prompts. If you need compound logic, add a script under `scripts/deploy/` and invoke it.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures) — **plus the one deliberate pause in Step 4b** to get greg's approval of the release-note wording + the `APP_VERSION` bump before they ship.
- **Release note + version bump on every Vue deploy.** When `VUE: yes`, author + ship a release note AND bump `APP_VERSION` per `scripts/deploy/release-note-guide.md` (Step 4b). The deploy emoji is always ✨.
- The Vue deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
- The Astro deploy workflow name is exactly `deploy-web.yml`.
