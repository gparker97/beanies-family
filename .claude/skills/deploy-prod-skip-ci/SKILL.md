---
name: deploy-prod-skip-ci
description: Auto-approved commit, push, and deploy to production — skips the CI/Security gate for fast, locally-verified deploys. Classifies what changed and deploys the Vue app and/or the Astro marketing site as needed (same target-classification as deploy-prod-auto, minus the remote-CI wait).
disable-model-invocation: true
---

# Deploy to Production (Skip CI)

Commits all pending changes, pushes to `main`, and deploys to production immediately — skipping the CI/Security gate. Use this for small, verified changes (config tweaks, copy updates, hotfixes) that have already been tested locally. Like `deploy-prod-auto`, this deploys **whichever of the Vue app (`deploy.yml`) and the Astro marketing site (`deploy-web.yml`) the committed changes actually affect** (`scripts/deploy/classify-changes.sh` decides) — the only difference from `deploy-prod-auto` is that this one passes `skip_gate=true` to `deploy.yml` to bypass the CI/Security wait.

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
MOBILE: yes|no
```

Record `VUE`, `WEB`, and `MOBILE` flags.

**`MOBILE` is the native Capacitor wrapper + build inputs** (`android/**`, `ios/**`, `capacitor.config.*`, `patches/**`, `scripts/build-native-app-assets*`). These files are NOT in the deployed web app or the Astro site, so **neither web deploy ships them** — a native change reaches users only through a signed mobile app build + store release. This skill **does** release the mobile app when `MOBILE: yes` (Step 5b), so the one command ships everything required. So:

- **If `MOBILE: yes`** — a signed mobile release runs in **Step 5b** (after the web targets). It is a **deliberate pause**: greg picks the Android track per-deploy (internal vs closed testing), and iOS is attempted only when Apple enrolment is ready. The free unsigned debug APK still auto-builds on every push (`mobile-android-build.yml`) independent of this.
- **If `VUE: no` and `WEB: no` and `MOBILE: no`** — report "no runtime changes since last deploy — nothing to ship" and stop.
- **If `VUE: no` and `WEB: no` but `MOBILE: yes`** — there are no **web** targets to deploy, so skip Step 5's web/Vue dispatches, but **still run Step 4b (version bump) and Step 5b (mobile release)**. This is the native-only path — the whole point is that this skill now ships it.

## Step 4b: Author the release note + bump the product version (if `VUE: yes` or `MOBILE: yes`)

Every Vue-app deploy ships a brief, user-facing release note — it becomes the
in-app `whats-new` notification (the bell) when clients update — **and** bumps
the in-app product version (`APP_VERSION`). A mobile release ALSO needs the
`APP_VERSION` bump (the Android `versionName` and iOS marketing version track it):
when `VUE: yes`, run the full flow below; when `MOBILE: yes` but `VUE: no`
(native-only), still bump `APP_VERSION` (and author a release note only if the native
change is user-facing). **Follow
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
The pre-push hook runs `npm run test:run`; on failure, fix the root cause (never
`--no-verify`) and re-push. Since the CI gate is skipped, Step 5 then deploys
this commit directly. Skip this entire step only if `VUE: no` **and** `MOBILE: no`
(native-only still needs the version bump so Step 5b builds from a HEAD carrying it).

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

## Step 5b: Release the mobile app (only if `MOBILE: yes`)

A native change ships to users through a signed store release, not the web deploys.
This is the **second deliberate pause** (native releases go to Google/Apple review and
burn a version, so the target is a per-deploy decision, not a fixed policy).

**Ask greg (do not assume):**

1. **Android track** — `internal` (no review; installs on your test devices for the
   live-only on-device verification) **or** `closed` testing (`alpha` track — goes to
   Google review) — or `beta` / `production`, or **skip Android** this time. Present
   `internal` as the default for an unverified native change.
2. **iOS** — attempt the iOS TestFlight release **only if Apple enrolment + the App
   Store Connect secrets are ready**. If greg confirms ready → include it; otherwise
   report "iOS skipped — Apple enrolment pending" and do not dispatch (the workflow's
   preflight would just hard-fail on the missing secrets).

Map the chosen closed-testing answer to the `alpha` track (the workflow's `track`
choice list is `internal | alpha | beta | production`).

**Dispatch Android** (with greg's chosen `<track>`):
```
gh workflow run mobile-android-release.yml --ref main -f track=<track> -f upload_to_play=true
```
```
sleep 10
```
```
gh run list --workflow=mobile-android-release.yml --limit=1
```
```
gh run watch <android-run-id> --exit-status
```

**Dispatch iOS** (only if greg confirmed enrolment is ready):
```
gh workflow run mobile-ios-release.yml --ref main
```
```
sleep 10
```
```
gh run list --workflow=mobile-ios-release.yml --limit=1
```
```
gh run watch <ios-run-id> --exit-status
```

On a release failure, fetch logs (`gh run view <id> --log-failed`) and report — do
not auto-retry a store upload. A successful Android upload to a review track
(`alpha`/`beta`/`production`) is **auto-submitted for Google review**; `internal` is
not. On-device verification happens on this build; promoting internal → a review track
(or review → production) is greg's manual console step.

## Step 6: Report

Summarise:
- Deployed commit SHA
- Which workflows ran (incl. any mobile Android/iOS release + its track)
- Deploy durations (from `gh run view --json startedAt,updatedAt`)
- The release note that shipped (if authored) — the `en` line + version
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)
- **Mobile (if `MOBILE: yes`)** — the Android track (and whether it auto-submitted for
  review), whether iOS released or skipped, and greg's on-device-verify + promote steps

**Note:** The CI and Security workflows still run in the background (triggered by the push). They are not awaited here, but if they fail, investigate on the next deploy cycle.

---

## Rules

- **Never use `--no-verify` or `--force`** on any git command.
- **Never amend published commits** — always create new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash commands run through the tool — they trigger permission prompts. If you need compound logic, add a script under `scripts/deploy/` and invoke it.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures) — **plus the two deliberate pauses**: Step 4b (approve the release-note wording + `APP_VERSION` bump) and Step 5b (choose the Android release track, and confirm whether to include iOS).
- **Release note + version bump on every Vue deploy, version bump on every mobile release.** When `VUE: yes`, author + ship a release note AND bump `APP_VERSION` (Step 4b). When `MOBILE: yes`, bump `APP_VERSION` too. The deploy emoji is always ✨.
- **This skill ships everything the change requires** — Vue, Astro, AND the signed mobile app — based on the `VUE`/`WEB`/`MOBILE` flags. A native change is released via Step 5b (never silently left for a manual follow-up).
- **Mobile releases are review-gated + irreversible-ish.** Never auto-retry a failed store upload, never pick the track yourself (always the Step 5b pause), and never dispatch iOS when Apple enrolment/secrets aren't ready.
- The Vue deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
- The Astro deploy workflow name is exactly `deploy-web.yml`.
- The `skip_gate` flag only bypasses the CI/Security wait — the build and S3 deploy still run normally.
