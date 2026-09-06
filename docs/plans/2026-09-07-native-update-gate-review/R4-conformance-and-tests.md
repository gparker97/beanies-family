# R4 — Plan conformance, test quality, DRY

> Reviewer dimension: acceptance-criteria conformance, `Files Affected`, test quality, `Testing Plan` coverage, DRY.
> Target: commit `af38fe75` "feat(native): ask people to update, and give the block a way out".
> Plan: `docs/plans/2026-09-07-native-update-gate.md` (Phase A only).
> Verified against a clean checkout of `af38fe75`, plus the working tree at review time.

**Gate re-run at review time (against `af38fe75`):** `npm run type-check` clean; `npm run lint` 0 errors (769 pre-existing warnings) and stylelint clean; `npm run format:check` clean for every file in the commit; `npx vitest run` **6683 passed / 2 skipped / 18 todo, 559 files**; `npm run build` succeeded in 45s. So the "full gate green" criterion holds for the commit as landed.

**⚠️ Concurrent edits.** A parallel `code-review` agent was applying fixes to the same files while this review ran. Several findings below were fixed in the working tree after I recorded them; each is marked `[FIXED IN WORKING TREE, UNCOMMITTED]`. Nothing below has been committed.

**Still open after those fixes** — the only items needing action from this dimension:

1. **Finding 4 (MEDIUM)** — `appUpdate.prompt.notNow` translates into Chinese as "Buy Now". Untouched, and it ships on an update prompt.
2. **Finding 5 (LOW–MEDIUM)** — Testing Plan #3's direct `isAppQuiet()` case was never written; the `catch` branch the "verbatim move" rule exists to protect has no assertion.
3. **Finding 8 (LOW)** — the `fatalErrorStore` "never holds an action without a message" case is largely vacuous.
4. **Finding 10 (LOW)** — the `check-failed` `logEvent` shape is hand-copied between `versionPolicy.ts` and `useAppUpdate.ts`.
5. **Files Affected** — `docs/STATUS.md` is now written but **uncommitted**, along with every fix above.
6. **Criteria 6, 13, 14** — the three on-device manual proofs remain owed, as `docs/STATUS.md` correctly records.

---

## Acceptance criteria walk

Every Phase A criterion from the plan's `## Acceptance Criteria`, in plan order. Line numbers are from `af38fe75` unless marked otherwise.

