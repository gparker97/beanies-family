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
git commit -m "feat(area): subject line" -m "First paragraph of the body explaining why." -m "Second paragraph if needed." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
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
MOBILE_IOS: yes|no
MOBILE_ANDROID: yes|no
```

Record all four flags. The classifier treats each surface as an **independent distributable** and diffs HEAD against the SHA that surface last shipped from:

| Flag | Distributable | Shipped by |
|---|---|---|
| `VUE` | the Vue PWA (`app.beanies.family`) | `deploy.yml` (Step 5) |
| `WEB` | the Astro marketing site (apex) | `deploy-web.yml` (Step 5) |
| `MOBILE_IOS` | the iOS app (TestFlight / App Store) | `mobile-ios-release.yml` (Step 5b) |
| `MOBILE_ANDROID` | the Android app (Google Play) | `mobile-android-release.yml` (Step 5b) |

**Why a web-only change can flip a MOBILE flag:** the native apps EMBED the built Vue bundle (`dist/`, no over-the-air layer), so a `src/**` / `index.html` change reaches store/TestFlight users only through a new signed build. The classifier flags a platform when the embedded bundle OR its native shell changed since that platform's last release, using the **signed-release** lane as the baseline (NOT the debug-APK lane, which auto-runs every push). It also prints `N commit(s) behind` per platform — carry that into the Step 5b question.

Branch on the flags:

- **All four `no`** — report "no runtime changes since last deploy — nothing to ship" and stop.
- **`VUE: yes` or `WEB: yes`** — deploy those web targets (Step 5).
- **`MOBILE_IOS: yes` or `MOBILE_ANDROID: yes`** — release the flagged app(s) in **Step 5b** (the deliberate pause — greg chooses the destination per platform per `scripts/deploy/mobile-release-guide.md`). The free unsigned debug APK still auto-builds on every push (`mobile-android-build.yml`) independent of this.
- **Web flags `no` but a MOBILE flag `yes`** — skip Step 5's web/Vue dispatches (misleading no-ops), but **still run Step 4b (version bump) and Step 5b (mobile release)**.

## Step 4b: Author the release note + bump the product version (if `VUE: yes` or either `MOBILE_*: yes`)

Every Vue-app deploy ships a brief, user-facing release note — it becomes the
in-app `whats-new` notification (the bell) when clients update — **and** bumps
the in-app product version (`APP_VERSION`). A mobile release ALSO needs the
`APP_VERSION` bump (the Android `versionName` and iOS marketing version track it):
when `VUE: yes`, run the full flow below; when `MOBILE_IOS: yes` or `MOBILE_ANDROID: yes`
but `VUE: no` (web already deployed, an app behind), still bump `APP_VERSION` (and
author a release note only if the change is user-facing). **Follow
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
git commit -m "docs(release): note <version> (app v<APP_VERSION>) for prod deploy" -m "<the en summary>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
```
git push
```
The pre-push hook runs `npm run test:run`; on failure, fix the root cause (never
`--no-verify`) and re-push. Since the CI gate is skipped, Step 5 then deploys
this commit directly. Skip this entire step only if `VUE: no` **and** `MOBILE_IOS: no`
**and** `MOBILE_ANDROID: no` (web-current-but-app-behind still needs the version bump so
the Step 5b build carries it).

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

## Step 5b: Release the mobile app(s) (only for a flagged platform)

Run this for **each** platform the classifier flagged — iOS if `MOBILE_IOS: yes`,
Android if `MOBILE_ANDROID: yes`, both if both. They are independent releases. This is
the **second deliberate pause**: native releases go to Google/Apple review and burn a
version, so the destination is a per-release decision, never assumed.

**First, read `scripts/deploy/mobile-release-guide.md`** (the decision logic — options,
defaults, post-release rules). Then, for each flagged platform, **present how far behind
it is** (the classifier's `N commit(s) behind` line + what would ship) and **ask greg**:

- **iOS (`MOBILE_IOS: yes`)** — the workflow always uploads to **TestFlight** (no track
  input). Ask **release to TestFlight now, or skip?** External TestFlight + App Store
  submission (set the ASC record version to match `APP_VERSION`, attach, submit) are
  greg's manual console steps — the workflow does neither.
- **Android (`MOBILE_ANDROID: yes`)** — ask the **track**: `internal` (default;
  no review, test devices) · `alpha` (closed testing, review) · `beta` · `production`, or
  **skip**. Map "closed testing" → `alpha`. Keep `upload_to_play=true`.

Skipping a platform is a valid answer. If greg skips one, do not dispatch it.

**Dispatch Android** (with greg's chosen `<track>`), only if greg chose to release it:
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

**Dispatch iOS** (TestFlight), only if greg chose to release it:
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
not auto-retry a store upload (a partial upload can consume a version code). A successful
Android upload to a review track (`alpha`/`beta`/`production`) is **auto-submitted for
Google review**; `internal` is not. On-device verification happens on the build just
shipped; promoting internal → a review track (Play) or TestFlight → App Store (Apple) is
greg's manual console step.

## Step 6: Report

Summarise:
- Deployed commit SHA
- Which workflows ran (incl. any mobile Android/iOS release + its track)
- Deploy durations (from `gh run view --json startedAt,updatedAt`)
- The release note that shipped (if authored) — the `en` line + version
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)
- **Mobile (per flagged platform)** — iOS: released to TestFlight or skipped (+ the ASC
  submission step if App-Store-bound); Android: which track (and whether it auto-submitted
  for review) or skipped. Include greg's on-device-verify + promote-in-console steps.

**Note:** The CI and Security workflows still run in the background (triggered by the push). They are not awaited here, but if they fail, investigate on the next deploy cycle.

---

## Rules

- **Never use `--no-verify` or `--force`** on any git command.
- **Never amend published commits** — always create new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash commands run through the tool — they trigger permission prompts. If you need compound logic, add a script under `scripts/deploy/` and invoke it.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures) — **plus the two deliberate pauses**: Step 4b (approve the release-note wording + `APP_VERSION` bump) and Step 5b (per flagged platform, choose the destination — iOS TestFlight-or-skip, Android track-or-skip).
- **Release note + version bump on every Vue deploy, version bump on every mobile release.** When `VUE: yes`, author + ship a release note AND bump `APP_VERSION` (Step 4b). When `MOBILE_IOS: yes` or `MOBILE_ANDROID: yes`, bump `APP_VERSION` too. The deploy emoji is always ✨.
- **This skill ships everything the change requires** — Vue, Astro, AND the signed mobile app(s) — based on the four flags. The native apps embed the built Vue bundle, so a web change that hasn't reached a platform's last release flips its `MOBILE_*` flag; that platform's release runs in Step 5b (offered, never silently left for a follow-up), and skipping is greg's call.
- **iOS and Android are independent releases.** Ask + dispatch each on its own flag; never bundle them into one question.
- **Mobile releases are review-gated + irreversible-ish.** Never auto-retry a failed store upload, and never pick the destination yourself (always the Step 5b pause).
- The Vue deploy workflow name is exactly `deploy.yml` (display name: "Deploy beanies PROD").
- The Astro deploy workflow name is exactly `deploy-web.yml`.
- The `skip_gate` flag only bypasses the CI/Security wait — the build and S3 deploy still run normally.
