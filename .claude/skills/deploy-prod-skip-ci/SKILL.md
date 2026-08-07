---
name: deploy-prod-skip-ci
description: Auto-approved commit, push, and deploy to production — skips the CI/Security gate for fast, locally-verified deploys. Classifies what changed and deploys the Vue app and/or the Astro marketing site as needed (same target-classification as deploy-prod-auto, minus the remote-CI wait).
disable-model-invocation: true
---

# Deploy to Production (Skip CI)

Commits pending changes, gathers every decision that needs greg **up front**, then pushes and deploys immediately — **skipping the CI/Security wait**. Use for small, locally-verified changes (config tweaks, copy, hotfixes). Same target classification as `deploy-prod-auto`; the difference is this passes `skip_gate=true` to `deploy.yml` and does **not** wait for remote CI, so the unattended tail is short.

**All actions are pre-approved.** The only reasons to stop are the single decision gate (Phase 1) and an unrecoverable failure after 3 fix attempts.

---

## Two design principles

**1. All decisions up front.** Even a skip-CI deploy can trail a signed store build (~5 min for iOS). Greg should not have to watch for a question to appear mid-run. So **every point where the skill needs greg is collected into ONE gate (Phase 1, Step 4)** — the release-note wording + `APP_VERSION` bump, and the per-platform mobile destination — asked together, in a single message. After that gate, the skill runs to completion without pausing (barring an unrecoverable failure). Do not defer a question into the unattended phase.

**2. Minimise permission prompts.** Each Bash invocation is a **single, simple command** — no inline `$(...)` subshells, no `&&` / `||` / `;` chains, no `$?` inspection, no heredocs. Classification lives in `scripts/deploy/classify-changes.sh`; commit bodies use repeated `-m` flags. Compound logic → a script under `scripts/deploy/`, not an inline chain.

---

# PHASE 1 — Setup & decisions (the only part that needs greg; ~1 minute)

## Step 1: Verify GitHub account

```
gh auth status
```
The active account must be **`gparker97`**. If a different account is active, run `gh auth switch --user gparker97`. If `gparker97` isn't logged in at all, prompt greg to run `gh auth login`. (`gh` here reverts to `greg-grobrix` often — check every run.)

## Step 2: Commit pending changes (do NOT push yet)

The push is deferred to Phase 2 so the pre-push test run happens **after** greg has answered everything.

