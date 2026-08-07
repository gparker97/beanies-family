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

Record all four flags. The classifier treats each surface as an **independent distributable** and diffs HEAD against the SHA that surface last shipped from — so each flag answers "is this distributable behind HEAD?":

| Flag | Distributable | Shipped by |
|---|---|---|
| `VUE` | the Vue PWA (`app.beanies.family`) | `deploy.yml` (Steps 6–7) |
| `WEB` | the Astro marketing site (apex) | `deploy-web.yml` (Step 5) |
| `MOBILE_IOS` | the iOS app (TestFlight / App Store) | `mobile-ios-release.yml` (Step 7b) |
| `MOBILE_ANDROID` | the Android app (Google Play) | `mobile-android-release.yml` (Step 7b) |

**Why a web-only change can flip a MOBILE flag:** the native apps EMBED the built Vue bundle (`dist/`, no over-the-air layer), so a `src/**` / `index.html` change reaches store/TestFlight users only through a new signed build. The classifier therefore flags a platform when the embedded bundle OR its native shell changed since that platform's last release. The baseline is the **signed-release** lane — NOT the debug-APK lane (`mobile-android-build.yml`), which auto-runs every push and would make the flag read `no` right after a native change. The classifier also prints `N commit(s) behind` per platform — carry that into the Step 7b question.

Branch on the flags:

- **All four `no`** — report "no runtime changes since last deploy — nothing to ship" and stop.
- **`VUE: yes` or `WEB: yes`** — deploy those web targets (Steps 5–7).
- **`MOBILE_IOS: yes` or `MOBILE_ANDROID: yes`** — release the flagged app(s) in **Step 7b** (the deliberate pause — greg chooses the destination per platform per `scripts/deploy/mobile-release-guide.md`). The free unsigned debug APK still auto-builds on every push (`mobile-android-build.yml`) independent of this.
- **Web flags `no` but a MOBILE flag `yes`** (native/web-bundle behind, but web already current) — skip the web dispatches in Steps 5–7 (they would be misleading no-ops), but **still run Step 4b (version bump) and Step 7b (mobile release)**.

## Step 4b: Author the release note + bump the product version (if `VUE: yes` or either `MOBILE_*: yes`)

Every Vue-app deploy ships a brief, user-facing release note — it becomes the
in-app `whats-new` notification (the bell) when clients update — **and** bumps
the in-app product version (`APP_VERSION`). A mobile release ALSO needs the
`APP_VERSION` bump: the Android `versionName` and the iOS marketing version both
track `APP_VERSION`, so a build with a stale version is indistinguishable on-device.

- **`VUE: yes`** — full flow below (release note + `APP_VERSION` bump).
- **`MOBILE_IOS: yes` or `MOBILE_ANDROID: yes` but `VUE: no`** (the web bundle is
  already deployed to PWA, but a native app is behind) — still bump `APP_VERSION` so the
  Step 7b build is identifiable; author a release note too **if** the change is
  user-facing (judge per the guide — e.g. a visible fix like the safe-area / status-bar
  fix qualifies; a manifest/entitlement-only change does not). Same approval pause. **Follow
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
This re-triggers CI; Step 6 below watches the latest run (this commit), and the
Step 7 deploy gate re-verifies CI for HEAD. Skip this entire step only if `VUE: no`
**and** `MOBILE_IOS: no` **and** `MOBILE_ANDROID: no`. (Web-current-but-app-behind:
commit + push the version bump so the Step 7b build carries it.)

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

## Step 7b: Release the mobile app(s) (only for a flagged platform)

Run this for **each** platform the classifier flagged — iOS if `MOBILE_IOS: yes`,
Android if `MOBILE_ANDROID: yes`, both if both. They are independent releases (iOS can
ship while Android is skipped, and vice-versa). This is the **second deliberate pause**:
native releases go to Google/Apple review and burn a version, so the destination is a
per-release decision, never assumed.

