# Plan: iOS App Store submission lane (mirror Android's Play-track release)

> Date: 2026-08-21
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-08-21-ios-appstore-submit-lane.md`

## User Story

As the solo publisher of beanies.family, I want to submit and release the iOS app to the public App Store directly from a GitHub Actions dispatch — the way the Android lane ships to a Play track — so that shipping an iOS update is a one-click workflow run instead of a manual App Store Connect console dance (create version → attach build → answer compliance → submit).

## Context

Apple approved the iOS app on 2026-08-21; it is "Ready for Distribution". The first review is cleared, which unlocks programmatic submission for all future versions.

Today the iOS lane is TestFlight-only:

- `.github/workflows/mobile-ios-release.yml` — `workflow_dispatch` with **no inputs**; always builds a signed IPA and runs `fastlane beta`.
- `ios/App/fastlane/Fastfile` — one lane, `beta`: `build_app` (Release, app-store export, cloud-managed signing via the App Store Connect API key) → `upload_to_testflight`.
- App Store _submission_ has always been a manual ASC step. `scripts/deploy/mobile-release-guide.md` and `.claude/skills/deploy-prod-auto/SKILL.md` (Step 4 gate) both tell greg "iOS only uploads to TestFlight; App Store submission is your manual console step."

Android, by contrast (`mobile-android-release.yml`), takes a `track` choice input and auto-submits for review via `r0adkll/upload-google-play` (`status: completed`, `changesNotSentForReview: false`). We want the iOS analog.

greg's decision this session: **hold the store launch of the older approved build (0.9.10R8) and instead submit a fresh 0.9.11 build for review.** This new lane is the mechanism that submits 0.9.11 — its first real use.

## Requirements

1. Add a **single** `destination` choice input to `mobile-ios-release.yml`: `testflight` (default) | `appstore-manual` | `appstore-automatic` | `appstore-phased`. This is iOS's analog of Android's `track`. A single input (rather than a separate `destination` + `release-mode` pair) is deliberate: it eliminates the silent-ignore edge where a `testflight` run also carries a meaningless release-mode value — aligning with the project's no-silent-failures rule. (iOS has no `upload_to_play`-style boolean to mirror, so folding TestFlight-vs-AppStore and the release mode into one choice stays clean.)
2. `destination: testflight` must reproduce **today's behavior byte-for-byte** (build signed IPA → `fastlane beta` → TestFlight). No regression for the existing flow.
3. Any `appstore-*` destination builds the same signed IPA and **submits it to App Store review** via fastlane `deliver`/`upload_to_app_store`, reusing the existing ASC metadata/screenshots (do not upload or overwrite listing content).
4. The `appstore-*` suffix controls post-approval release behavior: `manual` (hold for developer release) | `automatic` (release right after approval) | `phased` (7-day phased rollout after approval).
5. The App Store submission must auto-answer export compliance so it never stalls (Info.plist already declares `ITSAppUsesNonExemptEncryption = false`; the lane should also pass the equivalent `submission_information` to be robust to ASC re-prompts).
6. Update the shared judgment doc `scripts/deploy/mobile-release-guide.md` (iOS section) and the deploy skill `.claude/skills/deploy-prod-auto/SKILL.md` (Step 4 gate + Phase 2 dispatch) so greg is asked "TestFlight, or App Store (submit for review)?" per platform — mirroring the Android track question — with `testflight` as the safe default.
7. No change to the Vue build step or its `env:` block — client-env parity (`workflowEnvParity.test.ts`) must stay green with no new exemptions.
8. Document the exact sequence to submit the fresh 0.9.11 build.

## Important Notes & Caveats

- **Never auto-retry a failed store upload/submit.** A partial `deliver` run can consume the ASC build number; the existing post-release rule in `mobile-release-guide.md` applies. On failure: `gh run view <id> --log-failed`, report, let greg decide.
- **Export compliance is already solved** in `ios/App/App/Info.plist` (`ITSAppUsesNonExemptEncryption` = `false`, with a comment explaining beanies ships only exempt AES-GCM/AES-KW + TLS). The lane passes `submission_information` (`export_compliance_uses_encryption: false`) belt-and-braces so a `deliver` run never blocks on the interactive prompt. **Do not** change the Info.plist declaration.
- **API key role.** The App Store Connect API key already has **App Manager** (used today for cloud-managed signing with `-allowProvisioningUpdates`). App Manager can create app versions and submit for review, so `deliver` needs no new credential — verify once on first run, no code change.
- **The submitted marketing version must be new to the store.** `deliver` creates/uses the ASC version equal to `MARKETING_VERSION` (derived from `APP_VERSION`, R-suffix stripped). 0.9.11 has never been on the store, so it is a clean new version. If a version already exists in a non-editable state, `deliver` errors — surface it, don't retry blindly.
- **`build_app` config must not diverge between the two lanes.** The signing/export xcargs are identical for TestFlight and App Store (both are `app-store` export). Duplicating that block invites drift — extract it once (see Approach).
- **This is CI/release infrastructure, not app runtime.** There is no client CloudWatch telemetry here; success/failure surfaces as the GitHub Actions run status (see Observability Coverage).
- **Phased-release behavior is verify-on-first-run.** The `phased` map sets only `{phased_release: true}`. Whether phased rollout begins automatically on approval or waits for a manual Release click first is an ASC/`deliver` interaction not proven here. The first `appstore-phased` run must confirm the post-approval behavior matches the guide's "7-day phased rollout after approval" wording; if ASC instead holds for a manual Release, add `automatic_release: true` to the `phased` map. (Testing Plan step 4 covers this.)

## Assumptions

> **Review these before implementation.**

1. The App Store Connect API key's App Manager role is sufficient to create a version and submit for review (standard for `deliver`; confirmed by Apple's role matrix).
2. The existing ASC app listing (screenshots, description, keywords, privacy answers) is complete and current, so the lane can `skip_metadata` + `skip_screenshots` and submit against the existing listing.
3. `derive-store-version.mjs` yields a store-clean `0.9.11` from `APP_VERSION = 0.9.11R3`.
4. `fastlane` (installed per-run via `gem install fastlane`) `deliver` supports the `submission_information`, `automatic_release`, and `phased_release` options at the current version.
5. Apple's "Ready for Distribution" state (first version approved) is what unlocks programmatic `submit_for_review` for subsequent versions.

## Approach

### 1. `ios/App/fastlane/Fastfile` — extract shared build, add `release` lane

Refactor to remove the two largest duplications (the `build_app` block and the ASC API-key block), then add the `release` lane:

- Add a private helper `asc_api_key` returning the `app_store_connect_api_key(...)` value (7 identical lines today live only in `beta`). Both `beta` and `release` call it for their upload step. NB: `build_app` does **not** use it — it authenticates via the `-authenticationKey*` xcargs — so it's only consumed by the two upload steps.
- Add a private helper `build_ipa` containing the exact current `build_app(...)` call. The IPA path is the top-of-file `IPA_PATH` constant (see Guard below), used by `build_app`'s output and both upload calls — so the string lives in one place.
- `beta` (unchanged behavior): `build_ipa` → `upload_to_testflight(api_key: asc_api_key, ipa: IPA_PATH, skip_waiting_for_build_processing: true)` — same as today.
- New `release` lane: `build_ipa` → `upload_to_app_store(...)` with:
  - `api_key: asc_api_key`, `ipa: IPA_PATH`.
  - `submit_for_review: true`.
  - The release-mode options **splatted from a single explicit map** (see guard below).
  - `skip_metadata: true`, `skip_screenshots: true` (reuse existing listing — nothing local is checked in to push).
  - `force: true` (no interactive HTML preview on CI).
  - `run_precheck_before_submit: false` — the lane pushes no metadata/screenshots, so precheck would only add a flaky ASC round-trip that can fail the submit without validating anything this lane changed. Comment the rationale inline. (`precheck_include_in_app_purchases` is therefore moot and omitted.)
  - `submission_information: { export_compliance_uses_encryption: false }` (belt-and-braces to the Info.plist declaration).

Guard (fail-loud, DRY single lookup): `release` maps `ENV["IOS_DESTINATION"]` (the workflow passes the full `destination` value; unset → treat as `appstore-manual`) through one `case` after stripping the `appstore-` prefix: `manual` → `{automatic_release: false, phased_release: false}`, `automatic` → `{automatic_release: true}`, `phased` → `{phased_release: true}`; any other value → `UI.user_error!("IOS_DESTINATION must be appstore-manual|appstore-automatic|appstore-phased, got '#{...}'")`. The resulting hash is splatted into `upload_to_app_store`. No silent default.

Also define the IPA path once as a top-of-file Ruby constant `IPA_PATH = "build/beanies.ipa"`. `build_app` takes the directory and name as **separate** args, so `build_ipa` passes `output_directory: File.dirname(IPA_PATH)` and `output_name: File.basename(IPA_PATH)` (do NOT pass the combined string to either — that yields `build/build/beanies.ipa`); both `upload_to_testflight` and `upload_to_app_store` pass `ipa: IPA_PATH`. Single source of truth without threading `lane_context[SharedValues::IPA_OUTPUT_PATH]`.

Guard default: unset `ENV["IOS_DESTINATION"]` maps to `appstore-manual` (the safest hold). This is a soft exception to the fail-loud stance and only bites on a bare local `fastlane release` — the workflow always sets the env. Add a one-line Fastfile comment stating exactly that, so the default reads as deliberate, not an oversight.

Contract note: the `appstore-` prefix is the shared boundary between the workflow's lane selector (§2) and this parser. It is deliberately parsed in exactly these two places and nowhere else; adding a new `destination` option means updating both the workflow's `options:` list and this `case`. This is the plan's only intentional cross-file coupling — call it out in a comment in both files.

### 2. `.github/workflows/mobile-ios-release.yml` — inputs + lane selection

- Add `on.workflow_dispatch.inputs`:
  - `destination`: `type: choice`, `default: testflight`, `options: [testflight, appstore-manual, appstore-automatic, appstore-phased]`, with a description of each.
- Keep every existing step identical (checkout, node, npm ci, derive version, **build web app with the unchanged `env:` block**, cap sync ios, write ASC key).
- The final step changes from a hardcoded `fastlane beta` to lane selection:
  - `run: fastlane ${{ startsWith(inputs.destination, 'appstore') && 'release' || 'beta' }}` — precede it with an inline comment stating the routing rule plainly (any `appstore-*` → `release`; `testflight` → `beta`) so the control flow is legible without evaluating GitHub expression precedence.
  - Add `IOS_DESTINATION: ${{ inputs.destination }}` to that step's `env:` (alongside the existing ASC/version env). The `release` lane strips the `appstore-` prefix to resolve the release mode; the `beta` lane ignores it entirely.
- Because the build step and its `VITE_*` env are untouched, `workflowEnvParity.test.ts` stays green with no new exemption (its regex only scans `VITE_` keys, so a non-`VITE_` input/env like `IOS_DESTINATION` is invisible to it — verified).

### 3. `scripts/deploy/mobile-release-guide.md` — iOS section rewrite

Replace the "iOS — TestFlight (no inputs)" section with a single-input destination question mirroring the Android track table. **The options table lives ONLY here** (the guide owns judgment); the skill defers to it, so there is one source of truth:

| Answer greg might give              | `destination`        | Result                                                       |
| ----------------------------------- | -------------------- | ------------------------------------------------------------ |
| internal testing / on-device verify | `testflight`         | signed build → TestFlight (internal), no review              |
| submit to App Store, hold release   | `appstore-manual`    | build → App Store review; after approval greg clicks Release |
| submit to App Store, auto-release   | `appstore-automatic` | build → review; releases automatically once approved         |
| submit to App Store, phased         | `appstore-phased`    | build → review; 7-day phased rollout after approval          |
| not this time                       | —                    | skip iOS                                                     |

- **Default `testflight`** for an unverified native change (same low-stakes default as Android's `internal`).
- **Fix the now-false post-release rules (lines ~96–99).** The bullets "**iOS App Store submission is never automatic** — it is the manual ASC console step above" and "TestFlight → App Store (Apple) is his manual console step" become false once this lane exists. Replace with: an `appstore-*` run submits for review; after approval the **Release** click is greg's for `appstore-manual`, or the lane self-releases for `appstore-automatic`/`appstore-phased`. TestFlight remains no-review. Keep: never auto-retry a failed submit; on-device verification is on the build just shipped.

### 4. `.claude/skills/deploy-prod-auto/SKILL.md` — Step 4 gate + Phase 2 dispatch + report

Keep the skill's one-liner style (it defers to the guide for options — do **not** copy the table in):

- **Step 4 iOS bullet (line ~98):** replace "release to TestFlight now, or skip?" with: ask the **destination** — `testflight` (no review; internal — default for an unverified change) or **App Store** with a release mode (`manual`/`automatic`/`phased`), or **skip**; options/defaults live in `mobile-release-guide.md` (already read for Decision B); record the chosen `destination`.
- **Phase 2 / Step 9 iOS dispatch (lines ~204–216):** currently `gh workflow run mobile-ios-release.yml --ref main`; add the chosen input, e.g. `-f destination=appstore-manual`.
- **Step 10 report (line ~227):** "iOS released to TestFlight or skipped" → report the actual destination and, for App Store, that it was submitted for review plus the post-approval mode (manual Release click vs auto/phased).

### 5. Sequence to submit the fresh 0.9.11 build (documented in the plan + guide)

1. Land this change on `main` (iOS lane + Fastfile + guide + skill).
2. Confirm `APP_VERSION` is the intended store version (currently `0.9.11R3` → store `0.9.11`); bump per `release-note-guide.md` only if a newer marketing version is wanted.
3. Dispatch `mobile-ios-release.yml` with `destination=appstore-manual`.
4. The lane builds the signed 0.9.11 IPA, uploads, and submits it for App Store review.
5. On Apple approval, release it (with `manual` greg clicks **Release** in ASC; had `automatic`/`phased` been chosen it releases itself).

## Files Affected

- `ios/App/fastlane/Fastfile` — extract `build_ipa` helper; add `release` lane.
- `.github/workflows/mobile-ios-release.yml` — add the single `destination` choice input; select `release` vs `beta` by `appstore` prefix; add `IOS_DESTINATION` env on the fastlane step.
- `scripts/deploy/mobile-release-guide.md` — rewrite the iOS section with the destination table + strengthened post-release rules.
- `.claude/skills/deploy-prod-auto/SKILL.md` — Step 4 iOS question + Phase 2 iOS dispatch inputs.
- `docs/plans/2026-08-21-ios-appstore-submit-lane.md` — this plan (permanent record).
- (No change to `ios/App/App/Info.plist` — export compliance already declared; noted to prevent a well-meaning edit.)

## Observability Coverage

This is CI/release infrastructure, not app runtime code — there is no client `logEvent`/`reportError`/`perfTiming` surface and no CloudWatch signal to add. The diagnostic signal that matters is the **GitHub Actions run status**:

- **Success/failure signal**: the fastlane step fails the job (non-zero exit) on any `build_app`/`upload_to_app_store` error, so a failed submission is a red run in the Actions tab — the deploy skill's Phase 2 already tails `gh run list`/`gh run view --log-failed` and reports it.
- **Failure modes triageable from the run log**: signing failure (xcodebuild output), duplicate/uneditable ASC version (`deliver` error text), auth/role failure (App Store Connect API error), export-compliance prompt (pre-empted by `submission_information` — if it ever appears, the log names it). No failure is swallowed; there is no `catch`-equivalent that hides a bad exit.
- **No silent-failure path**: a malformed `IOS_DESTINATION` triggers an explicit `UI.user_error!` in the Fastfile rather than defaulting silently.
- **Privacy/store gate**: no new client `context` key, so no `ALLOWED_CONTEXT_KEYS` or store-declaration change.

## Acceptance Criteria

- [ ] `mobile-ios-release.yml` has a single `destination` input: `testflight` (default) | `appstore-manual` | `appstore-automatic` | `appstore-phased`.
- [ ] `destination=testflight` runs `fastlane beta` and behaves exactly as before (TestFlight upload; no submission).
- [ ] Any `appstore-*` destination runs `fastlane release`, which builds the signed IPA and submits it for App Store review honoring the release mode.
- [ ] Both the `build_app` config and the ASC API-key block are each defined once and shared by both lanes (no duplication/drift); the IPA path is not a repeated magic string.
- [ ] `workflowEnvParity.test.ts` passes with no new exemption (build env untouched).
- [ ] `mobile-release-guide.md` iOS section presents the destination table + post-release rules; `deploy-prod-auto` Step 4 asks the destination question and Phase 2 dispatches the chosen inputs.
- [ ] A malformed release-phase value fails fast with a clear message (no silent default).
- [ ] The plan documents the exact 0.9.11-submission sequence.

## Testing Plan

1. **Static/lint**: `fastlane` lane parses (`fastlane lanes` locally if available) — the Fastfile is valid Ruby; the workflow YAML is valid.
2. **Parity**: `npm run test:run` — `workflowEnvParity.test.ts` green (no env drift).
3. **Dry behavior review**: confirm the `run:` expression resolves to `beta` when `destination=testflight` and `release` for any `appstore-*` value (GitHub `startsWith` semantics), and that the Fastfile's phase `case` fails loud on an unexpected `IOS_DESTINATION`.
4. **First live run (greg)**: dispatch with `destination=appstore-manual` for 0.9.11; watch the run; confirm the build appears in ASC as "Waiting for Review" for version 0.9.11 with no export-compliance prompt.
5. **Regression**: a subsequent `destination=testflight` dispatch still lands a build in TestFlight unchanged.
6. **Failure path**: (optional) dispatch with a version already present/uneditable on ASC and confirm the run fails loudly with the `deliver` error rather than half-submitting.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — destination input, shared build helper + `release` lane, release-phase control, doc/skill updates, and the 0.9.11 sequence; incorporated the two research findings (export compliance already declared; parity test unaffected).
- **Pass 2 (DRY + error handling)**: Collapsed the two inputs into one `destination` choice (kills a silent-ignore edge); de-duplicated the ASC API-key block + IPA path (not just `build_app`); dropped flaky precheck; made the release-phase a single fail-loud `case`; and flagged the now-false post-release/report lines in the guide + skill as required correctness edits.
- **Pass 3 (Sustainability)**: Fixed a stale two-input self-contradiction in Files Affected + Observability (→ single `destination`/`IOS_DESTINATION`); named the `appstore-` prefix as the sole cross-file coupling (comment it in both files); required an inline routing comment on the lane-selection ternary; and simplified the IPA path to a single top-of-file constant.
- **Pass 4 (Fresh-eyes sweep)**: Fixed a real bug — `IPA_PATH` must be split via `File.dirname`/`File.basename` for `build_app`'s separate output args (not passed combined); added a phased-vs-automatic verify-on-first-run caveat; and made the `IOS_DESTINATION` unset→`appstore-manual` default an explicit, commented exception to the fail-loud stance.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (this session, iOS approval)

> apple review has finally approved the app! the iOS app is now listed as 'ready for distribution' - is there anything we need to do now to push the latest version to the app store? do we need to modify the /deploy-prod-auto skill now to have the ability to push the app direct to a certain track (i.e. testing/prod/etc) similar that we do with the android app?

### Decision 1 (AskUserQuestion — First release)

> Submit fresh 0.9.11 first (hold the store launch; submit the latest code for review rather than releasing the older approved R8).

### Decision 2 (AskUserQuestion — iOS lane)

> Yes, plan it via /beanies-plan.

### Outcome (2026-08-21)

Implemented + shipped the same day. First live use surfaced two real-world facts the
plan hadn't anticipated, both now fixed:

1. **Apple's already-approved version was 0.9.11, not 0.9.10.** Submitting `0.9.11R4`
   (store version 0.9.11 after R-strip) was rejected — `CFBundleShortVersionString` must
   be strictly higher than the last approved version. Bumped to `0.9.12`. Lesson: the
   store marketing version must always exceed the last _approved_ App Store version, and
   the R-suffix does not count (it's stripped).
2. **`submit_for_review` fails without a "What's New" note.** With `skip_metadata: true`
   the new version record had no release notes, so ASC returned "appStoreVersions … is not
   in valid state." Fix: the lane now **requires** a `whats_new` input (fails loud if
   empty) and sets it surgically via `release_notes: { "default" => ... }` (no metadata
   dir, so the approved listing is untouched), and `deploy-prod-auto` generates + asks for
   the What's New line at its Step 4 gate. The build itself uploaded fine both times — only
   the submit step needed the note.

Also shipped in the same deploy: Astro site, Vue PWA, and Android production (all 0.9.11).
The iOS build (0.9.12, build 30) uploaded to App Store Connect; the very first submit was
completed manually in the console while the lane fix landed for next time.

### Planning brief (verbatim args passed to /beanies-plan)

> Feature: Add an App Store submission capability to the iOS release lane, mirroring how the Android lane ships to a Play track ... [full brief with proposed design, known gotchas — export compliance/API-key role/no-auto-retry/observability/backward-compat — and the deliverable: a plan covering the workflow input, fastlane lane, Info.plist export-compliance, deploy-skill + guide updates, tests, edge cases, and the 0.9.11 submission sequence].

</details>
