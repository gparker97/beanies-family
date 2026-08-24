---
name: deploy-prod-auto
description: Auto-approved commit, push, CI monitor, and deploy to production
disable-model-invocation: true
---

# Deploy to Production (Auto-Approved)

Commits pending changes, gathers every decision that needs greg **up front**, then pushes, monitors CI, and deploys — running **unattended from the decision gate to completion**. Greg answers the questions in the first minute and can walk away; the long tail (test run, CI, S3 deploy, signed store builds) needs no babysitting.

**All actions are pre-approved:** commit, push, and deploy proceed automatically. The only reasons to stop are the single decision gate (Phase 1) and an unrecoverable failure after 3 fix attempts.

---

## Two design principles

**1. All decisions up front.** A full deploy is long — CI runs E2E, a signed iOS build takes ~5 minutes, Play/App-Store uploads follow. Greg should not have to sit and watch for a question to appear ten minutes in. So **every point where the skill needs greg is collected into ONE gate (Phase 1, Step 4)**, before any slow work starts. The two things that need him — the release-note wording + `APP_VERSION` bump, and the per-platform mobile destination — are asked together, in a single message. After that gate, the skill runs to completion without pausing (barring an unrecoverable failure it cannot fix). This ordering is the whole point of the skill; do not defer a question into the unattended phase.

**2. Minimise permission prompts.** Each Bash invocation is a **single, simple command** — no inline `$(...)` subshells, no `&&` / `||` / `;` chains, no `$?` inspection, no heredocs. Classification lives in `scripts/deploy/classify-changes.sh`; commit bodies use repeated `-m` flags. If a step seems to need a chain, add a script under `scripts/deploy/` and invoke it instead — skills invoke scripts, they don't orchestrate shells.

---

# PHASE 1 — Setup & decisions (the only part that needs greg; ~1 minute)

## Step 1: Verify GitHub account

```
gh auth status
```

The active account must be **`gparker97`**. If a different account is active, run `gh auth switch --user gparker97`. If `gparker97` isn't logged in at all, prompt greg to run `gh auth login`. (`gh` here reverts to `greg-grobrix` often — check every run.)

## Step 2: Commit pending changes (do NOT push yet)

The push is deliberately deferred to Phase 2 so that the pre-push test run + CI happen **after** greg has answered everything — nothing slow runs before the decision gate.

Check the working tree:
```
git status --short
```
```
git diff
```