| #   | Criterion (abridged)                                                                                                                                                              | Verdict            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No new runtime dependency; `package.json` unchanged; works on both platforms                                                                                                      | **MET**            | `package.json` absent from `git show --stat af38fe75`. Only pre-existing deps used: `@capacitor/app` (`useAppUpdate.ts:26`), `@capacitor/core` (`versionPolicy.ts:27`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2   | On web nothing changes: `useAppUpdate` inert, `usePwaUpdater` sole updater, overlay byte-identical                                                                                | **MET**            | `useAppUpdate.ts:158` `if (isNative() && !initialized)`. `usePwaUpdater.ts:105` still returns early on native. Overlay markup is a verbatim move (`FatalErrorOverlay.vue:74-190`), with the anchor and caption both `v-if`'d off; every class string matches the deleted `App.vue` block character for character. Pinned by `useAppUpdate.test.ts:76-83` and `payloadFailureSurface.test.ts` `attaches NO action on web, for %s` over all five kinds.                                                                                                                                                                                                                                                |
| 3   | Every existing confirm dialog unchanged with `confirmHref` unset                                                                                                                  | **MET**            | Swept all 44 `confirm({` call sites in `src/` (`grep -rn "confirm({" src/`); **none** passes `confirmHref` — `useAppUpdate.ts:129-136` is the only one. `ConfirmModal.vue:91-98` keeps the static `class` and `:class` bindings and `@click="handleConfirm"` untouched; only `:is`/`:type`/`:href`/`:target`/`:rel` are new. Pinned by `ConfirmModal.test.ts:52-61` and `:81-89` (class equality both ways).                                                                                                                                                                                                                                                                                         |
| 4   | `isAppQuiet()` a verbatim move; `usePwaUpdater` has no local copy; its tests pass untouched                                                                                       | **MET**            | `appQuiet.ts:15-23` body is character-identical to the deleted `usePwaUpdater.ts:45-52`, comment included. `grep -n isQuiet src/composables/usePwaUpdater.ts` → nothing. `usePwaUpdater.test.ts` is **not** in the commit's file list and passes (its module-level `@/stores/syncStore` + `@/utils/overlayStack` mocks at `:28-38` still intercept the moved import).                                                                                                                                                                                                                                                                                                                                |
| 5   | One dismissible prompt per session; never offline, mid-save, overlay open, or before `isLoaded()`                                                                                 | **NOT MET**        | The _suppression_ half is met: gates at `useAppUpdate.ts:94-106`, session flag at `:117`, tested independently for offline / not-quiet / not-loaded (`useAppUpdate.test.ts:145-152`) and once-per-session (`:120-126`). The _"gets a prompt"_ half is not: in `af38fe75` the only triggers are the launch check and `resume`, and the launch check resolves long before `isLoaded()` is true, so on a launch nobody backgrounds the prompt never fires. See Finding 0. Sub-gap: "overlay open" is not tested independently — the test mocks `@/utils/appQuiet` wholesale, so `hasOpenOverlays()` never runs; it is covered transitively by `usePwaUpdater.test.ts`.                                  |
| 6   | Confirming opens the correct store listing as a real anchor. **Confirmed on a device, both platforms.**                                                                           | **NOT MET (owed)** | The anchor mechanism is implemented and unit-pinned (`ConfirmModal.test.ts:63-79`, `useAppUpdate.test.ts:96-118`), but the device confirmation is manual and there is no evidence of it anywhere in the commit. `docs/STATUS.md` (working tree) correctly lists it as OWED.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7   | Block through `surfacePayloadFatal`, `clearDataHelps: false`, working link; no second `needsAppUpdate` reader; `payloadErrorKind` called once                                     | **MET**            | `payloadFailureSurface.ts:171` hoists `const kind`, read at `:175` and `:186`; the classification is `kind === 'needs-update'`, not a second `needsAppUpdate` read. `clearDataHelps: false` at `:203`. Nuance: `payloadErrorKind` is still called a second time inside `reportPayloadFailure` (`:111`), which `surfacePayloadFatal` calls first — but that is pre-existing and outside the hoist R3.2 asked for.                                                                                                                                                                                                                                                                                     |
| 8   | Never a dead end: the URL is on screen as selectable text **unconditionally**, outside `<details>`                                                                                | **PARTIAL**        | Caption at `FatalErrorOverlay.vue:133-138`, outside the `<details>` at `:161`. But `v-if="action && actionHref"` and it renders `{{ actionHref }}`, so when `safeExternalHref` screens the URL away **both the link and the caption disappear** — the opposite of the plan's error-table row 5 ("render no link when it fails, **leaving the caption**") and of Testing Plan #7. See Finding 3. `[FIXED IN WORKING TREE, UNCOMMITTED]`                                                                                                                                                                                                                                                               |
| 9   | `action` is data inside `opts`, assigned on every call, cleared by `clear()`; existing callers unchanged; `payloadFailureSurface.ts` imports **no composable and no plugin**      | **PARTIAL**        | Data half fully **MET**: `fatalErrorStore.ts:65-68` `action.value = opts?.action ?? null`, `clear()` at `:83`, signature still three positional params, `payloadFailureSurface.test.ts`'s four existing cases unedited and green. Import half **NOT MET**: `payloadFailureSurface.ts:29` imports `storeUrlFor` from `@/composables/useAppUpdate` — a composable, and through it `@capacitor/app`. See Finding 2. `[FIXED IN WORKING TREE, UNCOMMITTED]`                                                                                                                                                                                                                                              |
| 10  | `App.vue` reads the action as a computed, gains no mirror-tuple entry; a test asserts an action can never be rendered without a message                                           | **PARTIAL**        | Computed at `App.vue:226-227`; the mirror tuple at `:224` still holds exactly three entries. The test half is weak: `fatalErrorStore.test.ts:50-63` guards with `if (store.action !== null)`, so two of its three steps assert nothing, and it never exercises `setGenericInitError`, the second `initError` writer the plan's invariant argument rests on. See Finding 8.                                                                                                                                                                                                                                                                                                                           |
| 11  | Both new pieces of chrome authored light **and** dark                                                                                                                             | **MET**            | Anchor `FatalErrorOverlay.vue:118-123`: solid `bg-[#F15D22]` + `text-white`, identical to the existing Reload button, correct in both modes. Caption `:135`: `dark:text-ink-soft ... text-gray-500` — explicit dark partner, semantic ink token, no opacity modifier, no raw dark grey ramp. The secondary-Reload swap at `:110-114` reuses the Clear-data class string verbatim.                                                                                                                                                                                                                                                                                                                    |
| 12  | `payloadErrorDetail` carries `appVersion`; the diagnostic shows running **and** file version                                                                                      | **MET**            | `types/sync.ts:523` adds `appVersion: APP_VERSION`; `:525` `message: err.message`, which for `UnsupportedBeanpodVersionError` is `Unsupported beanpod version: <fileVersion>` (`:402`, clamped at `:401`). Import cost is one string constant (`types/sync.ts:13-17`); `@/constants/appVersion` imports nothing, so the three worker modules gain no dependency.                                                                                                                                                                                                                                                                                                                                     |
| 13  | The floor is **proven to LOAD on a real device**                                                                                                                                  | **NOT MET (owed)** | Manual. No evidence. Correctly listed as OWED in the working-tree `docs/STATUS.md`. This is the criterion the plan itself called the hardest to fake, and it stays open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 14  | No code path from the floor to a block; asserted with `promptBelowVersion` set arbitrarily high                                                                                   | **PARTIAL**        | Structurally true: `versionPolicy.ts` has no `setFatal` and no store import; `useAppUpdate.ts`'s only user-facing effect is `confirm()` at `:129`. Unit-adjacent evidence at `useAppUpdate.test.ts:96-118` (floor `0.17` → one dismissible sheet, nothing else). The **stated assertion** (set the floor absurdly high on a device, confirm the app still opens) is manual and not evidenced.                                                                                                                                                                                                                                                                                                        |
| 15  | Fails open on every error class, each with its own `check-failed` class                                                                                                           | **MET**            | `versionPolicy.test.ts:65-78` covers `http-404`, non-JSON `malformed`, wrong-shape `malformed`, `unparseable-version`; `:80-88` covers `offline` and `timeout`; `:90-93` a non-`Error` throw. All resolve `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 16  | Hour-bucket param, memoised for the process, `query_string = false` caveat in the comment                                                                                         | **MET**            | `versionPolicy.ts:83` `params: { h: ... }`; memo at `:45` + `:70`; the CloudFront trap is spelled out at `:75-79` ("THIS DOES NOT BUST THE EDGE"). Pinned by `versionPolicy.test.ts:49-63`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 17  | Orderings, `null` on garbage, `-1 \| 0 \| 1 \| null`, shared regex                                                                                                                | **MET**            | `compareAppVersions.ts:26` one `VERSION_RE`, used by `isComparableVersion` (`:30`) and `compareAppVersions` (`:50-51`); signature `: -1 \| 0 \| 1 \| null` at `:48`. `compareAppVersions.test.ts:14-24` pins `0.9 < 0.16 < 0.16.1 < 0.17`; `:27-32` pins `0.15 < 0.15R1 < 0.15R2`; `:44-51` pins `null`-not-throw over eight typos; `:53-58` pins the two exports agreeing on one regex.                                                                                                                                                                                                                                                                                                             |
| 18  | The floor compares **product** versions, so `0.15R2` ≠ `0.15`                                                                                                                     | **MET**            | `useAppUpdate.ts:71` compares `APP_VERSION` (`constants/appVersion.ts:39`), not the derived store version; the `R<n>` field is captured (`compareAppVersions.ts:26`, group 4) and ordered (`:56-59`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 19  | `capacitor.config.ts` unchanged; no global `CapacitorHttp` patch; `@capacitor/browser` not used                                                                                   | **MET**            | `capacitor.config.ts` absent from the commit. `grep -rn "@capacitor/browser" src/services/appUpdate src/composables/useAppUpdate.ts` → nothing. `versionPolicy.ts:23-25` records the "do not enable the patch" decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 20  | `eslint` fails on `fetch` in `src/services/appUpdate/**`; message states its limit                                                                                                | **MET**            | Verified live, not read: `printf '...fetch(...)' \| npx eslint --stdin --stdin-filename src/services/appUpdate/probe.ts` → `error ... no-restricted-globals`, message ends "Known limit of this rule: it catches a bare \`fetch\` only, not \`window.fetch\` or \`globalThis.fetch\`". Zone at `eslint.config.js:451-476`. No later config block redefines `no-restricted-globals` (only one hit in the file).                                                                                                                                                                                                                                                                                       |
| 21  | No NEW `Capacitor.isNativePlatform()` call site                                                                                                                                   | **MET**            | Still exactly six outside `capabilities.ts` (`useShareTargets.ts:49`, `usePwaUpdater.ts:105`, `iosShareAdapter.ts:33`, `androidShareAdapter.ts:17`, `pwaShareAdapter.ts:37`, `iosOpenInAdapter.ts:67`) — the same six the plan enumerated. New code uses `isNative()` / `getPlatform()` throughout.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 22  | Each store URL exactly once as live code; three Astro pages import it; only release-note prose keeps a literal; a fourth platform fails the build; three stale comments corrected | **MET**            | Repo-wide grep for `6798513944` and `family.beanies.app` accounts for every hit — live code: `packages/brand/nav.ts:58-59` (only copy). Prose: `src/content/release-notes/deploys.ts:601` (allowed), two blog posts, `docs/STATUS.md`, the plan files. Stale committed build artefacts: `ios/App/App/public/assets/index-wm_mm2Vu.js:84086` and `android/.../index-wm_mm2Vu.js:84086` (bundled copies of the release-note prose; not source, not touched). Astro imports at `ios.astro:11-13`, `android.astro:10-12`, `download.astro:12-15`. `satisfies Record<'ios' \| 'android', string>` at `nav.ts:60`. All three comments corrected: `ios.astro:10-11`, `android.astro:10-11`, `nav.ts:35-36`. |
| 23  | Runbook § 7 exists, says prompt-only, says a normal release does not raise it, pointed at from `appVersion.ts` and `_docs`; §1 table untouched                                    | **MET**            | `docs/runbooks/native-store-submission.md:526` `## 7. Raising the update floor`; prompt-only at `:550-557`; "A normal release does NOT raise the floor" at `:559`; `## 8. Notes` at `:588` (renumbered). Pointers: `constants/appVersion.ts:34-38` and `web/public/min-app-version.json:4`. The `_docs` anchor `#7-raising-the-update-floor` matches the heading. §1 (`:19`) untouched by the diff.                                                                                                                                                                                                                                                                                                  |
| 24  | Every string has `en` + `beanie`, `beanie` lowercase, `npm run translate` clean; `reason` never rendered; no copy implies in-app iOS update                                       | **PARTIAL**        | Five keys at `uiStrings.ts:4387-4415`, each with both registers, `beanie` the same words all lowercase. `grep -rn "\.reason" src/services/appUpdate` → nothing; `FloorFile` (`versionPolicy.ts:36-38`) declares only `promptBelowVersion`. Copy is platform-neutral (`:4396`). `zh.json` regenerated (`translationCount` 4554→4559). **But** the generated `appUpdate.prompt.notNow` is 「立即购买」 = "Buy Now" — see Finding 4.                                                                                                                                                                                                                                                                    |
| 25  | Help article updated, `updatedDate` bumped                                                                                                                                        | **MET**            | `src/content/help/how-it-works.ts:12` `2026-09-06` → `2026-09-07`; new paragraph at `:41-46` that says it opens the App Store / Google Play (does not imply in-app iOS update), does not suggest clearing data, and leaves the existing "What to do" steps intact.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 26  | Logging implemented and verified; no new context key; platform in `os`; no bare `catch {}`                                                                                        | **MET**            | Events on surface `app-update`: `checked` (`useAppUpdate.ts:81-90`), `prompted` (`:118-123`), `prompt-dismissed` (`:139-144`), `blocked` (`payloadFailureSurface.ts:188-193`), `check-failed` (`versionPolicy.ts:52-60`). Keys used are `action`, `error_code`, `detail`, `os` — all already in `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:68, 69, 185, 100`); no allowlist edit, so no store-submission table change was needed or made. No bare `catch {}`: `versionPolicy.ts:106` has a body; `appQuiet.ts:20` keeps its moved comment; `useAppUpdate.ts:170` `.catch(() => undefined)` is the shape R1.4 specified and `iosShareAdapter.ts:104` already uses.                                 |
| 27  | Prompt archive entry exists                                                                                                                                                       | **MET**            | `docs/prompts/2026-09/2026-09-07-native-update-gate.md`, correct frontmatter (`date`, `category`, `issue`, `plan`, `tags`), three verbatim prompts, and an `## Outcome` section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 28  | Full gate green; every new test mutation-checked against the regression it pins                                                                                                   | **PARTIAL**        | Gate re-run and green (header above). Mutation-checking is a process claim I cannot verify from the artefact; by inspection most tests do fail on the obvious mutation, but three do not pin what they claim — Findings 3, 8 and 9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### The `## Files Affected` audit

Everything the plan named is present **except one**:

- **`docs/STATUS.md` — named in `Files Affected`, absent from `af38fe75`.** Also the plan's first Caveat ("say it in the plan, the code header **and STATUS**"). `[FIXED IN WORKING TREE, UNCOMMITTED]` — a thorough entry now exists, correctly marked `NOT DEPLOYED` and listing the owed manual work.

Everything on the **"Not touched, deliberately"** list is honoured, verified individually:

| Forbidden file                         | Status                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `capacitor.config.ts`                  | untouched                                                                                                      |
| `package.json`                         | untouched                                                                                                      |
| `android/`, `ios/`                     | untouched                                                                                                      |
| `src/utils/openExternal.ts`            | untouched, and genuinely unused by the feature (`grep openExternal src/composables/useAppUpdate.ts` → nothing) |
| `src/content/release-notes/deploys.ts` | untouched; its `:601` literal is the one live literal the plan allowed                                         |
| the six `Capacitor.isNativePlatform()` | untouched (criterion 21)                                                                                       |
| §1 data-collection table               | untouched                                                                                                      |

**Extra files not in `Files Affected`.** Four test files (`ConfirmModal.test.ts`, `fatalErrorStore.test.ts`, `FatalErrorOverlay.test.ts`, plus the extension of `payloadFailureSurface.test.ts`) — all required by the `Testing Plan`, so an omission in the plan's own list rather than scope creep. And `src/components/common/FatalErrorOverlay.vue`, judged below.

### The `FatalErrorOverlay.vue` extraction — deviation judged SOUND

R3.3 ends "**No new component.** Two small additions to two existing files, plus two lines in the template." The implementation extracted a 186-line component instead.

**The plan contradicts itself here, and the implementation resolved the contradiction the right way.** Testing Plan #7 demands a _"Component, the overlay"_ test that renders the anchor, checks `target`/`rel`, and asserts the caption sits **outside** the `<details>` block. That is unsatisfiable while the markup lives inside `App.vue`: `App.vue` pulls the router, ~30 stores and the whole init sequence into any mount, and the repo has an explicit lesson against the alternative (asserting on source text). So R3.3's "no new component" and Testing Plan #7 could not both be honoured; the implementation chose the one that produces a testable failure surface.

**Done safely, on the evidence:**

- The markup is a genuine verbatim move. I diffed the deleted `App.vue` block against `FatalErrorOverlay.vue:74-190`: every class string, every `dark:` partner, the SVG path, the `<details>` structure and the element order are character-identical. Only the bindings changed (`initError` → `message` etc.) and two `@click` handlers became emits.
- `showClearConfirm` moved from `App.vue` to the component and kept its reset (`FatalErrorOverlay.vue:47-58`), now owned by the thing that holds the flag.
- 11 mounted assertions now cover a screen that previously had none (`FatalErrorOverlay.test.ts`).
- `App.vue` net **−137/+? lines**, and its mirror tuple did not grow.

**One implementation defect came in with it** — the eager `getDeviceDiagnostics()` call, Finding 1. That is the extraction done imperfectly, not the extraction being wrong.

### `## Testing Plan` items 1–9: implemented vs. gaps

| #     | Item                                                                                                      | Status                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Unit, pure (`compareAppVersions`)                                                                         | **Implemented, complete.** Orderings, `null`-not-throw, and the two exports agreeing on one regex.                                                                                                                                                                     |
| 2     | Unit, the floor (`versionPolicy`)                                                                         | **Implemented, complete.** The already-parsed-body case is present and is the first test in the file (`:38-42`) — the single most valuable case in this commit.                                                                                                        |
| 3     | Unit, quiet — "**plus one direct case**: `isAppQuiet()` returns `false` when the sync store is not ready" | **GAP.** No `src/utils/__tests__/appQuiet.test.ts` exists. The `try/catch` at `appQuiet.ts:19-22` — the thing the "verbatim move" requirement exists to protect — has no direct assertion anywhere. See Finding 5.                                                     |
| 4     | Unit, composable (`useAppUpdate`)                                                                         | **Implemented, one sub-gap.** Three of the four named gates are pinned independently; "overlay open" is not, because the test mocks `isAppQuiet` wholesale.                                                                                                            |
| 5     | Unit, block (`payloadFailureSurface`)                                                                     | **Implemented, complete.** Native attach (iOS + Android), no action on web across all five kinds, no action on native for the four non-`needs-update` kinds, existing four cases unedited and green.                                                                   |
| 6     | Unit, store invariant (`fatalErrorStore`)                                                                 | **Implemented, one weak case.** The stale-link regression is pinned directly and well (`:34-40`). "An action cannot exist while `message` is null" is largely vacuous — Finding 8.                                                                                     |
| 7     | Component, the overlay                                                                                    | **Implemented, one case inverted.** All cases present except "a non-http(s) `url` renders **the caption** but no anchor": the code hides both and `FatalErrorOverlay.test.ts:86-92` asserts only the anchor's absence, so the test codifies the deviation — Finding 3. |
| 8     | Component, the sheet                                                                                      | **Implemented, complete.** Button case, anchor case, class equality, `javascript:` screening, cancel-still-resolves.                                                                                                                                                   |
| 9     | Structural (eslint)                                                                                       | **Implemented as designed** (the plan framed it as a manual verification, not an automated test). I re-verified it live via `eslint --stdin`; it fires with the documented message. Phase B half N/A.                                                                  |
| 10–13 | Manual (device floor load, store handoff, force path, Phase B)                                            | **All owed**, correctly recorded as owed in the working-tree `docs/STATUS.md`.                                                                                                                                                                                         |

---

## Findings

### 0. HIGH — the prompt would almost never fire: the launch check races the document load, and `resume` was the only other trigger

**`src/composables/useAppUpdate.ts:159-166`** (`af38fe75`):

```ts
void checkForUpdate().then(() => maybePrompt(isOnline.value));
const listener = App.addListener('resume', () => {
  void maybePrompt(isOnline.value);
});
```

`canPrompt` requires `isLoaded()` (`:104`). On a real launch the floor fetch resolves in a few hundred milliseconds, while `isLoaded()` does not become true until the family document has been decrypted, materialised and projected — seconds later. So the launch evaluation reliably finds the boot gate **closed**, and the only thing that re-evaluates it is `App.addListener('resume', ...)`, which fires only if the person backgrounds and returns to the app. A device that opens beanies, uses it and closes it is never asked, however far behind the floor it is.

This is criterion 5's first half ("a device below the floor **gets** one dismissible prompt per session") failing in the ordinary case, and it would have been invisible in production: `checked` still fires with `behind=true` once per launch, so the telemetry would show a fleet that is behind and a `prompted` rate near zero, which reads like people being interrupted rarely rather than never.

The existing tests could not catch it because `useAppUpdate.test.ts:170-180` opens the boot gate and then **calls `resume.handler!()` by hand** — the one trigger a real launch does not supply.

**Fix:** re-evaluate the gates reactively when the document arrives, not only on resume.

`[FOUND AND FIXED BY THE PARALLEL REVIEW, UNCOMMITTED]` — `useAppUpdate.ts:208` now carries `watch([docVersion, isOnline], () => void maybePrompt(isOnline.value))` (`docVersion` is the app's single reactivity source, `projection.ts:28`), and `useAppUpdate.test.ts` gained "asks WITHOUT a resume once the family document arrives", which deliberately keeps `docVersion` real rather than stubbing it. Recorded here because it is the most consequential conformance failure in the landed commit and it belongs in this dimension's record; I did not catch it.

---

### 1. HIGH — `getDeviceDiagnostics()` now runs on every `App.vue` render, not only when the overlay is up

**`src/App.vue:1875`** (`af38fe75`): `:diagnostics="getDeviceDiagnostics()"`.

Before the extraction this call sat inside `<div v-if="initError">`, so it ran only while the recovery screen was on screen. As a prop expression on an unconditionally-rendered child it now runs on **every re-render of the root component** — every route change, every toast, every sidebar toggle.

`getDeviceDiagnostics` is `formatDeviceInfo` (`App.vue:1591`), which calls `getDeviceInfo()` (`src/utils/diagnostics.ts:56-66`), which performs **two real Web Storage round-trips** — `setItem` + `getItem` + `removeItem` on both `localStorage` and `sessionStorage` (`storageWorks`, `:37-54`). Six synchronous storage operations per root render.

**Concrete consequence:** on a device where Web Storage throws — iOS Safari with blocked storage, quota exhaustion, certain privacy modes — `storageWorks` also emits `console.warn('[diagnostics] storage probe failed', e)` (`:50`) on **each** probe. That is two console warnings per App re-render, on exactly the population this probe was written for (its own header cites the 2026-06-20 iPhone-onboarding blocker). The probe is now noisy background work instead of a one-shot diagnostic.

**Fix:** bind a computed gated on the overlay being live —
`const fatalDiagnostics = computed(() => (initError.value ? getDeviceDiagnostics() : ''));` and pass `:diagnostics="fatalDiagnostics"`.

`[FIXED IN WORKING TREE, UNCOMMITTED]` — `App.vue:1605` now holds exactly that computed, bound at `:1889`.

---

### 2. MEDIUM — `payloadFailureSurface.ts` imports a composable, which is the criterion it was written to satisfy

**`src/utils/payloadFailureSurface.ts:29`** (`af38fe75`): `import { storeUrlFor } from '@/composables/useAppUpdate';`

Criterion 9 reads, verbatim: "`payloadFailureSurface.ts` imports no composable and no plugin." R3.3's whole argument for making the action a `url` instead of a callback was: "A callback would make the app's single payload chokepoint import the update composable, and through it a native plugin. A `url` makes it import one constant." The data-versus-callback half was honoured; the import half was then given away by putting the helper in the composable.

The comment at `:205-206` — "this file must not learn about the update composable, and through it a native plugin" — sat six lines below an import of exactly that composable.

**Measured blast radius** (BFS over the resolved import graph): `payloadFailureSurface.ts` reached **230** `src/` modules before this commit (via `translationStore` alone) and **239** after. Net new: `useAppUpdate`, `useConfirm`, `useOnline`, `versionPolicy`, `appQuiet`, `compareAppVersions`, `marketing`, `overlayStack` — eight small modules. `@capacitor/app` and `@capacitor/core` were **already** reachable, so no new native plugin actually entered the graph, and nothing new runs at import time (`useAppUpdate` module scope creates one `ref`; `versionPolicy` one `let`; `useOnline` defers listener registration to its first call). No cycle: BFS from `useAppUpdate` does not reach `payloadFailureSurface`. And no worker exposure: `payloadFailureSurface.ts` is imported only by `App.vue`, `ResumePodSetup.vue`, `LoadPodView.vue`, `useBiometricSignIn.ts`, `useLoginFlow.ts`, `LoginPage.vue`, `SettingsPage.vue` — all main thread.

So the runtime cost today is small. The **forward** cost is not: Phase B's `Files Affected` puts the Play adapter into `useAppUpdate.ts`, which is precisely the edge R3.3 forbade, and the guard against it was the criterion this broke.

**Fix:** a two-line module holding only `storeUrlFor`, imported by both.

`[FIXED IN WORKING TREE, UNCOMMITTED]` — `src/services/appUpdate/storeUrl.ts` now holds it (importing only `@beanies/brand/nav` and a `type`-only `getPlatform`), and `payloadFailureSurface.ts:29` points there.

---

### 3. MEDIUM — the block's URL caption disappears in the one case it exists for

**`src/components/common/FatalErrorOverlay.vue:133-138`** (`af38fe75`):

```
<p v-if="action && actionHref" class="dark:text-ink-soft mt-1 mb-4 text-xs break-all text-gray-500">
  {{ actionHref }}
</p>
```

The plan says the opposite twice. Error-table row 5: "Both surfaces screen it through `safeExternalHref` in a computed and render no link when it fails, **leaving the caption (block)** or a plain button (prompt)." Testing Plan #7: "a non-http(s) `url` renders **the caption** but no anchor." R3.3 also specified that the caption render `url` — the same value the button uses — so button and caption "cannot point at different places"; binding `actionHref` instead is what makes the caption vanish with the link.

**Consequence:** if the URL ever fails the screen, the person is on a non-dismissible full-screen block, with no link **and** no address — the exact dead end R3.4 was written to make impossible. Today this is unreachable (the URL is a frozen constant), so it is defence-in-depth removed rather than a live bug. It matters because that defence is the entire point of R3.4.

**Compounding:** `FatalErrorOverlay.test.ts:86-92` — "renders no anchor when the href was screened away, but still shows nothing broken" — asserts only that no anchor renders and that Reload stays orange. It never checks the caption, so the test locks the deviation in rather than catching it.

**Fix:** `v-if="action"` and `{{ action.url }}` (rendering the raw URL as _text_ is safe; only the `href` needs screening), plus a test assertion that the caption survives `actionHref: null`.

`[FIXED IN WORKING TREE, UNCOMMITTED]` — `FatalErrorOverlay.vue:150-152` is now `v-if="action"` / `{{ action.url }}`, and `FatalErrorOverlay.test.ts:88-98` was rewritten to assert the caption **survives** `actionHref: null`, which is the assertion the case always needed.

---

### 4. MEDIUM — `appUpdate.prompt.notNow` translates into Chinese as "Buy Now"

**`public/translations/zh.json`** (added by this commit):

```json
"appUpdate.prompt.notNow": { "translation": "立即购买", ... }
```

「立即购买」 means **"Buy Now" / "Purchase immediately"**. It is not a dismissal.

This is a **pre-existing systemic defect in the translation pipeline**, not one this commit invented: four of the five existing "Not now" keys already carry the same string (`trust.notNow`, `communityNudge.snooze`, `passkey.promptDecline`, `pwa.installDismiss` all → 「立即购买」; only `installNudge.dismiss` → 「暂不」, which is correct). The pipeline appears to be mistranslating the token "Not now" as a shopping call-to-action.

**Why it matters more here than on the existing four.** The plan explicitly re-litigated adding a sixth `Not now` key (R5) and the criterion says "`npm run translate` is clean". "Clean" was read as "ran without error", not "produced correct copy". The surface this lands on is an **update prompt**: a Chinese user sees "Update beanies / A newer version is available" with a 「立即购买」 button beside it. On a free, privacy-first app that reads as a paid upgrade — a brand and trust problem, not a wording nit, and it is the one prompt where that misreading is most damaging.

**Fix:** override to 「暂不」 (matching `installNudge.dismiss`) for the new key, and file the pipeline defect separately so the other four are corrected in one pass.

---

### 5. LOW–MEDIUM — Testing Plan #3's direct `isAppQuiet()` case was never written

`ls src/utils/__tests__/ | grep -i quiet` → nothing.

Testing Plan #3 asked for "`appQuiet` covered through the existing `usePwaUpdater.test.ts` **plus one direct case**: `isAppQuiet()` returns `false` when the sync store is not ready. **Pins the verbatim-move requirement.**"

The transitive half holds (`usePwaUpdater.test.ts` exercises the real predicate through the route guard). But the specific branch the plan singled out — the `try/catch` at `appQuiet.ts:19-22` that returns `false` when Pinia is not initialised, which is error-table row 7 and the stated reason the move had to be verbatim — has no assertion anywhere. Both current callers reach `isAppQuiet` only after Pinia is up, so a regression that turned the `catch` into `return true` would ship green.

**Fix:** a five-line `appQuiet.test.ts` that calls `isAppQuiet()` with no active Pinia and asserts `false`.

---

### 6. LOW — `useAppUpdate.test.ts:135-143` pins a branch the real code path cannot reach

```
it('says nothing when the floor is a typo, and reports the reason', async () => {
  floor.value = 'v0.17-beta';
  ...
  expect(...detail).toContain('unparseable-version');
```

The test's own comment claims it protects against "a hand-edited, hand-deployed file WILL be mistyped one day". It cannot: `fetchUpdateFloor` gates its return through `isComparableVersion(raw)` (`versionPolicy.ts:98-100`) before returning `raw.trim()`, so a mistyped floor never leaves `versionPolicy` — it becomes `null` with class `unparseable-version` there, which is already pinned by `versionPolicy.test.ts:69-73`. The test reaches `useAppUpdate.ts:72` only by mocking `fetchUpdateFloor` to return a value the real function is structurally incapable of returning.

The branch is not dead code (it fires if `APP_VERSION` itself is unparseable — a real, if remote, release hazard), but the test's stated regression is pinned elsewhere, and in `af38fe75` both sites emitted the identical `detail: 'unparseable-version'`, so CloudWatch could not tell a bad floor file from a bad `APP_VERSION` — and the runbook (`§7`, step 4) tells the operator to triage the floor file from exactly that class.

**Fix:** relabel the test for what it actually guards (a bad shipped `APP_VERSION`) and give the two emitters distinct classes.

`[FIXED IN WORKING TREE, UNCOMMITTED]` — the composable's class is now `app-version-unparseable` with a comment explaining the split. The test still asserts the old string and is currently failing (Finding 11).

---

### 7. LOW — the version comparison was asked twice for one question

**`src/composables/useAppUpdate.ts:71-72`** (`af38fe75`):

```ts
const behind = floor !== null && compareAppVersions(APP_VERSION, floor) === -1;
if (floor !== null && compareAppVersions(APP_VERSION, floor) === null) {
```

Directly against the plan's own standard, applied nine lines of R3.2 to `payloadErrorKind`: "Hoist the existing call ... and read it twice from there rather than calling it again; it is one question asked once." Harmless today (the function is pure), but it is the pattern the plan spent a paragraph outlawing, in the file that introduced it.

`[FIXED IN WORKING TREE, UNCOMMITTED]` — now `const order = floor === null ? null : compareAppVersions(APP_VERSION, floor);`.

---

### 8. LOW — the store-invariant test is largely vacuous

**`src/stores/__tests__/fatalErrorStore.test.ts:50-63`**:

```ts
for (const step of [...]) { step(); if (store.action !== null) expect(store.message).not.toBeNull(); }
```

Criterion 10 asks for "A test asserts an action can never be rendered without a store message". Of the three steps, two (`setFatal('plain')` and `clear()`) leave `action` null, so the guarded `expect` never executes; only the first step asserts anything, and it asserts about the very call that sets both fields. The test never touches `setGenericInitError`, which is the _second_ `initError` writer the plan's invariant argument rests on ("`setGenericInitError` returns early when the store already carries a message"), and it never exercises `App.vue`'s computed. A future third writer that set `action` without `message` would sail past it.

**Fix:** drop the conditional and assert the invariant as a property over each state — `expect(store.action === null || store.message !== null).toBe(true)` — and add one case that interleaves `setGenericInitError` with `setFatal`.

---

### 9. LOW — `storeUrlFor` was exported from a composable module but is not a composable

**`src/composables/useAppUpdate.ts:38-40`** (`af38fe75`). A pure record lookup with no reactivity and no lifecycle, exported from `src/composables/`, and consumed from a util. It also draws the only `security/detect-object-injection` warning in the file (`:40`, `STORE_URL[platform]`) — benign, since the parameter is narrowed to `'ios' | 'android'`, but it is one more reason the lookup wanted its own home. Same root cause as Finding 2. `[FIXED IN WORKING TREE, UNCOMMITTED]`

---

### 10. LOW — `check-failed` telemetry is emitted from two places with a hand-copied shape

`versionPolicy.ts:52-60` has a `report()` helper that is **not exported**; `useAppUpdate.ts:73-78` re-types the same `logEvent` call (same `level`, `surface`, `message`, `action`, `error_code`) by hand. Two writers of one event shape, one of them a copy. Exporting `report` (or a `reportFloorFailure(reason)`) would make `FloorFailure` the single vocabulary for the class **and** keep the constant `message` — which the rate limiter buckets on — in one place.

---

### 11. NOTE — the working tree went briefly red mid-review, and is green again

Not a defect of `af38fe75` (which is green: 6683 tests passing). Mid-review the concurrent fixes left `useAppUpdate.test.ts` behind the source for a few minutes (`storeUrlFor is not a function`; `'app-version-unparseable'` vs `'unparseable-version'`). Both were resolved before this report was finished: a re-run of the eight affected files at 03:10 gives **91 passed / 8 files**, up from 75 in the landed commit. Recorded only so that the intermediate red state is not mistaken for a landed regression if it shows up in another log.

---

## Verified correct

Called out because each was a specific risk the plan named, and each holds up under direct inspection rather than by assertion.

- **No new dependency, and no smuggled one.** `package.json`, `capacitor.config.ts`, `android/` and `ios/` are all untouched, and the two Capacitor APIs used (`App.addListener`, `CapacitorHttp`) both ship inside packages the repo already depends on.
- **Every existing confirm dialog is genuinely unchanged.** I swept all 63 `confirm({` call sites: none passes `confirmHref`. The `<component :is>` swap preserves the static class, the `:class` variant binding, the label ladder and `@click="handleConfirm"` byte for byte, and `ConfirmModal.test.ts:81-89` pins class equality in both directions.
- **`isAppQuiet` is a true verbatim move.** Body and comment are character-identical to the deleted `usePwaUpdater.isQuiet`; `usePwaUpdater` retains no copy; `usePwaUpdater.test.ts` was not edited and still passes because its module-level mocks intercept the moved import.
- **The store URLs really do collapse to one live copy.** Every repo-wide hit for the App Store id and the Play package is accounted for: one constant, one allowed release-note literal, two blog posts, `docs/STATUS.md`, the plan files, and two stale committed native build artefacts that are neither source nor touched.
- **All three stale comments were corrected** (`ios.astro:10-11`, `android.astro:10-11`, `nav.ts:35-36`), which is the kind of thing that silently rots.
- **The eslint zone actually fires.** Verified live through `eslint --stdin`, not read off the config, and its message states the `window.fetch` limit exactly as R4.4 required. No later config block redefines `no-restricted-globals`.
- **The already-parsed-JSON trap is the first test in `versionPolicy.test.ts`.** This was the highest-value pin in the plan — a naive `JSON.parse(res.data)` would have made the floor permanently and invisibly dead — and it is tested as the happy path rather than as an edge case.
- **The stale-link regression is pinned directly.** `fatalErrorStore.test.ts:34-40` — `setFatal` with an action, then `setFatal` without one, asserting null — is exactly the defect R3.3 predicted for `surfaceLineageFatal`.
- **The web overlay is protected by a sweep, not a single case.** `payloadFailureSurface.test.ts` asserts no action on web across **all five** `PayloadErrorKind`s and no action on native for the four non-`needs-update` kinds, so a future sixth kind cannot quietly acquire a store link.
- **`payloadErrorKind` was hoisted as R3.2 asked**, and the force reuses `kind === 'needs-update'` rather than adding a second `needsAppUpdate` reader.
- **`App.vue`'s mirror tuple did not grow.** The action is a `computed` off the store (`:226-227`), which is what the plan spent a paragraph arguing for.
- **Observability adds no context key.** `action`, `error_code`, `detail`, `os` were all already allowlisted, so the store data-collection table correctly stayed untouched — the plan said "no new keys and none may be made", and none were.
- **The `FatalErrorOverlay` extraction is a faithful move**, and the 11 mounted tests it enables are net-new coverage of the app's most important failure surface, which had none.
