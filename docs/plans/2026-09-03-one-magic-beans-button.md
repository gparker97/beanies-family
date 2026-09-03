# Plan: one magic-beans button — the AI decides what it is

> Date: 2026-09-03
> Related issues: Notion tracker #84 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-03-one-magic-beans-button.md`
> Mockup: `docs/mockups/magic-beans-one-button-2026-09-03.html` (direction B approved)

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section below.

## User Story

As a parent, I want one button that just takes whatever I have — a photo of a party invite, a booking PDF, a block of text I copied, a recipe link — and works out what it is, so that I do not have to categorise my own mess before beanies will read it, and cannot get a worse result by guessing wrong.

## Context

The quick-add sheet's "Magic beans" card offers three chips — 📸 invite, ✈️ travel booking, 🍳 recipe — and each opens a different reader. The user has to declare what their photo or document IS before beanies has looked at it.

The share path already does the opposite, and does it well. `ingestSharedContent` takes whatever another app hands over, runs ONE extraction, and `classify()` routes on the model's own `event | travel | recipe | none` verdict. So the same school PDF lands correctly when shared from Gmail and can land in the wrong reader when added from inside beanies — and picking wrong does not produce a helpful error, it produces a **bad extraction**, which is worse: the user gets a filled-in form with the wrong shape and has to notice.

**This is an entry-point change, not an architectural one.** `classify()` is the content router, `MAGIC_READERS` is a single registry mapping reader → route + shareKind, `readerForShareKind` inverts it, and `dispatchSharePayload` delivers a typed payload to the page that owns the review modal. The work is to give the in-app button the same pipeline instead of three type-declaring shortcuts.

### ⚠️ Build-order prerequisite: #83 must land first

VERIFIED 2026-09-03 against the codebase:

- `ShareSource` is `{ kind: 'documents'; files: File[] } | { kind: 'link'; url: string }` (`useSharedDocumentIngest.ts:255`). **There is no `text` arm.**
- `MAX_SHARE_TEXT_CEILING` and the client quota module named in #83's plan **do not exist anywhere in `src/`**.
- `extractShareFromText` DOES exist (`documentExtractionService.ts`) but is currently reached only for the _resolved page text of a link_, never for user-supplied text.

So #84's paste-text source has nothing to consume yet. Decided with greg (2026-09-03): **plan #84 whole now, build it after #83.** The alternative — shipping the button for photo/file/link and adding paste later — would ship the approved design without its hero affordance and require designing the surface twice.

### ⚠️ EVERY NUMBER IN THIS PLAN IS PRE-#83 — RECOUNT BEFORE YOU BUILD

This is the plan's largest standing risk and it is stated here rather than buried. #83's own Files Affected says it will:

- add a third `ShareSource` arm (`text`),
- change the band decision **inside `prepare()`**,
- **extract a new shared extract→classify tail helper inside `read()`**,
- **widen `logReceivedKind`** to a third `detail` value,
- **edit this plan's gating test suite** (its Pass 4 lengthens the fixture at `useSharedDocumentIngest.test.ts:255`).

Therefore, as of 2026-09-03 the file has **20** `surface: SURFACE` sites, **4** hardcoded `origin: 'share'` literals in `read()`, **49** tests and **645** lines — and **none of those four numbers will be right on the day this is built**. They are recorded as evidence that the refactor was sized honestly, not as targets.

**Build-time step 0, before any code: re-run the counts.** `grep -c "surface: SURFACE"`, `grep -n "origin: 'share'"`, and the suite's test count. If a count moved by more than #83's plan accounts for, something else landed in between and this plan's scope table (§1a) must be re-derived, not assumed.

**Consequently the Commit A gate is phrased against the suite, not against a number** — see §1b.

### ⚠️ #83 is NOT asked to change shape

An earlier draft asked #83 to land its text policy as an exported `sourceFromText(text, surface)`. **That ask is withdrawn.**

1. **The proposed signature is wrong, and we would only have discovered that during #84's build.** VERIFIED in #83's plan §3: the band decision is _not_ a pure function of the string — `overCeiling` comes from `textFile.size` **before decoding**, and the verdict applies "only in the no-URL fallback". A `(text, surface)` function cannot reproduce that.
2. **#83 has had four review passes and has not been built.** Reopening its structure reopens its review for the benefit of an unshipped downstream.
3. **One plan should own one refactor.** #84 is built _after_ #83 lands, against real code, with #83's own suite as the regression guard.

**What #84 does instead:** as its first step, extract #83's no-URL text fallback out of `prepare()` into a module-local `sourceFromText(...)` with whatever signature the landed code actually requires, and have `prepare()` call it. #83's tests are the proof it is behaviour-preserving.

**Where #83's limits actually live, and why the in-app path inherits them for free** (VERIFIED in #83 §4): the quota **peek** sits in the text fallback — i.e. inside the extracted `sourceFromText` — and the **consume** sits in `read()` immediately before `extractShareFromText`. Both are on the shared spine after this refactor, so requirement 7 is satisfied structurally rather than by discipline. Do not add a second check anywhere.

### ⚠️ COPY: every `shareTarget.*` string reachable from the shared spine must read source-neutrally

This is broader than #83, and one instance is **already shipped and already wrong**:

- `shareTarget.busy.message` — _"beanies is still reading **the last thing you shared**. Try again in a moment."_ §1 deliberately shares the busy guard with the in-app path, so an in-app capture during a share (or vice-versa) shows a message about sharing to someone who did not share. **Reword it source-neutrally in Commit B** (one `en`/`beanie` pair; `useSharedDocumentIngest.test.ts:527` asserts on the _key_, so it stays green).
- Checked and already neutral, no action: `shareTarget.unrecognised.*` ("that"), `shareTarget.readerOff.*`, `shareTarget.unsupported.*` ("photos, screenshots, PDFs and links"), `shareTarget.firstAttached.*`, and the outermost catch's `ai.error.*`.
- Not on this path, no action: `shareTarget.failed.*` (VERIFIED: `ShareTargetPage.vue` only), `shareTarget.signIn.*` / `shareTarget.notReady.*` / `shareTarget.partial.*` (share-only).
- **At build time**, apply the same test to whatever #83 landed: `shareTarget.text.tooShort / tooLong / truncated / quota` plus its `rate_limited` pair. Reusing the strings is correct — a second set of length messages for the same policy is exactly the divergence lesson 11 warns about — but the wording must survive the second surface.

