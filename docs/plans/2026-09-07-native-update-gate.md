# Plan: Ask people to update the app, and require it when their family file needs it

> Date: 2026-09-07
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-07-native-update-gate.md`
> Follows: `docs/plans/2026-09-06-compacted-pod-v5.md`, whose Caveats deferred this ("Force-update on native is a follow-up, not this plan")
> Platform research verified 2026-09-07; URLs in Assumptions

> **No GitHub issue created.** This plan was approved for direct implementation.

> **No mockup.** Both surfaces reuse existing components rather than inventing UI: the prompt is `confirm()` (`src/composables/useConfirm.ts`), the block is the existing fatal overlay (`useFatalErrorStore.setFatal`, rendered by `App.vue`). Nothing new is designed, so there is nothing to mock up.

## User Story

As someone using beanies on a phone or tablet, I want the app to tell me when a newer version is available, and to insist when my family's file genuinely needs it, so that I am never quietly cut off from my own family's data without knowing why or what to do about it.

## Context

Compacted family files are written as beanpod 5.0 (ADR-036 addendum). A build that predates that format refuses the file at parse and stops syncing. On the web that heals itself: `usePwaUpdater` polls the service worker every five minutes and applies the new build on the next quiet navigation. On iOS and Android it does not, because `usePwaUpdater` returns early on `Capacitor.isNativePlatform()` and no service worker is registered natively (ADR-029). A native device therefore stays on whatever build the store last installed, and beanies has no way to ask it to move.

Today that is survivable rather than dangerous: the 5.0 format means a stale device cannot merge across lineages, so it cannot corrupt the family. It is only cut off, and it says so through `podNewerVersion.inline` and its three sibling registers. But "only cut off" is still a person who cannot see their family's calendar, whose only current remedy is that somebody tells them.

**This plan is honest about what it does not do: it does not help anyone who is stale today.** They are on 0.16, which contains none of this code. This is insurance for the _next_ format change and for the ordinary case of a device drifting behind. Anyone stale right now still has to be told by their family, exactly as the compaction notice says.

Two questions have to be answered separately, because they have different sources and very different consequences:

1. **Is there a newer version?** The store knows, and `getAppUpdateInfo()` answers it on both platforms. This drives a PROMPT.
2. **Is this version too old to keep working?** No store can answer that; it is a fact about our data format. This drives a FORCE, and greg's instruction is that force is reserved for exactly this.

## Requirements

### R1. One composable owns the question, and it is native-only

1. `src/composables/useAppUpdate.ts` is the single place that asks about updates. It exposes `{ updateAvailable, mustUpdate, checkForUpdate(), promptUpdate(), requireUpdate(reason), openStore() }`.
2. It is inert on web (`Capacitor.isNativePlatform()` false), mirroring `usePwaUpdater`'s early return in the other direction, so exactly one updater is live per platform and neither has to know about the other. State this in the file header, with a pointer each way.
3. Singleton with a detached `effectScope`, the shape `usePwaUpdater` (`:96-120`) and `useStaleTabRefresh` already use, and for the same reason.

### R2. The prompt: the store's own answer, shown gently

1. Add `@capawesome/capacitor-app-update` (8.x, which requires Capacitor >= 8; we are on 8.5.0). `getAppUpdateInfo()` on launch and on resume.
2. Android: `startFlexibleUpdate()`, the background download that leaves the app usable, then `completeFlexibleUpdate()` at a quiet moment. iOS: `openAppStore()` from a dismissible `confirm()`, because in-app updates are a Play feature and iOS has no equivalent.
3. Reuse `confirm()` for the sheet: `variant: 'info'`, `showCancel: true`, a `confirmLabel` of "Update" and a `cancelLabel` of "Not now". Do not build a new modal.
4. Dismissible, and it stays dismissed for the session. A nag on every launch teaches people to dismiss without reading, which is exactly the reflex the FORCE case needs them not to have.
5. Never shown when offline, mid-save, or with an overlay open. Reuse `usePwaUpdater`'s definition of quiet (`hasOpenOverlays()` + `!useSyncStore().isSyncing`) rather than writing a second one; if that predicate is not already exported, extract it so there is one.

### R3. The force: the app's own answer, from the failure that actually happened

1. The authoritative trigger is `UnsupportedBeanpodVersionError`, which already answers `needsAppUpdate` and already reaches every surface through `payloadErrorKind`. When it fires on native, the app genuinely cannot do its job for this family, and the update stops being a suggestion.
2. The block reuses the existing fatal overlay (`useFatalErrorStore.setFatal(message, detail, { clearDataHelps: false })`), which `App.vue` already renders full-screen. `clearDataHelps: false` is mandatory: clearing data is exactly the wrong advice here and would destroy the local copy.
3. Android: `performImmediateUpdate()`, Play's fullscreen flow. iOS: the overlay with a single "Update beanies" action calling `openAppStore()`.
4. Never a dead end: if the store cannot be opened, say so and show the store URL as selectable text. The overlay's `detail` slot already carries diagnostic text; put the version and family id there so a support conversation has something to work from.
5. Native only. On web the service worker has already handled it, and blocking a browser tab that can update itself would be gratuitous.

### R4. The pre-emptive floor: a file we control

1. `web/public/min-app-version.json`, served at `https://beanies.family/min-app-version.json`, shape `{ "minSupportedVersion": "0.16", "reason": "…" }`.
2. Fetched once on launch with a short timeout, cached in memory, and **failing open**: no network, a timeout, a non-200, a malformed body, or any error at all means no nag and no block. A version gate that fails closed can lock a family out of their own data over a CDN blip, which is worse than the thing it prevents.
3. Compared against `APP_VERSION`, not the store version. `derive-store-version.mjs` strips the `R<n>` suffix, so `0.15R2` and `0.15` are the same string to the stores and must not be the same to this check.
4. A real comparison, not a string compare: `0.9` is older than `0.16`, and `0.15R2` is newer than `0.15`. Its own pure function with its own tests, in `src/utils/` beside the other pure helpers.
5. Raising the floor is a deliberate act: `deploy-web.yml` is `workflow_dispatch` only, so pushing the file does not publish it. Say so in the plan, in the file's own comment, and in a runbook step.