Stage by explicit path (**never** `git add -A` / `git add .`; **never** stage `.env`, credentials, or secrets). Draft a conventional-commit message (`feat(area):` / `fix(...)` / `chore(...)`) and commit with repeated `-m` flags:
```
git add <path> <path>
```
```
git commit -m "feat(area): subject line" -m "Body paragraph explaining why." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

If the working tree is already clean (re-deploying an earlier commit), skip the commit — Step 3 still classifies HEAD against what's live.

## Step 3: Classify what needs deploying

All classification logic is in the script — one command:
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

Record all four flags. Each surface is an **independent distributable**; the classifier diffs HEAD against the SHA that surface last shipped from, so each flag answers "is this distributable behind HEAD?":

| Flag | Distributable | Shipped by |
|---|---|---|
| `VUE` | the Vue PWA (`app.beanies.family`) | `deploy.yml` (Step 8) |
| `WEB` | the Astro marketing site (apex) | `deploy-web.yml` (Step 6) |
| `MOBILE_IOS` | the iOS app (TestFlight / App Store) | `mobile-ios-release.yml` (Step 9) |
| `MOBILE_ANDROID` | the Android app (Google Play) | `mobile-android-release.yml` (Step 9) |

**Why a web-only change can flip a MOBILE flag:** the native apps EMBED the built Vue bundle (`dist/`, no over-the-air layer), so a `src/**` / `index.html` change reaches store/TestFlight users only through a new signed build. The classifier flags a platform when the embedded bundle OR its native shell changed since that platform's last release, using the **signed-release** lane as the baseline — NOT the debug-APK lane (`mobile-android-build.yml`), which auto-runs every push and would make the flag read `no` right after a native change. It also prints `N commit(s) behind` per platform — carry that into the Step 4 question.

**If all four are `no`** — report "no runtime changes since last deploy — nothing to ship" and stop. There is nothing to decide and nothing to run.

## Step 4: ⭐ DECISION GATE — ask greg everything now, in one message

This is the **only** place the skill needs greg. Gather both decisions below that apply, present them **together in a single message**, and wait for one round of answers. Then Phase 2 runs unattended. Do not trickle these out — a second question appearing ten minutes later is exactly what this skill exists to avoid.

Honor any standing instruction greg already gave this turn (e.g. "revision bump only, no release note", "internal track", "skip Android") — fold it into the proposal instead of re-asking.

**Decision A — release note + `APP_VERSION` bump** (needed if `VUE: yes` **or** `MOBILE_IOS: yes` **or** `MOBILE_ANDROID: yes`; skip if only `WEB: yes`):

Every Vue deploy ships a brief user-facing release note (it becomes the in-app `whats-new` bell on update) and bumps `APP_VERSION`. A mobile release needs the `APP_VERSION` bump too — the Android `versionName` and the iOS marketing version both track it, so a stale version is indistinguishable on-device. **Follow `scripts/deploy/release-note-guide.md` in full**: judge significance, draft the note in greg's voice (no em-dashes; `en` + lowercase `beanie` lines), compute the `YYYY.MM.DD[.N]` note version, and propose the next `APP_VERSION` (patch by default; `R<n>` for a same-release hotfix). Present ✨ + version + month + the en/beanie lines + spotlight? + a one-line rationale, **and** the `APP_VERSION` current → next. If greg said "no note", still propose the version bump alone (a `MOBILE`-only, non-user-facing change — e.g. manifest/entitlement — legitimately needs the bump but no note).

**Decision B — mobile destination, per flagged platform** (needed if `MOBILE_IOS: yes` and/or `MOBILE_ANDROID: yes`):

**Read `scripts/deploy/mobile-release-guide.md`** for the options/defaults, then present how far behind each flagged platform is (the classifier's `N commit(s) behind`) and ask:

- **iOS** — ask the **destination**: `testflight` (no review; internal testers — default for an unverified change) · `appstore-manual` (submit for review, hold for greg's Release click) · `appstore-automatic` (submit; auto-release once approved) · `appstore-phased` (submit; 7-day phased rollout), or **skip**. Options/defaults live in `mobile-release-guide.md` (already read above); record the chosen `destination`. Note App Store review still takes ~1-3 days — `automatic` only removes the final Release click, it does not ship instantly.
  - **If the chosen destination is `appstore-*`, ALSO propose an App Store "What's New" line in the SAME gate message and get it approved.** Apple requires a per-version "What's New" note, and the lane fails loud without it. Generate a short (1-3 sentence), user-facing line in **all lowercase to match the beanie theme** (greg's standing preference for App Store copy; no em-dashes) from the change set: reuse Decision A's `en` summary if a release note was written (lowercased), else synthesize one from the shipped commits (fall back to an honest "bug fixes and performance improvements." only when there's genuinely nothing user-facing). Record the approved text; it is passed as `-f whats_new=...` in Step 9. (`testflight` needs no What's New.) The lane keys the note to the real **`en-US`** locale (the app's only App Store locale); if a new locale is ever added, `ios/App/fastlane/Fastfile` must add its key too, or the review submission fails with "missing attribute 'whatsNew'".
  - **ALSO propose an App Store "promotional text" line in the SAME gate message (optional).** Promotional text (≤170 chars) shows above the description, needs **no review**, and is not tied to a build — so it can change any time. Propose a short lowercase line (reuse the current one if unchanged), get approval, and pass it as `-f promotional_text=...` in Step 9. **Leaving it blank keeps the current App Store value** — never blank it unintentionally. (`testflight` ignores it.)
- **Android** — ask the **track**: `internal` (no review; test devices — default for an unverified change) · `alpha` (closed testing, review) · `beta` · `production`, or **skip**. Map "closed testing" → `alpha`; keep `upload_to_play=true`.

Skipping a platform is valid (the change still ships to web/PWA; the app catches up later). **Record the answers** (release note text + version; iOS `destination` + the approved `whats_new` AND the approved `promotional_text` for `appstore-*`, or skip; Android track or skip) — Phase 2 consumes them without asking again.

---

# PHASE 2 — Unattended execution (greg can walk away)

No more questions from here. Work the steps in order; on failure, follow each step's recovery. Stop only on an unrecoverable failure after 3 fix attempts.

## Step 5: Apply the decisions + push once

If Decision A produced a note/version, prepend the entry to `src/content/release-notes/deploys.ts` (skip if "no note") and set `src/constants/appVersion.ts` to the approved `APP_VERSION` (Edit tool), then commit:
```
git add src/content/release-notes/deploys.ts src/constants/appVersion.ts
```
```
git commit -m "docs(release): note <version> (app v<APP_VERSION>) for prod deploy" -m "<the en summary>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(If the bump is version-only with no note, stage just `src/constants/appVersion.ts` and word the subject accordingly.)

Then push everything — the Step 2 commit and this one ride together in a **single** push (one CI run):
```
git push
```
The pre-push hook runs `npm run test:run`. On failure: read the output, fix the root cause (**never** `--no-verify`), commit the fix (new commit, never amend), push again — up to 3 attempts, then stop and report.

## Step 6: Deploy the Astro site (only if `WEB: yes`) — fires immediately

Astro has no external CI gate, so start it now and let it run alongside CI.
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
If it fails, fetch logs (`gh run view <id> --log-failed`) and report — it doesn't block the Vue/mobile flow.

## Step 7: Monitor CI + Security (if `VUE: yes` or either `MOBILE_*: yes`)

CI green is the gate for **both** the Vue deploy (Step 8) and the mobile releases (Step 9) — never ship a red build to prod or a store. (Pure `WEB: yes` doesn't need this; Astro has no CI gate.)

| Workflow | File | Checks |
|---|---|---|
| **Main Branch CI** | `main-ci.yml` | type-check, lint, format, unit tests, build, E2E (Chromium + Firefox) |
| **Security Scanning** | `security.yml` | npm audit, SAST, secrets, CodeQL |

```
sleep 30
```
```
gh run list --workflow=main-ci.yml --branch=main --limit=1
```
```
gh run list --workflow=security.yml --branch=main --limit=1
```
```
gh run watch <ci-run-id> --exit-status
```
```
gh run watch <security-run-id> --exit-status
```
On failure: `gh run view <run-id> --log-failed`, fix the root cause, commit (new commit) + push, then restart Step 7. Max 3 rounds, then stop and report.

## Step 8: Deploy the Vue app (only if `VUE: yes`) — after CI green

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
The deploy workflow re-verifies CI/Security for the commit. If it fails, report logs — do not auto-retry.

## Step 9: Release the mobile app(s) (for each flagged platform) — after CI green

Use the destinations **already chosen in Step 4** — do not ask again. Dispatch each flagged platform greg chose to release (they're independent; iOS can ship while Android is skipped). Waiting for CI green (Step 7) is why this is here and not in Phase 1.

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

**iOS**, only if greg chose a destination (pass the chosen `destination`; for any `appstore-*`, also pass the approved `whats_new` and — if approved — `promotional_text` from Step 4):
```
gh workflow run mobile-ios-release.yml --ref main -f destination=<testflight|appstore-manual|appstore-automatic|appstore-phased> -f whats_new="<approved What's New line>" -f promotional_text="<approved promotional text, or omit to keep the current value>"
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

On a release failure, fetch logs (`gh run view <id> --log-failed`) and report — do **not** auto-retry a store upload (a partial upload can consume a version code / build number). A successful Android upload to a review track (`alpha`/`beta`/`production`) is **auto-submitted for Google review**; `internal` is not. An iOS `appstore-*` run **submits to App Store review**; after approval `appstore-manual` waits for greg's Release click while `appstore-automatic`/`appstore-phased` self-release. `testflight` is internal, no review.

## Step 10: Report

Summarise:
- Deployed commit SHA + the `APP_VERSION` shipped
- Which workflows ran (Main CI, Security, Vue Deploy, Astro Deploy, Mobile iOS/Android Release) + durations (`gh run view --json startedAt,updatedAt`)
- The release note that shipped (if any) — the `en` line + version
- Production URL(s) — `https://app.beanies.family` (Vue) and/or `https://beanies.family` (Astro)
- **Mobile (per flagged platform)** — iOS destination (TestFlight, or which `appstore-*` mode and that it was submitted for review) or skipped; Android track it went to (and whether auto-submitted for review) or skipped
- The on-device verify + post-approval next steps that are greg's (Play: internal → review track; Apple: the review verdict, and for `appstore-manual` the Release click in App Store Connect)

---

## Rules

- **The decision gate (Step 4) is the only pause.** Ask everything greg-facing there, together. Never surface a new question during Phase 2 — if you find yourself wanting to, it belonged in Step 4.
- **Never use `--no-verify` or `--force`** on any git command.
- **Never skip or silence CI failures** — always fix the root cause. **Never amend published commits** — always new fix commits.
- **Never inline `$(...)` / `$?` / `;` / `&&` / heredocs** in Bash run through the tool. Compound logic → a script under `scripts/deploy/`.
- **Release note + version bump when `VUE: yes`; version bump when any `MOBILE_*: yes`** (native `versionName` / iOS marketing version track `APP_VERSION`). Deploy emoji is always ✨.
- **This skill ships everything the change requires** — Vue, Astro, AND the signed mobile app(s) — from the four flags. A web change that hasn't reached a platform's last release flips its `MOBILE_*` flag; that release runs in Step 9 (offered at Step 4, never silently deferred), and skipping is greg's call.
- **iOS and Android are independent releases.** Decide + dispatch each on its own flag; never assume one implies the other.
- **Mobile releases are review-gated + irreversible-ish.** Never auto-retry a failed store upload; never pick the destination yourself (that's Step 4).
- **CI green gates prod + store builds.** Vue deploy and mobile releases both wait for Step 7. Only Astro (no CI gate) and the `skip-ci` sibling skip that wait.
- Workflow names are exactly: `deploy.yml` ("Deploy beanies PROD"), `deploy-web.yml`, `mobile-android-release.yml`, `mobile-ios-release.yml`.