**And one policy question #83 hands us that only #84 can answer:** #83 introduces `MIN_SHARE_TEXT_CHARS = 25`. In-app, "Soccer 4pm Sat" is 14 characters and is a _deliberate_ paste, not share-sheet noise. **Decision, made now: keep one policy.** The floor exists because sub-25-character prose does not carry an extractable event either way, and two thresholds for one question is the divergence this plan exists to prevent. The obligation is on the copy: the `tooShort` message must say what beanies needs, not that "the share" was too short.

## Requirements

1. **One magic-beans affordance** in the quick-add card, replacing the three per-reader chips.
2. **The AI decides the destination from the content.** The user never pre-declares a type.
3. **Four sources**: a photo (camera), a file (image or PDF), pasted text, and a pasted link.
4. **Reuse the share path's routing** — `classify()` + `readerForShareKind` + `dispatchSharePayload`. Routing must not exist twice.
5. **The review modal stays the confirmation step** for every source.
6. **A specific outcome for `none`** — never a blank review modal, never a silent no-op.
7. **Text and link inherit #83's limits**, through the SAME peek and the SAME consume. No second unmetered path to the proxy and no second copy of the band logic.
8. **The camera stays reachable on native** via an explicit button.
9. **Observability**: the in-app funnel is separable from the share funnel in CloudWatch, and the routing verdict is countable.
10. Ships **ungated** (no feature flag) and creates **no GitHub issue**.
11. **The shipped share path must not regress.** A requirement, not a hope — see §1b.
12. **No user-visible string is left describing a chip that no longer exists** — in the UI, in `uiStrings.ts`, or in the Help Center.

## Important Notes & Caveats