### R5. Copy, in the registers that already exist

Reuse rather than invent. The four "saved by a newer version" strings and the Help article already say the right thing; the update surfaces agree with them word for word where they overlap. New keys only for the prompt sheet, the block and their buttons, each with `en` and `beanie`; on this surface the `beanie` values stay plain English, matching the compaction decision (greg, 2026-09-06: "do not use bean euphemisms").

### R6. Observability

An `app-update` surface: the check ran and what it found, the prompt shown, the prompt dismissed, an update started and completed, the block shown, and the store failing to open. Enough to answer "how fast does the fleet actually drain" and "is anyone stuck behind a broken store link", which is the operational question the 5.0 work left open.

## Important Notes & Caveats

- **This does nothing for the currently-stale population.** Say it in the plan, the code header and STATUS. Implying otherwise would repeat the exact defect the last review round caught in the compaction copy.
- **iOS has no in-app update.** Quoted from the plugin's own docs: "in-app updates are a feature of the Google Play Store and are therefore only available on Android." The iOS path is `getAppUpdateInfo()` then `openAppStore()`, and the plan must not imply otherwise.
- **`inAppUpdatePriority` is set at rollout, through the Play Developer API, and cannot be changed afterwards.** It is also unsupported for internal app sharing. If we ever want priority-driven behaviour it has to be decided at release time, which is a runbook change, not a code change.
- **Testing in-app updates needs internal app sharing**, the same application id and signing key, a higher `versionCode`, and an account that has installed the app from Play before. It cannot be exercised in CI or in a simulator.
- **Do not block on the floor check.** R4.2's fail-open is not a nicety; it is the difference between a bad deploy being an inconvenience and being a lockout.
- **Do not add a second updater on web.** `usePwaUpdater` owns that platform completely.
- **Do not deploy** as part of this work.

## Assumptions

> **Review these before implementation.**