**First, read `scripts/deploy/mobile-release-guide.md`** — it holds the decision logic
(what to ask, the options, defaults, and post-release rules). Then, for each flagged
platform, **present how far behind it is** (the classifier's `N commit(s) behind` line +
what would ship) and **ask greg** what to do. Per the guide, in brief:

- **iOS (`MOBILE_IOS: yes`)** — the workflow always uploads to **TestFlight** (no track
  input). Ask **release to TestFlight now, or skip?** Remind greg that external TestFlight
  and App Store submission (set the ASC record version to match `APP_VERSION`, attach the
  build, submit) are his manual console steps — the workflow does neither.
- **Android (`MOBILE_ANDROID: yes`)** — ask the **track**: `internal` (no review; test
  devices — the default for an unverified change) · `alpha` (closed testing, review) ·
  `beta` · `production`, or **skip**. Map "closed testing" → `alpha`. Keep
  `upload_to_play=true` (use `false` only for a brand-new app's first upload).

Skipping a platform is a valid answer — the change still shipped to web/PWA; the app just
catches up later. If greg skips one, do not dispatch it.

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
**not** auto-retry a store upload (a partial upload can consume a version code / build
number). A successful Android upload to a review track (`alpha`/`beta`/`production`) is
**auto-submitted for Google review**; `internal` is not. Remind greg that on-device
verification happens on the build just shipped, and that promoting internal → a review
track (Play) or TestFlight → App Store (Apple) is his manual console step.

## Step 8: Report

Summarise:
- Deployed commit SHA
- Which workflows ran (Main CI, Security, Vue Deploy, Astro Deploy, Mobile Android/iOS Release)
- Deploy durations (from `gh run view --json startedAt,updatedAt`)
- The release note that shipped (if authored) — the `en` line + version
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)
- **Mobile (per flagged platform)** — for iOS: released to TestFlight or skipped, plus the
  ASC submission step if it's App-Store-bound; for Android: which track it went to (and
  whether it auto-submitted for review) or skipped. Include the on-device verify +
  promote-in-console next steps that are greg's.

---

## Rules

- **Never use `--no-verify` or `--force`** on any git command.
- **Never skip or silence CI failures** — always fix the root cause.
- **Never amend published commits** — always create new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash commands run through the tool — they trigger permission prompts. If you need compound logic, add a script under `scripts/deploy/` and invoke it.
- **Stop and ask the user only** if there is an unrecoverable failure after 3 fix attempts, or something truly unexpected (merge conflicts, unknown infrastructure failures) — **plus the two deliberate pauses**: Step 4b (approve the release-note wording + `APP_VERSION` bump) and Step 7b (per flagged platform, choose the destination — iOS TestFlight-or-skip, Android track-or-skip).
- **Release note + version bump on every Vue deploy, version bump on every mobile release.** When `VUE: yes`, author + ship a release note AND bump `APP_VERSION` (Step 4b). When `MOBILE_IOS: yes` or `MOBILE_ANDROID: yes`, bump `APP_VERSION` too (native `versionName` / iOS marketing version track it). The deploy emoji is always ✨.
- **This skill ships everything the change requires** — Vue, Astro, AND the signed mobile app(s) — based on the four flags. The native apps embed the built Vue bundle, so a web change that hasn't reached a platform's last release flips its `MOBILE_*` flag; that platform's release runs in Step 7b (offered, never silently left for a manual follow-up), and skipping is greg's call.
- **iOS and Android are independent releases.** Ask + dispatch each on its own flag; never assume a change to one means the other, and never bundle them into a single question.
- **Mobile releases are review-gated + irreversible-ish.** Never auto-retry a failed store upload, never pick the track yourself (always the Step 7b pause), and never dispatch iOS when Apple enrolment/secrets aren't ready.
- The Vue deploy workflow is exactly `deploy.yml` ("Deploy beanies PROD"); the mobile ones are `mobile-android-release.yml` and `mobile-ios-release.yml`.
- The Astro deploy workflow name is exactly `deploy-web.yml`.