- **⚠️ Do NOT design a dev-flag-off experience.** Resolved with greg: _"once a feature is released to prod the dev flags can be ignored."_ `aiPhotoExtract` and `aiTravelExtract` are both `true` in `featureFlags.committed.ts` and the recipe reader is ungated (#72). The `isReaderEnabled` check stays in the shared pipeline (existing code, and it covers permission too) but no new UI is designed for a disabled flag.
- **⚠️ The PERMISSION half of `isReaderEnabled` is a real production case and must not regress.** VERIFIED (`useMagicReader.ts:286-295`): `gate('recipe')` is **ungated**, so `canReadAny` reduces to `canEditActivities` _unconditionally_ — the two flags do not enter into it. Collapsing three chips to one button behind the same `v-if="canReadAny"` is therefore permission-neutral by construction, not by flag state.
- **⚠️ On native the camera is NOT free.** `AI_PICKER_ACCEPT` is `image/*,application/pdf,.pdf`; in a Capacitor WebView that mixed accept routes to the system documents picker, which has **no camera entry**. This is why `AiDocumentPicker.vue` exists. Direction B's explicit "Take a photo" button is load-bearing — it must use the image-only `capture` input.
- **⚠️ `AiDocumentPicker` needs NO change.** VERIFIED: `defineExpose({ pick, pickCamera, pickFile })` at line 86, with a dedicated `{ accept: 'image/*', capture: 'environment' }` input at lines 40-41; `FamilyCookbookPage.vue` already drives `pickCamera()` / `pickFile()` from inside `RecipeLinkModal`.
- **⚠️ Where `AiDocumentPicker` is mounted is a native-lifecycle question.** In the cookbook it is mounted on a _page_, which survives a camera intent backgrounding the app. Here it would sit on `MagicReaderCard`, inside `QuickAddSheet`'s `BaseModal`. If anything closes the quick-add sheet while the native camera is up, the component unmounts and the `change` callback lands on a dead input. Mount it on `MagicReaderCard` (opening the magic drawer does not close the sheet) and put "background the app from the camera, return, confirm the file still arrives" on the manual list for **iOS and Android**. If it proves fragile, hoist the picker to the app shell beside `AiProcessingOverlay` — do not add a retry.
- **⚠️ The surface already exists in all but name — `RecipeLinkModal.vue` IS direction B.** VERIFIED: a `BeanieFormModal variant="drawer" layer="overlay"` whose header comment describes the identical decision ("the link field IS the modal… Camera and file stay one tap away underneath, visually quieter"), with a focus-on-open watch, an `or from` hairline divider (line 104) and a two-up grid (lines 109-125). **Do not invent a bottom-sheet primitive.**
- **⚠️ The theme skill forbids building a modal from scratch.** `.claude/skills/beanies-theme/SKILL.md` § Modal System, and `QuickAddSheet.vue`'s own header (a second bottom-sheet surface should become a `BaseModal placement` prop, not a copy).
- **⚠️ Keyboard avoidance is INHERITED.** VERIFIED: `BaseSidePanel.vue:81-89` renders `fixed inset-y-0 flex w-full flex-col overflow-y-auto` with `env(safe-area-inset-*)` padding — a full-height scrolling column with the field at the top. **No `visualViewport` code, no new composable.** If a real device shows a problem, fix `BaseSidePanel` so every drawer benefits.
- **⚠️ The magic sheet MUST close before the ingest starts.** Three verified failures otherwise: `AiProcessingOverlay` is `z-[60]` and `BaseSidePanel layer="overlay"` panel is also `z-[60]`; `useFullscreenOverlay` holds a body-scroll lock; and `openQuickAdd()` refuses outright when `hasOpenOverlays()` (`useQuickAdd.ts:101`) and files a `reportError`, so a leaked drawer makes the FAB dead until reload.
- **⚠️ `ResultEnvelope.origin` is `origin?: 'share'`** (`src/types/magicPayload.ts:94`) — widen to `'share' | 'in-app'`. Additive; every construction site already passes `'share'`.
- **⚠️ Widening `origin` has ONE live reader and it is a silent-failure trap.** VERIFIED: `useRecipeCapture.ts:150` is `if (env.origin === 'share')` — the compensating `start` event for a capture whose reading happened in the orchestrator. An in-app capture is in the same position, so left as-is the recipe surface's `start`/`ready` pair silently stops balancing. It becomes `if (env.origin)` with `detail: env.origin`. It is the only `env.origin` read in `src/`.
- **⚠️ The quick-add sheet is mounted at the app shell**, so the button must dispatch through the `useMagicReader` singleton, never a local emit — `openReader` carries the `closeSheetForNavigation` + replace-vs-push discipline a naive `router.push` would break.
- **⚠️ Consent runs ONCE, inside the pipeline.** `ingestSharedContent` calls `requestConsent()` between the offline guard and `read`. The cookbook prompts BEFORE opening its link modal (`handleAddFromDocument`); the magic sheet must **not** copy that, or the user gets two prompts.
- **⚠️ The in-app path must keep the `isConfigured` check.** VERIFIED: `useAiCapability().isConfigured` is false for BYOK-without-a-key and for `on-device`, and it is one of `awaitReadiness`'s four preconditions (`useSharedDocumentIngest.ts:150`). The in-app path skips `awaitReadiness` (auth and family are settled inside a running app), so without this it prompts for consent and only then fails at extraction.
  **How, precisely:** `notReady()` (line 114) hardcodes both `surface: SURFACE` **and** the message `'share not ready'`, so it cannot simply be called from the in-app path. **Thread `env` into `notReady` too** (one parameter; `awaitReadiness` passes `SHARE_ENV`, and its message becomes `'ingest not ready'` — a message string is not a dashboard filter, `surface` is). That keeps one toast+log site for "not set up yet" and reuses `ai.unavailable.title` / `.message` verbatim. Do not invent a second phrasing and do not duplicate the toast.
- **⚠️ Adding an export to `useSharedDocumentIngest` can break unrelated suites.** `docs/lessons.md` §8: factory `vi.mock()`s are exhaustive. VERIFIED: `useShareTargets.test.ts:37` mocks this module with `{ ingestSharedContent: vi.fn() }`. It does not touch the new export today, but any new test that mocks the module must return **both** entry points.
- **Do NOT touch the share path's behaviour.** #84 brings the in-app entry point up to parity.
- **Do NOT add a fourth reader**, a general "ask beanies" chat surface, or any change to the permission/consent model.
- **Out of scope, deliberately: the page-level `MagicReaderPill`s.** VERIFIED in four places (`CalendarCommandBar.vue:250`, `TravelPlansPage.vue:833,972`, `FamilyCookbookPage.vue:245`), each opening a _specific_ reader from a context where the type is already known. They are not the "I have a thing" door. Say so, or the next reader assumes they were missed.

## Build-time verification list

> These are not assumptions to accept — they are the eight things to re-check in the post-#83 tree before writing code. Each was true on 2026-09-03.

1. `MAGIC_READERS` still maps `photo → /activities (event)`, `document → /travel (travel)`, `recipe → /pod/cookbook (recipe)`, and `readerForShareKind` is still asserted total + injective by a unit test.
2. The spine is still: received → busy guard → `awaitReadiness` → `prepare` → offline → `requestConsent` → `read` → `classify` → `none` toast → `isReaderEnabled` → `dispatchSharePayload`.
3. `AiDocumentPicker.vue` still exposes `pick` / `pickCamera` / `pickFile` and still renders both hidden inputs unconditionally so their refs stay live.
4. `AI_PICKER_ACCEPT` / `AI_PICKER_MAX_BYTES` / `isAiPickerAcceptedFile` are still the single accept + size policy (`src/constants/aiDocumentPicker.ts`).
5. `MagicReaderCard.vue` is still mounted in `QuickAddSheet.vue` and still self-gates on `canReadAny`.
6. `AiProcessingOverlay` is still mounted once in `App.vue` bound to `isReadingSharedDocument` = `isIngesting && !consentOpen`.
7. `logEvent`'s `surface` is still a free-form `string` — this is what lets the two funnels separate without a new telemetry field.
8. **The counts.** See the recount instruction above.

## Approach

The design intent of `docs/mockups/magic-beans-one-button-2026-09-03.html` (direction B) is reproduced faithfully; every concrete token comes from the CIG, not the mockup's raw values.

### 1. The one structural idea: split the orchestrator at `prepare`

The share path and the in-app path differ ONLY in how a `ShareSource` is obtained:

```
SHARE   SharedContent (platform files/text) ─┐
                                             ├─▶ ShareSource ─▶ [ offline → consent →
IN-APP  a File, or pasted text/link ─────────┘                    read → classify →
                                                                  none → isReaderEnabled →
                                                                  dispatchSharePayload ]
```

Three functions in `useSharedDocumentIngest.ts`, no new module:

```ts
/** Busy guard + reading overlay + the outermost catch. Wraps BOTH entry points. */
async function withIngestLock(env: IngestEnv, run: () => Promise<void>): Promise<void>;

/** The shared tail: offline → consent → read → classify → none → reader gate → dispatch. */
async function runIngest(source: ShareSource, env: IngestEnv): Promise<void>;

/** IN-APP entry point, exported beside `ingestSharedContent`. */
export async function ingestInAppSource(input: InAppInput): Promise<void>;
```

`IngestEnv = { surface: string; origin: 'share' | 'in-app' }` — carried rather than passed as two arguments so no call site can pair the wrong two, and declared with **no default anywhere**, so an unthreaded site is a compile error rather than a silently share-labelled event.

`ingestSharedContent` keeps its exact signature: `logEvent(received)` → `withIngestLock(SHARE_ENV, …)` → `awaitReadiness` → `prepare` → `runIngest(source, SHARE_ENV)`.

**`withIngestLock` is separate from `runIngest` for a reason, not for symmetry.** Today the busy guard fires _before_ `awaitReadiness` and `prepare`. Folding the lock into `runIngest` would move the guard later on the share path — a behaviour change. The wrapper preserves the current ordering exactly.

**Why the busy guard is shared:** `isIngesting` is module-level and already means "one AI read at a time, app-wide". An in-app capture must contend for the same lock (or a share arriving mid-capture doubles the AI spend) and — the free part — **drives `isReadingSharedDocument`, so the in-app path inherits the globally-mounted `AiProcessingOverlay` with zero new code**. Its refusal toast must be reworded (see the copy caveat).

#### 1a. Scope of the parameterisation — state it precisely, and no wider

| Function                                | Gets `env`?            | Why                                                                                                               |
| --------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `runIngest` (the spine's tail)          | **Yes**                | Shared by both entry points.                                                                                      |
| `read()`                                | **Yes**                | Shared. Log sites **and** the hardcoded `origin: 'share'` literals.                                               |
| `logReceivedKind()`                     | **Yes** (surface only) | Called from `sourceFromText`, which both paths use. Without this an in-app paste **emits onto the share funnel**. |
| `notReady()`                            | **Yes**                | Now called by both — see the `isConfigured` caveat. Message becomes source-neutral.                               |
| `awaitReadiness()` / `waitUntilReady()` | **No — unchanged**     | Share-only (cold-start readiness). Passes `SHARE_ENV` to `notReady`.                                              |
| `prepare()`                             | **No — unchanged**     | Share-only. Platform triage has no in-app meaning.                                                                |

Everything else keeps the module `SURFACE` constant. Add one `const SHARE_ENV: IngestEnv = { surface: SURFACE, origin: 'share' }` so the share path has exactly one literal.

#### 1b. Sequence it as TWO commits, with the existing suite as the gate

This is the whole risk control, and it is what makes "behaviour-preserving" a claim we can _check_:

- **Commit A — pure parameterisation. No new behaviour, no new entry point, no UI.** Extract `withIngestLock` / `runIngest`, thread `IngestEnv` through `read`, `logReceivedKind` and `notReady`, widen `ResultEnvelope.origin`, extract `sourceFromText` out of `prepare`.
  **The gate: `useSharedDocumentIngest.test.ts` must pass with ZERO diff — not "49 tests", but _the file as #83 leaves it_, byte-identical.** A `git diff --exit-code` on that path is the check. If it needs a single change, the split was not behaviour-preserving — fix the split, not the test, or abandon the split per §1c.
- **Commit B — the feature.** `ingestInAppSource`, `MagicBeansSheet`, `AiSourceButtons`, the card, the copy fixes, the dead-code sweep, the new tests.

#### 1c. The alternative that was considered and rejected

_Have the in-app path synthesise a `SharedContent` and call `ingestSharedContent` unchanged._ Zero refactor, zero risk to the shipped path. **Rejected on two requirements, not on taste:**

- Every event would carry `surface: 'share-target-ingest'`, so the funnels could not be separated — requirement 9 fails outright.
- `prepare()`'s file rejection is a single `shareTarget.unsupported` toast for both "too big" and "not a type we read", because at the share boundary the user did not choose the file. In-app they did.

It also mislabels the platform and pays for `awaitReadiness`'s polling loop inside a running app.

### 2. The in-app front end — three lines of triage, then the shared tail

```ts
export type InAppInput = { kind: 'file'; file: File } | { kind: 'paste'; text: string };
```

- **`file`** (camera or picker — the same thing once a `File` exists): `withSniffedType(file)` → size check → `isAiPickerAcceptedFile(file)` → `{ kind: 'documents', files: [stamped] }`. The same two helpers `prepare` uses; no second accept policy.
  - **Size is checked separately from acceptance, on purpose.** VERIFIED (`aiDocumentPicker.ts:56`): `isAiPickerAcceptedFile` returns one boolean for `size === 0`, "too big" and "not a type we read". `file.size > AI_PICKER_MAX_BYTES` gets its own message naming the 25 MB limit; everything else gets the existing `shareTarget.unsupported.*`.
  - **⚠️ The size string pair does NOT exist.** VERIFIED: `AI_PICKER_MAX_BYTES` has no copy anywhere. Add `ai.picker.tooLarge.title` / `.message` (`en` + `beanie`), naming 25 MB. Only the _type_ pair is reused.
- **`paste`**: `sourceFromText(...)` — extracted from `prepare()` in Commit A. Link-vs-text, the bands, the truncation notice and the quota peek all come from it. **#84 adds no text policy of its own.**
- Both then run the `isConfigured` check via `notReady(IN_APP_ENV, …)` and call `runIngest(source, IN_APP_ENV)`.

`ingestInAppSource` lives **in `useSharedDocumentIngest.ts`, beside `ingestSharedContent`**, not in a new composable. It uses four of that file's private helpers, and putting the two entry points on the same screen is what makes divergence visible. It is a plain exported function, not a composable — `prepare` already runs from a native listener outside `setup()`, and this file deliberately holds no lifecycle hooks.

**If a fifth source ever appears**, the split to make is **`prepare`/`read` into a `share/` module pair**, not "one composable per entry point". Recorded so the next change does not reach for the wrong seam.

### 3. Observability without a new telemetry field

**The funnels separate by `surface`, which is already a first-class filter.** `runIngest`, `read`, `logReceivedKind` and `notReady` take their surface from `IngestEnv` and emit their existing events under `magic-beans-capture` for the in-app path and `share-target-ingest` for a share. One CloudWatch filter isolates each funnel, with:

- no `origin` key added to `ALLOWED_CONTEXT_KEYS`,
- no mirrored edit to `infrastructure/lambda/telemetry/index.mjs` (pinned by `telemetryAllowlistDrift.test.ts`),
- **no telemetry-Lambda deploy standing between the client change and its own observability** — an unmirrored key is silently DROPPED server-side,
- no change to `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, store Data-Safety answers or `privacy.astro`.

`ResultEnvelope.origin` still widens — it is a client-side type read by `useRecipeCapture`, not a telemetry field — and where the recipe surface logs it, it goes in the already-allowlisted `detail`.

**The invariant that keeps the threaded sites honest:** a unit test that captures **every** `logEvent` call across one full share run and asserts they all carry `surface: 'share-target-ingest'`, plus its mirror for a full in-app run asserting `magic-beans-capture`. One missed site is then a red test, not a dashboard someone notices is wrong in three months — and it is what makes the exact site count irrelevant, which matters given every count here is pre-#83.

### 4. The surface — direction B

**`src/components/ai/MagicBeansSheet.vue`**, opened by the single button on `MagicReaderCard.vue`, built exactly like `RecipeLinkModal.vue`:

```
<BeanieFormModal variant="drawer" layer="overlay" icon="✨"
                 :title="t('ai.capture.title')"
                 :save-label="t('ai.capture.action')" :save-disabled="!hasText" …>
  <FormFieldGroup>  <BaseTextarea …autofocused on open… />  </FormFieldGroup>
  <AiSourceButtons @camera="…" @file="…" />
</BeanieFormModal>
```

- **Hero: the paste field.** A `BaseTextarea` (not `BaseInput`) — a pasted class-group message is several lines. Focused on open with the same `nextTick` + `querySelector` idiom `RecipeLinkModal` uses. It does not ask text-or-link: `sourceFromText` decides.
- **`layer="overlay"`** because it opens above the quick-add `BaseModal` (z-50) → backdrop `z-[55]`, panel `z-[60]`. Same stacking `RecipeLinkModal` uses.
- **Beneath it, `AiSourceButtons.vue` (NEW, ~30 lines, presentational)** — the `or from` hairline divider plus the two-up Take-a-photo / Choose-a-file grid, `emit('camera')` / `emit('file')`. This markup exists **verbatim** in `RecipeLinkModal.vue:98-126` today; extracting it is `docs/lessons.md` §11 applied before the second copy ships.
  - **Hard constraint: zero logic and zero props.** Two emits, three `t()` calls, no conditionals, no variants. If a third caller needs it different, copy it — do not parameterise it.
  - **The divider key is decided now.** VERIFIED: `recipeExtract.link.orFrom` has exactly two references (`uiStrings.ts:8840`, `RecipeLinkModal.vue:104`), `src/services/translation/translations/` contains only a README, and `uiStrings.test.ts` has **no orphan-key assertion**. So: add `ai.picker.orFrom` (`en` + `beanie`) beside `ai.picker.takePhoto` / `ai.picker.chooseFile`, use it in the shared component, and delete `recipeExtract.link.orFrom`. **No alias, no conditional.** Per `docs/lessons.md` §5 this is a string add/remove, not a structural change to `uiStrings.ts`, so `scripts/updateTranslations.mjs` needs no attention — but run `npm run translate` once to confirm.
- **What the buttons do:** `picker.pickCamera()` / `picker.pickFile()` on the `AiDocumentPicker` mounted by `MagicReaderCard` — the exact `FamilyCookbookPage` wiring, no chooser-on-a-chooser.
- **Every path closes the sheet first**, then calls `ingestInAppSource(...)`. The picker stays mounted on the card, not the sheet, so a file chosen after the sheet closes still has a live input ref.
- **The whole surface is NOT generalised with `RecipeLinkModal`.** They agree on the container and the secondary buttons (both now shared) and disagree on everything else: the recipe modal validates a URL through `useRecipeLinkInput`, disables save until it routes, and shows a three-way hint; this one accepts anything non-empty and validates nothing. A props-driven super-modal would carry both sets of semantics and be worse than either. A deliberate stop, not an oversight.

**`MagicReaderCard.vue`** collapses to one full-width white button inside the unchanged gradient card (`canReadAny` still gates the whole `<section>`), plus the sheet's `open` ref and the `<AiDocumentPicker>` mount. `canReadPhoto` / `canReadDocument` / `canReadRecipe` are no longer imported here.

### 5. Dead code and dead strings the change creates — sweep them in the same commit

**Functions.** After the chips go, `openPhotoReader` and `openRecipeReader` have no remaining _production_ call site. VERIFIED: the only files mentioning either are `useMagicReader.ts`, `MagicReaderCard.vue` and two test files; `openDocumentReader` survives via `VacationStep1.vue:39`. Delete both from `useMagicReader`'s exports and body.

**⚠️ `src/composables/__tests__/useMagicReader.test.ts` must be re-pointed, not just tidied.** VERIFIED: `openPhotoReader` drives **~10 tests** there, including the replace-vs-push navigation-discipline test (line 138), the already-on-route test (147) and **all four `consumePendingMagic` tests** (158-184). Re-point them at `openDocumentReader` (which stays, and exercises the identical `openReader` code path) — the coverage of `openReader`'s sheet/history discipline must not be deleted along with the function. `canReadPhoto` / `canReadRecipe` themselves stay: `canReadAny`, `ActivityModal.vue:97` and `FamilyCookbookPage.vue:48` still read them.

Consequence to state rather than discover: the payload-less `else` branch in the `photo` and `recipe` consumers (`FamilyPlannerPage.vue`, `FamilyCookbookPage.vue`) becomes unreachable. **Leave both**, with a one-line comment — `useMagicReaderConsumer`'s handler signature is shared with `document`, which still uses that branch.

`TravelPlansPage.smoke.test.ts` and `MagicReaderCard.test.ts` both use factory `vi.mock('@/composables/useMagicReader')`. Extra keys are harmless, but update both rather than leaving mocks describing exports that no longer exist.

**Strings.** VERIFIED — after the chips go, **four** keys lose their only consumer, not one:

- `recipeExtract.link.orFrom` (replaced by `ai.picker.orFrom`)
- `ai.magic.invite`, `ai.magic.travelBooking` (chip labels)
- `recipeExtract.chip.title` — referenced **solely** by `MagicReaderCard.vue:64`

Retire all four (`en` + `beanie`). `ai.magic.title` / `ai.magic.subtitle` stay — the card keeps its heading. Since there is no orphan-key test, leaving them is silent rot; retiring one but not the other three is arbitrary.

### 6. One more non-silent-failure fix in existing code

`consumePendingMagic`'s two `reportError` calls hardcode `surface: 'share-target-ingest'` (`useMagicReader.ts:228, 241`) — after this change an **in-app** capture can be the thing dropped at a closed reader or arriving mismatched, and it would be filed under the share funnel. VERIFIED that `payload.env` exists on all three `SharePayload` arms, so add `detail: payload.env.origin ?? 'share'` to both contexts (`detail` is already allowlisted). Two lines; without them the one error path that says "the AI call was billed and the result vanished" points at the wrong door.

### 7. Complexity budget — what this change is NOT allowed to grow into

- **No third entry point** into `useSharedDocumentIngest`. Two is the maximum this shape supports; a third means splitting `prepare`/`read` into their own module.
- **No `IngestEnv` fields beyond `surface` and `origin`.** It is a label, not a context object. The moment it carries behaviour (a policy, a callback, a flag) the two paths have diverged and should be two functions.
- **No retry, queue or persistence** for a failed in-app capture. `isIngesting` refuses audibly; that is the whole concurrency story.

## Files Affected

**Created**

- `src/components/ai/MagicBeansSheet.vue`
- `src/components/ai/AiSourceButtons.vue`
- `src/components/ai/__tests__/MagicBeansSheet.test.ts`

**Modified — Commit A (pure refactor)**

- `src/composables/useSharedDocumentIngest.ts` — `withIngestLock(env, run)` + `runIngest(source, env)`; `IngestEnv` threaded into `read()`, `logReceivedKind()` and `notReady()`; the hardcoded `origin: 'share'` literals in `read()` become `env.origin`; `sourceFromText` extracted out of `prepare()`
- `src/types/magicPayload.ts:94` — `origin?: 'share'` → `origin?: 'share' | 'in-app'`
- `src/composables/useRecipeCapture.ts:150` — `env.origin === 'share'` → `if (env.origin)` with `detail: env.origin`
- `src/composables/__tests__/useSharedDocumentIngest.test.ts` — **zero diff.** The gate.

**Modified — Commit B (the feature)**

- `src/composables/useSharedDocumentIngest.ts` — exported `ingestInAppSource` + the `isConfigured` guard
- `src/composables/useMagicReader.ts` — delete `openPhotoReader` / `openRecipeReader`; add `detail: origin` to `consumePendingMagic`'s two error reports
- `src/components/ai/MagicReaderCard.vue` — three chips → one button + the sheet + the picker mount
- `src/components/pod/RecipeLinkModal.vue` — its divider+duo replaced by `<AiSourceButtons>`
- `src/services/translation/uiStrings.ts` — add the sheet's strings, `ai.picker.orFrom`, `ai.picker.tooLarge.*`; reword `shareTarget.busy.message` source-neutrally; retire `recipeExtract.link.orFrom`, `recipeExtract.chip.title`, `ai.magic.invite`, `ai.magic.travelBooking`
- `src/content/help/security.ts` — the Magic Beans article (see Help Center Coverage)
- `src/content/help/the-pod.ts:553` — the "tap Recipe 🍳" instruction
- `src/content/help/features.ts` — the `share-to-beanies` article's in-app cross-reference
- `src/composables/__tests__/useSharedDocumentIngest.test.ts` — ADDITIVE `describe('ingestInAppSource')` + the two surface-invariant tests
- `src/composables/__tests__/useMagicReader.test.ts` — re-point ~10 `openPhotoReader` tests at `openDocumentReader`
- `src/components/ai/__tests__/MagicReaderCard.test.ts` — one button, no chips; factory mock updated
- `src/pages/__tests__/TravelPlansPage.smoke.test.ts` — factory mock updated
- `CHANGELOG.md`, `docs/STATUS.md`

**Explicitly NOT modified** (each was in an earlier draft; each is verified unnecessary)

- `docs/plans/2026-09-02-plain-text-share.md` — **#83 is not amended**
- `src/components/ai/AiDocumentPicker.vue` — `pickCamera` / `pickFile` already exposed
- `prepare` / `awaitReadiness` / `waitUntilReady` — share-only, keep `SURFACE`
- `src/utils/diagnosticContext.ts`, `infrastructure/lambda/telemetry/index.mjs`, `telemetryAllowlistDrift.test.ts`, `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro` — no new context key
- Any bottom-sheet / keyboard-avoidance primitive — inherited from `BaseSidePanel`

## Help Center Coverage

- **Action**: `update existing` — **three** articles.
- **⚠️ The magic-beans article is NOT in `features.ts`.** VERIFIED: it is `src/content/help/security.ts:634`, _"Magic Beans: How beanies Reads Your Photos & Documents"_ (category: security).
- **`security.ts:636, 650`** — line 650 currently reads _"Tap ✨ Perform magic (or the **Invite** and **Travel booking** buttons)"_, naming two chips this change deletes. Rewrite to the one button and the four sources (a photo, a file, pasted text, a link), and that beanies works out what it is rather than asking. Line 636's "a photo or booking" must widen to include pasted text.
- **`the-pod.ts:553`** — currently _"look for the **Magic beans** card and tap **Recipe 🍳**"_. That chip is gone; rewrite to the one button.
- **`features.ts` → `share-to-beanies`** — already says the in-app readers behave the same as the share path; confirm that remains true and mention pasted text.
- **Scope, across all three**: nothing is saved until you confirm it in the review step; the content leaves the device to be read (ADR-030 consent); a family shares one budget for reads; and what happens when beanies cannot place something ("it will tell you, and nothing is saved") so the `none` outcome is documented, not just handled.
- **Also check at build time**: if #83 amended `security.ts`'s "photo or document" wording for shared text, confirm it now also covers pasted text from inside the app.

## Observability Coverage

Surface: **`magic-beans-capture`** for the in-app entry point, threaded through `IngestEnv` — distinct from `share-target-ingest` so one CloudWatch filter isolates each funnel. **No new context key**; every field below is already allowlisted and already mirrored in the telemetry Lambda.

| Event                                | Level     | Surface               | Context                                                             | Why                                                                                                                           |
| ------------------------------------ | --------- | --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `capture opened`                     | `info`    | `magic-beans-capture` | `{ action: 'opened' }`                                              | The denominator. Without it no in-app rate is computable.                                                                     |
| existing `share triaged`             | `info`    | _(per env)_           | `{ action: 'triaged', detail: 'file'\|'link'\|'text', file_count }` | Which source people use. `logReceivedKind` now takes the surface — without that, an in-app paste emits onto the share funnel. |
| existing `share classified`          | `info`    | _(per env)_           | `{ action: 'classified', kind }`                                    | The routing verdict, attributable to an entry point.                                                                          |
| existing `share not ready`           | `info`    | _(per env)_           | `{ action: 'not_ready', detail: 'ai_unconfigured' }`                | The BYOK-no-key refusal, now countable per door.                                                                              |
| existing `target reader unavailable` | `warn`    | _(per env)_           | `{ action: 'reader_disabled', kind }`                               | Permission case (the flag case is dev-only).                                                                                  |
| existing `share ready for review`    | `info`    | _(per env)_           | `{ action: 'ready', kind }`                                         | Success emits too, so a rate is measurable.                                                                                   |
| existing `share ingest threw`        | `error`   | _(per env)_           | `{ action: 'threw' }`                                               | `withIngestLock`'s catch. Firehose, not Slack.                                                                                |
| existing `extracted share dropped`   | `warning` | `share-target-ingest` | `{ action: 'reader_disabled', kind, detail: origin }`               | Billed call, result lost. `detail` now names which door it came in by.                                                        |

**Failure modes → the event that diagnoses them blind**: nobody uses the button (`opened` rate); a source is broken (`triaged` by `detail` vs `classified`); the model can't place content (`classified` with `kind: 'none'`); AI isn't set up (`not_ready`); a member is blocked (`reader_disabled`); the pipeline throws (`threw`); a result is billed and lost (`extracted share dropped`).

**Privacy/store gate**: `action`, `detail`, `kind`, `file_count`, `error_code` are all already in `ALLOWED_CONTEXT_KEYS` **and** in the Lambda's pinned mirror. Nothing is added, so no store data-collection declaration changes and no telemetry deploy is required.

## Acceptance Criteria

- [ ] **Commit A lands with `useSharedDocumentIngest.test.ts` showing a ZERO diff.** This is the gate on the whole change.
- [ ] The quick-add card shows ONE magic-beans affordance; the three per-reader chips are gone
- [ ] A party-invite photo, a flight-booking PDF and a recipe photo each land in the correct reader with no type chosen
- [ ] Pasted text and a pasted link reach the same readers as the equivalent share, through the SAME `sourceFromText` peek and the SAME `read()` consume
- [ ] Every `shareTarget.*` string reachable from `withIngestLock` / `runIngest` reads source-neutrally — `busy` included, verified by reading them, not by assuming
- [ ] `none` produces a specific message; never a blank review modal, never a silent no-op
- [ ] An over-size file and an unreadable file get DIFFERENT messages (the size one names 25 MB), and neither is silent
- [ ] A BYOK member with no key gets the `ai.unavailable` message **before** any consent prompt, via the same `notReady` site the share path uses
- [ ] Nothing is persisted without confirmation in the review modal, for all four sources
- [ ] Consent is prompted exactly ONCE per capture
- [ ] Routing exists once: both entry points resolve a verdict through `classify` + `readerForShareKind`
- [ ] The camera is reachable on iOS/Android via the explicit button (image-only + `capture`), including after the app is backgrounded by the camera
- [ ] A member without `canEditActivities` sees no card, exactly as today
- [ ] The paste field is not covered by the keyboard on a phone, with NO viewport code in this change
- [ ] The reading overlay appears for every in-app source, with no new overlay component
- [ ] Closing or dismissing at any point leaves no body-scroll lock and no stuck overlay: the FAB still opens the quick-add sheet afterwards
- [ ] `openPhotoReader` / `openRecipeReader` are gone, nothing references them, and `useMagicReader.test.ts` still covers `openReader`'s replace-vs-push discipline and all four `consumePendingMagic` cases
- [ ] All four orphaned keys are gone; `ai.picker.orFrom` is used by both callers
- [ ] No Help Center article names a chip that no longer exists (`security.ts:650`, `the-pod.ts:553` specifically)
- [ ] Every event on a share run carries `surface: 'share-target-ingest'`; every event on an in-app run carries `surface: 'magic-beans-capture'` — asserted by test, not by inspection
- [ ] CloudWatch answers, filtering on `surface` alone: how many in-app captures ran, which source, what the AI decided, how many reached review
- [ ] **No new key in `ALLOWED_CONTEXT_KEYS`, and no telemetry-Lambda deploy needed**
- [ ] `type-check`, `lint`, `lint:style`, `format:check`, `test` clean; `npm run build` clean (the import graph gains a `MagicReaderCard → MagicBeansSheet → BeanieFormModal` edge); E2E green

## Testing Plan

1. **Commit A gate**: `git diff --exit-code src/composables/__tests__/useSharedDocumentIngest.test.ts` after Commit A. Do not start Commit B until this and the suite are both green.
2. **Unit — surface invariant (both directions)**: capture every `logEvent` across a full share run and assert all carry `share-target-ingest`; the same for a full in-app run against `magic-beans-capture`. This is what pins the threaded sites and what makes the exact count irrelevant.
3. **Unit — `ingestInAppSource`** (additive `describe` in the existing suite, reusing its fixtures): a file produces `{ kind: 'documents' }` with the sniffed type; an over-cap file is refused with the SIZE message and no AI call; an unreadable type is refused with the type message; a BYOK-no-key member is refused before consent; a pasted link and pasted prose reach `sourceFromText` and produce `link` / `text`; a paste under `MIN_SHARE_TEXT_CHARS` is refused with source-neutral copy; a second capture while one is in flight is refused audibly; a throw is reported and toasted, never swallowed.
4. **Unit — env threading**: `runIngest` receives the right `IngestEnv` from each entry point; `ResultEnvelope.origin` is `'in-app'` on the in-app path and still `'share'` on the share path, **including the `jsonld` and `titleOnly` payload branches** (two of the four `origin` literals a `classify`-only test would miss).
5. **Unit — `useRecipeCapture`**: an `origin: 'in-app'` delivery logs `capture started` with `detail: 'in-app'`. This is the assertion that would have caught the `=== 'share'` trap.
6. **Unit — `useMagicReader`**: the re-pointed suite still asserts replace-vs-push, already-on-route, and all four `consumePendingMagic` cases; the two `reportError`s carry `detail: origin`.
7. **Component — `MagicBeansSheet`**: the field is focused on open; `AiSourceButtons` is rendered; camera calls `pickCamera` and file calls `pickFile`; every one of the three actions closes the sheet BEFORE calling the ingest (assert call order); save is disabled on an empty field; strings route through `t()`.
8. **Component — `MagicReaderCard`**: one button, no chips; hidden entirely when `canReadAny` is false; the picker and the sheet are mounted.
9. **Component — `RecipeLinkModal`**: unchanged behaviour after the `AiSourceButtons` extraction — its existing test must pass with at most a selector update.
10. **Manual, per platform**: web, PWA, iOS, Android — each of the four sources, plus a `none` verdict, a member without `canEditActivities`, the keyboard-over-field check on a real phone, the leaked-overlay check (capture → review → back → FAB still opens), and **the camera-backgrounding check**.
11. **Screenshots, and look at them.** The card and the sheet, phone and tablet widths, light and dark.
12. **`/code-review max`** over the implementation, then fix what it finds.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup; identified the orchestrator split at `prepare` as the one structural idea, and #83 as a hard build-order prerequisite.
- **Pass 2 (DRY + error handling)**: Five duplications removed before they were written — the sheet is `BeanieFormModal variant="drawer" layer="overlay"` rather than a new primitive; `AiDocumentPicker` needs no change; the divider+duo is extracted to one `AiSourceButtons`; the in-app entry point is a function beside `ingestSharedContent`; the text policy is #83's. The `origin` telemetry key was dropped in favour of parameterising `surface`, removing six file edits, a pinned-mirror drift test and a Lambda deploy. Three latent silent failures were given owners.
- **Pass 3 (Sustainability / maintainability / reliability)**: Reversed the shape requirement handed back to #83, having verified its band decision depends on an `overCeiling` flag derived from `File.size` before decoding. Sized the refactor honestly for the first time (20 surface sites, 4 `origin` literals — not the "already source-agnostic" tail Pass 2 assumed) and added the scope table. Introduced the two-commit sequence, the surface-invariant test and the recorded rejected alternative. Closed three reliability gaps: `logReceivedKind` leaking onto the share funnel, the skipped `isConfigured` check, and `AiDocumentPicker` mounted inside a modal.
- **Pass 4 (Fresh-eyes sweep)**: Eight factual corrections, all verified. **New string needed** — the "file too large" pair does not exist (`AI_PICKER_MAX_BYTES` has no copy), so "two existing string pairs" was wrong. **Missing file** — `useMagicReader.test.ts` drives ~10 tests off `openPhotoReader`, including all four `consumePendingMagic` cases and the replace-vs-push test; deleting the function silently deletes `openReader`'s coverage unless they are re-pointed. **Copy bug this plan creates today** — the constraint was scoped to #83's unbuilt `shareTarget.text.*`, but the already-shipped `shareTarget.busy.message` says "the last thing you **shared**" and §1 deliberately puts the in-app path behind that guard; every `shareTarget.*` string on the shared spine was audited and only `busy` needs rewording. **Help Center was wrong** — there is no magic-beans article in `features.ts`; it is `security.ts:634`, and two shipped articles name deleted chips by name (`security.ts:650`, `the-pod.ts:553`). **Orphan strings under-counted** — four keys lose their only consumer, not one (`recipeExtract.chip.title` is referenced solely by `MagicReaderCard`). **`notReady()` cannot be reused as the table had it** (it hardcodes both `SURFACE` and its message), so it takes `env` too — a sixth row in the scope table. **`canReadAny === canEditActivities` unconditionally**, because the recipe gate is ungated; the flags never entered into it. **Every count is pre-#83** and #83 explicitly changes all of them _including the gating suite_, so the "49 tests pass unedited" criterion was unmeetable as written and is now a zero-diff check plus a mandatory recount as build-time step 0. Decided the one policy question #83 hands down (`MIN_SHARE_TEXT_CHARS` applies in-app too — one policy, neutral copy). **Cut as ceremony**: the 720-line file-size ceiling (a stale number; the "next split is `prepare`/`read` into `share/`" guidance was kept), two of the five complexity-budget bullets (restatements of §4 and of an existing COPY RULE), the §7 "what the AI decides" section (a restatement of the user story with no implementation content), and the nine-item Assumptions list, folded into an eight-item build-time verification checklist since none of them were assumptions — they were things to re-check.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (via `/beanies-pre-plan #84`, then `/beanies-plan`)

> now let's move on to /beanies-pre-plan #84

Notion tracker row #84 — "one magic-beans button": collapse the quick-add "Magic beans" card's three per-reader chips (📸 Invite / ✈️ Travel booking / 🍳 Recipe) into ONE button that accepts four sources (take a photo, choose a file, paste text, paste a link) and lets the AI decide what the content IS.

### Follow-up 1 — dev flags + counter question (AskUserQuestion)

> once a feature is released to prod the dv flags can be ignored - assume they are always enabled

Selected: **One shared counter (recommended)**.

### Follow-up 2

> once the pre-plan is complete go ahead to /beanies-plan to start the planning

### Follow-up 3

> can you add the mockup as a claude artifact pls

### Follow-up 4 — mockup direction

> let's go with B

### Follow-up 5 — build sequencing (AskUserQuestion)

Selected: **Plan #84 whole, build after #83 (recommended)**.

</details>