1. `@capawesome/capacitor-app-update` 8.x supports Capacitor 8 ("Active support" in its compatibility table) and exposes `getAppUpdateInfo()` and `openAppStore()` on both platforms, with `performImmediateUpdate`, `startFlexibleUpdate`, `completeFlexibleUpdate` and the state listener on Android only. Verified 2026-09-07: https://capawesome.io/docs/sdks/capacitor/app-update/
2. Play in-app updates: flexible downloads in the background and can be deferred; immediate is a fullscreen flow the user must complete to continue. `inAppUpdatePriority` is 0-5, set via `Edits.tracks.releases` in the Play Developer API at rollout only, and unsupported for internal app sharing. Verified 2026-09-07: https://developer.android.com/guide/playcore/in-app-updates and .../in-app-updates/test
3. `web/public/**` is published to the marketing origin by `aws s3 sync web/dist/ --delete` (`deploy-web.yml:71`), so a file added there is served at `https://beanies.family/<name>`. That workflow is `workflow_dispatch` only.
4. `APP_VERSION` (`src/constants/appVersion.ts`) is the product version and may carry an `R<n>` suffix; `scripts/derive-store-version.mjs` strips it for the stores. The floor compares product versions.
5. `Capacitor.isNativePlatform()` is the platform test used everywhere else, and `usePwaUpdater` already returns early on it.
6. The fatal overlay (`useFatalErrorStore` + `App.vue`) can carry an action; if it cannot today, R3.3 needs it to, and that is a small addition to an existing component rather than a new one.

## Approach

The shape is: one composable, two triggers, two existing surfaces, one new pure comparison function, one static file.

1. **The pure parts first**, because they are the testable core: a version comparison in `src/utils/`, and the floor fetch-and-parse with its fail-open contract. Both pure, both unit-tested, neither knowing about Capacitor.
2. **The composable**, which wires the plugin to those parts and to the two existing surfaces. Native-only, singleton, inert on web.
3. **The force trigger**, hooked where `needsAppUpdate` is already answered so no new classification is invented.
4. **The plugin and native config**, last, because it is the only part that cannot be exercised locally.

DRY: the prompt is `confirm()`, the block is `setFatal`, the store link is `openExternal`, the "quiet" predicate is `usePwaUpdater`'s (extracted if needed), the "is this because the app is old" question is `PayloadLoadError.needsAppUpdate`, and the copy leans on the four existing `newerVersion` registers. The only genuinely new code is the version comparison, the floor fetch, and the composable that joins them.

Error handling: every failure in this feature is non-critical by construction. The plugin can be absent or throw, the network can fail, the store can refuse to open. Each is caught, logged at `warning`, and degrades to doing nothing — except the store-open failure inside the block, which must surface the URL as text so the person is not stranded.

## Files Affected

- `src/composables/useAppUpdate.ts` (new)
- `src/utils/compareAppVersions.ts` (new) and its test
- `src/services/appUpdate/minVersion.ts` (new: fetch, parse, fail open) and its test
- `web/public/min-app-version.json` (new)
- `package.json`, `android/`, `ios/` (plugin install and sync)
- `src/composables/usePwaUpdater.ts` (export the quiet predicate if it is not already shared)
- The `needsAppUpdate` dispatch site for the force trigger
- `src/stores/fatalErrorStore.ts` / the overlay component, if an action slot is needed
- `src/services/translation/uiStrings.ts`, `public/translations/zh.json`
- `docs/runbooks/` (raising the floor), `docs/STATUS.md`, `CHANGELOG.md`

## Help Center Coverage

- **Action**: update existing
- **Category**: how-it-works
- **Slug**: `family-file-newer-version` (added 2026-09-06)
- **Title**: unchanged
- **Scope**: the article already tells someone on an old version what the message means and that updating is the fix. Add a short paragraph saying beanies will now offer to update the app itself on iPhone and Android, and that it will insist only when the family file cannot be opened without it.
- **Notes**: must not imply the app can update itself on iOS; it opens the App Store. Must not suggest clearing data.

## Observability Coverage