```
git status --short
```
```
git diff
```
Stage by explicit path (**never** `git add -A` / `git add .`; **never** stage `.env`, credentials, or secrets), then commit with repeated `-m` flags:
```
git add <path> <path>
```
```
git commit -m "feat(area): subject line" -m "Body paragraph explaining why." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
If the working tree is already clean (re-deploying an earlier commit), skip the commit — Step 3 still classifies HEAD against what's live.

## Step 3: Classify what needs deploying

```
bash scripts/deploy/classify-changes.sh
```
The final block is machine-readable:
```
=== Deploy targets ===
VUE: yes|no
WEB: yes|no
MOBILE_IOS: yes|no
MOBILE_ANDROID: yes|no
```
Record all four flags. Each surface is an **independent distributable**; the classifier diffs HEAD against the SHA that surface last shipped from:

| Flag | Distributable | Shipped by |
|---|---|---|
| `VUE` | the Vue PWA (`app.beanies.family`) | `deploy.yml` (Step 7, `skip_gate=true`) |
| `WEB` | the Astro marketing site (apex) | `deploy-web.yml` (Step 6) |
| `MOBILE_IOS` | the iOS app (TestFlight / App Store) | `mobile-ios-release.yml` (Step 8) |
| `MOBILE_ANDROID` | the Android app (Google Play) | `mobile-android-release.yml` (Step 8) |

**Why a web-only change can flip a MOBILE flag:** the native apps EMBED the built Vue bundle (`dist/`, no over-the-air layer), so a `src/**` / `index.html` change reaches store/TestFlight users only through a new signed build. The classifier flags a platform when the embedded bundle OR its native shell changed since that platform's last release, using the **signed-release** lane as the baseline (NOT the debug-APK lane, which auto-runs every push). It also prints `N commit(s) behind` per platform — carry that into Step 4.

**If all four are `no`** — report "no runtime changes since last deploy — nothing to ship" and stop.

## Step 4: ⭐ DECISION GATE — ask greg everything now, in one message

This is the **only** place the skill needs greg. Gather both decisions below that apply, present them **together in a single message**, wait for one round of answers, then run Phase 2 unattended. Honor any standing instruction greg already gave this turn (e.g. "revision bump only, no release note", "internal track") — fold it in rather than re-asking.

**Decision A — release note + `APP_VERSION` bump** (needed if `VUE: yes` **or** either `MOBILE_*: yes`; skip if only `WEB: yes`): **Follow `scripts/deploy/release-note-guide.md` in full** — judge significance, draft the note in greg's voice (no em-dashes; `en` + lowercase `beanie`), compute the `YYYY.MM.DD[.N]` note version, and propose the next `APP_VERSION` (patch by default; `R<n>` for a same-release hotfix). Present ✨ + version + month + en/beanie + spotlight? + rationale, and the `APP_VERSION` current → next. A mobile release needs the version bump too (Android `versionName` / iOS marketing version track it). If greg said "no note", propose the version bump alone.

**Decision B — mobile destination, per flagged platform** (needed if `MOBILE_IOS: yes` and/or `MOBILE_ANDROID: yes`): **Read `scripts/deploy/mobile-release-guide.md`**, present how far behind each flagged platform is, and ask:
- **iOS** — the workflow only uploads to **TestFlight**. Ask **release to TestFlight now, or skip?** (External TestFlight + App Store submission are greg's manual console steps.)
- **Android** — ask the **track**: `internal` (default; no review, test devices) · `alpha` (closed, review) · `beta` · `production`, or **skip**. Map "closed testing" → `alpha`; keep `upload_to_play=true`.

Skipping a platform is valid. **Record the answers** — Phase 2 consumes them without asking again.

---

# PHASE 2 — Unattended execution (greg can walk away)

No more questions. Skip-CI means the remote CI/Security gate is bypassed — the Vue deploy fires with `skip_gate=true` and the mobile releases dispatch without waiting for CI. (CI + Security still run in the background from the push; they're not awaited. If they fail, investigate on the next cycle.)

## Step 5: Apply the decisions + push once

If Decision A produced a note/version, prepend the entry to `src/content/release-notes/deploys.ts` (skip if "no note") and set `src/constants/appVersion.ts` to the approved `APP_VERSION` (Edit tool), then commit:
```
git add src/content/release-notes/deploys.ts src/constants/appVersion.ts
```
```
git commit -m "docs(release): note <version> (app v<APP_VERSION>) for prod deploy" -m "<the en summary>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(Version-only, no note: stage just `src/constants/appVersion.ts` and word the subject accordingly.)

Push everything — the Step 2 commit and this one ride together in a **single** push:
```
git push
```
The pre-push hook runs `npm run test:run` (this local gate is NOT skipped — only the remote CI wait is). On failure: fix the root cause (**never** `--no-verify`), commit the fix (new commit, never amend), push again — up to 3 attempts, then stop and report.

## Step 6: Deploy the Astro site (only if `WEB: yes`)

```
gh workflow run deploy-web.yml --ref main
```
`deploy-web.yml` accepts no `workflow_dispatch` inputs — any `-f` flag returns HTTP 422. Then:
```
sleep 10
```
```
gh run list --workflow=deploy-web.yml --limit=1
```
```
gh run watch <web-run-id> --exit-status
```
If it fails, fetch logs (`gh run view <id> --log-failed`) and report.

## Step 7: Deploy the Vue app (only if `VUE: yes`) — skip-gate

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
`skip_gate=true` bypasses only the CI/Security wait — the build + S3 deploy still run normally. If it fails, fetch logs and report; do not auto-retry.

## Step 8: Release the mobile app(s) (for each flagged platform)

Use the destinations **already chosen in Step 4** — do not ask again. Skip-CI dispatches these without a CI wait (the local pre-push suite already ran). Dispatch each flagged platform greg chose to release (independent — iOS can ship while Android is skipped).

**Android** (with greg's chosen `<track>`), only if greg chose to release it:
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

**iOS** (TestFlight), only if greg chose to release it:
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

On a release failure, fetch logs (`gh run view <id> --log-failed`) and report — do **not** auto-retry a store upload (a partial upload can consume a version code / build number). A successful Android upload to a review track (`alpha`/`beta`/`production`) is **auto-submitted for Google review**; `internal` is not.

## Step 9: Report

Summarise:
- Deployed commit SHA + the `APP_VERSION` shipped
- Which workflows ran (Vue Deploy, Astro Deploy, Mobile iOS/Android Release) + durations (`gh run view --json startedAt,updatedAt`)
- The release note that shipped (if any) — the `en` line + version
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)
- **Mobile (per flagged platform)** — iOS released to TestFlight or skipped (+ ASC submission step if App-Store-bound); Android track (and whether auto-submitted for review) or skipped
- Greg's on-device verify + promote-in-console next steps
- **Note:** Main CI + Security still ran in the background from the push and were not awaited — if either fails, investigate on the next cycle.

---

## Rules

- **The decision gate (Step 4) is the only pause.** Ask everything greg-facing there, together. Never surface a new question during Phase 2.
- **Never use `--no-verify` or `--force`.** **Never amend published commits** — always new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash run through the tool. Compound logic → a script under `scripts/deploy/`.
- **Release note + version bump when `VUE: yes`; version bump when any `MOBILE_*: yes`.** Deploy emoji is always ✨.
- **This skill ships everything the change requires** — Vue, Astro, AND the signed mobile app(s) — from the four flags. A web change behind a platform's last release flips its `MOBILE_*` flag; that release runs in Step 8 (offered at Step 4), and skipping is greg's call.
- **iOS and Android are independent releases.** Decide + dispatch each on its own flag.
- **Mobile releases are review-gated + irreversible-ish.** Never auto-retry a failed store upload; never pick the destination yourself (that's Step 4).
- **`skip_gate` bypasses only the remote CI/Security wait** — the local pre-push suite, the build, and the S3 deploy all still run. Use this skill only for changes already verified locally.
- Workflow names are exactly: `deploy.yml` ("Deploy beanies PROD"), `deploy-web.yml`, `mobile-android-release.yml`, `mobile-ios-release.yml`.