- **Events**, all on surface `app-update`:
  - `checked` (info): `action: 'checked'`, `detail: available=<bool>,platform=<ios|android>`. The denominator for everything else.
  - `prompted` / `prompt-dismissed` / `update-started` / `update-completed` (info): the funnel, so "how fast does the fleet drain" is answerable.
  - `blocked` (warn): `action: 'blocked'`, `error_code: 'needs-update'`. A person who cannot use the app until they update is worth counting, and `warn` reaches CloudWatch without paging.
  - `store-open-failed` (warn) and `check-failed` (warn): the two ways this feature degrades. `check-failed` carries the reason class in `detail`, never the raw error text.
- **Failure modes covered**: the plugin missing or throwing (`check-failed`); the floor file unreachable or malformed (`check-failed`, and the fail-open means no user impact); the store refusing to open (`store-open-failed`, and the URL is shown as text); a person stuck behind the block (`blocked`, countable per `family_id`).
- **Success-path signal**: `checked` fires whether or not an update exists, so the rate is measurable rather than only the failures.
- **Critical vs telemetry**: nothing here pages. Not being on the newest app version is not an incident, and a `critical` on it would train the alert to be ignored.
- **Privacy / store gate**: no new context key. `action`, `error_code`, `detail`, `family_id` and `build_sha` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts`), so no `native-store-submission.md` update is required, and none may be made.

## Acceptance Criteria

- [ ] On web, nothing changes: `useAppUpdate` is inert and `usePwaUpdater` is the only updater.
- [ ] On native, a newer store version produces one dismissible prompt per session, never while offline, mid-save, or with an overlay open.
- [ ] Android takes the flexible flow; iOS opens the App Store. Neither claims the other's behaviour in copy.
- [ ] `UnsupportedBeanpodVersionError` on native raises the block, with `clearDataHelps: false` and a working store action.
- [ ] The block is never a dead end: with the store unopenable, the URL is on screen as text.
- [ ] The floor fails open on every error class (offline, timeout, 404, malformed JSON, wrong shape), asserted for each.
- [ ] The version comparison orders `0.9 < 0.16 < 0.16.1 < 0.17` and `0.15 < 0.15R1 < 0.15R2`, with tests.
- [ ] The floor compares product versions, so `0.15R2` is not treated as `0.15`.
- [ ] Every new string has `en` and `beanie`, `beanie` in plain English, and `npm run translate` is clean.
- [ ] Help Center article updated per the section above.
- [ ] Diagnostic logging implemented and verified; no new context key.
- [ ] Full gate green; every new test mutation-checked against the regression it pins.

## Testing Plan

1. Unit: the version comparison across the orderings above plus malformed input; the floor's fail-open for each error class; the composable's inertness on web.
2. Component: the prompt appears once per session and not at all when not quiet; the block renders with no dismiss and with the store URL when the open fails.
3. Manual, native, and the part CI cannot fake: an Android build installed through internal app sharing with a higher `versionCode` available, exercising both the flexible prompt and the immediate flow; an iOS build confirming the sheet opens the App Store listing.
4. Manual, the force path: hand-edit a family file to a version this build does not know, open it on a native build, and confirm the block appears, is not dismissible, and offers a working store link.
5. Deliberately break the floor file (404 it, malform it) and confirm the app is completely unaffected.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from greg's two decisions and the verified platform research; both UI surfaces mapped onto existing components so no new UI is designed.
- **Pass 2 (DRY + error handling)**: _pending_
- **Pass 3 (Sustainability)**: _pending_
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt

> one last thing before we move onto the code review - we forgot to add it to the plan, but we need to add the code / packages so that we can force and/or prompt both android and ios users to update the app when needed. i believe previously it was mentioned that this is a capcitor package we need to add, and on ios also some code to check if the user is on the latest version. wherever possible, we should ask the user to install the latest version of the app. can we add that directly, or should we run it through another set of plans?

### Follow-up 1 (answering the two questions raised before planning)

> Regarding your questions above:
>
> 1. Let's start with a prompt and force when needed as per your recommendations. agree that a force update should be used to ensure apps can read the new v5 beanpod
> 2. agree

### Context from the same session

> go ahead to run the code review against all code implemented in this session [...] once the code reviews and fixes are complete, run /beanies-plan as per the instructions above to build the plan for implementation of the force update for both android and ios apps. [...] once the plan is complete, proceed to implement as per the plan.

</details>
