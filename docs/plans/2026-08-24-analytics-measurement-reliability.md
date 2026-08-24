# Plan: Analytics measurement reliability — bounce rate, feature coverage, and the signup-goal gap

> Date: 2026-08-24
> Related issues: Beanies tracker #71 (Notion). **No GitHub issue** — direct implementation.
> Plan file: `docs/plans/2026-08-24-analytics-measurement-reliability.md`

## User Story

As the person deciding where to spend the next month of effort, I want beanies' own analytics to report numbers I can act on, so that "which features do families actually use" and "how many visitors become families" are answered by measurement rather than by guesswork.

## Context

Three defects compound to make the founder-metrics dashboard untrustworthy. All figures are live queries run 2026-08-23 over the trailing 30 days.

**1. Bounce rate is structurally meaningless.** Plausible counts ANY custom event as engagement unless sent with `interactive: false`. The marketing site's Web Vitals RUM script fires CWV events on every page load — 122 of 133 visitors emitted `CWV FCP` — so essentially no session could ever be a bounce, and the site reports **1% bounce at 1.7 pages/visit**. The app site has the same defect in milder form (30%) via `storage_persist_denied` (fires on boot, 43 of 143 visitors), `install_nudge_shown`, `community_nudge_shown` and `pwa_stale_detected`.

**Verified 2026-08-24: `5df0fe0c` already fixes this completely.** It tagged all five CWV metrics plus those four app events, and added `interactive` to the `PlausibleQueue` type. I enumerated every event the app fires (**17 distinct events across 27 call sites in 13 files**) and checked each; the only non-obvious case is `login`, whose **five** emit sites (`authStore.ts:626, 871, 1078, 1138, 1174`) are all inside user-initiated functions — `signIn`, post-`signUp`, post-`member_joined`, `signInWithPasskey`, `createSessionForVerifiedMember` — so it is correctly interactive. **Nothing was missed.** Scope item 1 therefore needs no new tagging — it needs a guard so the next auto-fired event cannot silently regress it.

**2. Feature adoption measures 4 of ~20 features.** `feature_used` is emitted by only `transactionsStore`, `budgetStore`, `goalsStore` and `vacationStore`. `/activities` is the 2nd most-visited app page (58 visitors) and emits nothing; `/lists` and `/todo` (25 each) emit nothing; `/accounts` (11) emits nothing. Meanwhile `/transactions` with 10 visitors appears as the "top feature" at 7 families. **The ranking is inverted against actual usage.**

**3. The signup goal disagrees with the registry by 2.1×** — 8 goal fires vs 17 registry families. **Root-caused 2026-08-23 s2: the native apps never load Plausible at all.** `VITE_PLAUSIBLE_DOMAIN` is set only in `deploy.yml`; both mobile lanes omit it behind an explicit exemption in `workflowEnvParity.test.ts:39,42`. `features.analytics = ok(env.VITE_PLAUSIBLE_DOMAIN)` (`features.ts:75`) is therefore false natively, `initAnalytics()` returns immediately, `window.plausible` is never installed, and every call short-circuits. `VITE_REGISTRY_API_*` **is** set on all three lanes. So a family created in the iOS or Android app writes a DynamoDB row and fires no `signup`. Android is on Play production — live, not theoretical.

Ruled out: `member_joined` inflating the registry (`pull_registry.mjs` scans one row per _family_); demo mode (suppresses Plausible via `withAnalyticsSuppressed` **and** the registry write via `suppressRemoteSideEffects`); a mis-placed trigger (`signup` fires unconditionally at `authStore.ts:870`). The gap is **larger** than 9: `signup` fires at account creation while the registry row is written later at file creation, so an abandoned signup pushes Plausible _up_. Ad blockers push it down.

**greg's decision (2026-08-23 s2): close the gap.** Send events from native exactly as the web does. App usage is equivalent to web usage; installing the app is as much a conversion as installing the PWA; measurement belongs in one place; and uniform lanes remove a permanent exemption someone has to remember.

### The unifying observation

`src/services/analytics/plausible.ts:52-58` says it plainly: _"Every analytics call site in the app is a bare `window.plausible?.('event')` — there is no central `track()` wrapper to gate."_ That absence is why all three defects exist in the shape they do:

- an auto-fired event can be added with no `interactive: false` and nothing notices (defect 1);
- adding coverage means hand-copying the same line a 5th through 21st time (defect 2);
- there is no single place to attach a platform prop (defect 3);
- and suppression has to swap a global, because there is nothing else to intercept.

**One `track()` seam addresses the cause of all four.** That is the spine of this plan.

## Requirements

1. **One analytics seam.** A single `track()` in `plausible.ts` that every app-side call site routes through. Bare `window.plausible?.()` calls in `src/` are retired, tests included.
2. **Passive events cannot silently regress.** Interactivity is declared once in the `EVENTS` record and derived from it — no call site can contradict it — and a test asserts that record directly (not a derived set, which would re-create the second registry Step 1 exists to remove).
3. **Native apps report to Plausible.** `VITE_PLAUSIBLE_DOMAIN` on both **release** lanes; the `workflowEnvParity` exemption deleted so silent drift fails CI.
4. **Every event carries a platform** (`web` | `ios` | `android`), attached centrally by the seam — never hand-passed.
5. **The registry row carries the signup platform, write-once** — client, Lambda and type. Separate from (4): `gapIsMaterial` compares against _registry_ rows.
6. **Conversion is two labelled numbers, not a range.** Marketing-funnel = **web-only** signups ÷ marketing visitors; total signups = all platforms.
7. **`gapIsMaterial` compares like with like** — the Plausible goal against **web-only** registry rows.
8. **`feature_used` covers every store with a user-facing create action**, emitted from one place rather than 21.
9. **`feature_used` never fires on programmatic, seed, or non-user-initiated writes.**
10. **Store data-collection declarations ship in the same change.**
11. **All three series breaks are documented** — bounce rate; the app property's arrivals/pages/bounce/`inAppPct`; and **`conversion.overallPct`**, which changes both definition and population on the same deploy and is the most-looked-at number on the dashboard.

## Important Notes & Caveats

- **Scope item 1 is verification, not new tagging.** `5df0fe0c` is complete (see Context). Add the regression guard; do not re-tag.
- **DO NOT DEPLOY.** Both web and app deploys are held until the #70 recurrence fix-review passes (greg, 2026-08-23 s2). The deploy is a separate, explicitly-instructed step.
- **⚠️ iOS serves over `capacitor://`, NOT https.** `capacitor.config.ts:22-25` sets `androidScheme: 'https'` + `hostname: 'app.beanies.family'`, but the comment at `:13-21` is explicit: `iosScheme: 'https'` is **silently ignored** (WKWebView reserves `https`), so _"the iOS origin therefore IS and must stay `capacitor://app.beanies.family` — the comment above describes ANDROID only… Tried and reverted in build 8."_
  **Consequence and pre-decided fallback:** Android pageviews will look identical to the PWA. iOS pageview autocapture under a non-HTTP protocol is **unverified** — confirm on a real iOS build that the tracker sends at all and records a sane path. **If it does not, ship anyway with pageview autocapture disabled on iOS**: every requirement in this plan is satisfied by the _custom_ events (`signup`, `feature_used`), which do not depend on the origin scheme. Do not block the plan on this.
- **Historical data cannot be corrected retroactively.** The deploy date is a series break for bounce rate, for the app property's `visitors`/`topPages`/`bounce_rate`/`inAppPct` (native pageviews start landing mid-series), **and for `conversion.overallPct`**, which changes definition AND population at the same instant. The coverage guard belongs on the REGISTRY-derived figures, not on `overallPct` — under Step 6 that number is Plausible-only with absent ⇒ web, so it is never depressed. See Step 6's `gapIsMaterial` coverage gate.
- **The `*_dismissed` events must STAY interactive.** Dismissing a nudge is a genuine click.
- **Two Plausible properties, not interchangeable**: marketing `pa-3pxexgz2YF03NyMDucQKN` (`BaseLayout.astro:113`), app `pa-jvjpzIr6FM9tDKaS1gZaK` (`deploy.yml:187`). `signup` fires from `authStore` — the **app** property — and `build_dashboard.mjs` already divides it by **marketing** visitors. Legitimate as a funnel metric, but it means adding native to the numerator without a platform split would inflate it. Requirement 6 is not optional.
- **The marketing site is out of the seam's scope.** `web/` is a separate Astro build with its own inline snippet and property. Leave `vitals.ts` as `5df0fe0c` left it.
- **`withAnalyticsSuppressed` must keep working.** Demo seeding drives the real sign-up flow and would otherwise push fake conversions on every reviewer tap. Its `delete window.plausible` restore-absence behaviour is load-bearing — read that docblock before touching it. **Do not re-plumb it in this plan**; note the opportunity and move on.
- **Debug lanes must NOT get the var.** `mobile-android-build.yml` / `mobile-ios-build.yml` carry 12 `VITE_` vars each and are _not_ covered by the parity test (`workflowEnvParity.test.ts:57` loops only the two release lanes). Dev builds must not pollute the production property — a deliberate, documented asymmetry.
- **No feature gate** — ship ungated.

## Assumptions

> **Review before implementation.** Valid at planning time (2026-08-24).

1. **Verified.** All 17 named stores exist and none emit `feature_used`; the four that do inline a raw call (`transactionsStore:501`, `budgetStore:249`, `vacationStore:176`, `goalsStore:129`).
2. **Verified.** `5df0fe0c` covers every auto-fired event; `login`'s three sites are user-initiated.
3. **Verified.** The registry entry carries no platform field today, on client _or_ Lambda.
4. **Verified — no secret plumbing needed.** `deploy.yml:187` is a plain literal (`VITE_PLAUSIBLE_DOMAIN: jvjpzIr6FM9tDKaS1gZaK`), not a `secrets.*` reference. Copy the literal into both release lanes, replacing the `# NOTE: … intentionally omitted` comments (`mobile-android-release.yml:138`, `mobile-ios-release.yml:119`).
5. Plausible accepts a custom prop on the `signup` event; breaking the goal down by it is a Stats API query change, not a Plausible dashboard change — and the exact query shape already exists (see Step 6).
6. **Verified on the READ side only.** `pull_registry.mjs:148-155` uses `row.x || null` throughout, so absent fields are tolerated. **The WRITE side is not** — see Step 4.

## Approach

### Step 1 — The `track()` seam (foundation)

In `src/services/analytics/plausible.ts`:

**ONE registry, not two.** A union plus a separate `PASSIVE_EVENTS` set means adding an event takes two edits and only one is compiler-enforced — so the exact failure Requirement 2 exists to prevent just moves from "forgot a flag" to "forgot a Set entry", and the membership test can never assert that a _new_ union member was classified at all. Use a single const record instead:

```ts
const EVENTS = {
  signup: 'interactive', // CONSUMED by the dashboard — see below
  login: 'interactive', // CONSUMED by the dashboard
  feature_used: 'interactive', // CONSUMED by the dashboard
  storage_persist_denied: 'passive',
  install_nudge_shown: 'passive',
  community_nudge_shown: 'passive',
  pwa_stale_detected: 'passive',
  // …the remaining 10
} as const;
export type AnalyticsEvent = keyof typeof EVENTS;

/** Bounded prop KEYS (values stay free-form) so Plausible's namespace can't sprawl. */
type PropKey = 'feature' | 'method' | 'action' | 'surface' | 'platform';

// `platform` is EXCLUDED from the public signature — the seam adds it, and
// Requirement 4 says no call site passes it by hand. Make that structural, not
// a convention someone can quietly break.
export function track(
  event: AnalyticsEvent,
  opts?: { props?: Partial<Record<Exclude<PropKey, 'platform'>, string>> }
): void;
```

Now the type system makes it structurally impossible to add an event without declaring its interactivity, `PASSIVE_EVENTS` is derived, and Step 2's test is a cheap snapshot of one object. It is also one thing to read and one thing to delete.

**Three events are a cross-repo contract.** `signup`, `login` and `feature_used` are consumed by `query_plausible.mjs:229-243` and `build_dashboard.mjs:155-157`; renaming or deleting one silently blanks a dashboard panel with no error anywhere. The comments above are the cheap guard — record the same list in `references/data-sources.md` (Step 7 already opens that file).

- **Platform, centrally.** Call `getPlatform()` per event inside the try/catch — **do not memoize.** `Capacitor.getPlatform()` is a synchronous property read, so a module-level cache saves nothing measurable while adding hidden mutable module state that breaks Testing-Plan item 1: mocking web/ios/android in one file would read the cached first value unless every case does `vi.resetModules()` + dynamic import. Use `getPlatform()` from `src/services/sync/capabilities.ts:51` — it already returns exactly `'web' | 'ios' | 'android'`, so no mapping is needed. **Not `isNativePlatform()`, which does not exist**; `capabilities.ts:37-45` declares itself the one place `Capacitor.isNativePlatform()` may appear (ADR-029). Wrap the call in try/catch with a `'web'` fallback, mirroring `src/utils/platformLabel.ts:22-32`, which exists for exactly this reason.
- **`interactive` is NOT a parameter.** It is derived solely from `PASSIVE_EVENTS`. This is the point of Requirement 2: if the flag stayed passable, a call site could contradict the set and the membership test would be blind to it. The four sites currently passing it by hand (`App.vue:908`, `useInstallNudge.ts:109`, `useStalePwaNotice.ts:38`, `useCommunityNudge.ts:173`) each drop the argument.
- **⚠️ `plausible.d.ts` is an AMBIENT GLOBAL script file** — it has no `import` and no `export`, which is the only reason `interface Window { plausible?: PlausibleQueue }` (`:19-21`) augments the real global `Window`. Declaring an options interface there is fine; adding the `export` keyword to it — the reflexive move when another module wants to import it — **silently converts the file to a module and every `window.plausible` reference in the codebase loses its type.** Declare the shape in `plausible.ts` instead, or keep it ambient and unexported.
- **⚠️ Suppress the review-demo session.** `features.ts:67` arms `reviewDemo` on EXACTLY the two mobile release lanes Step 3 now gives the production Plausible property. `withAnalyticsSuppressed` covers only the _seeding_; everything an App Store or Play reviewer does **after** the seed — every create in the demo pod — would fire `feature_used` and pageviews into the app property, against the 17-family baseline where this plan already argues one person is material. One line at the top of `track()`, using the predicate that already exists with precedent (`src/utils/reviewDemo.ts:138`, used at `syncStore.ts:3027`):
  ```ts
  if (isDemoSession.value) return;
  ```
  This also narrows `withAnalyticsSuppressed` to the one thing it is genuinely load-bearing for.
- **Never throws.** try/catch + `console.warn` with the `[analytics]` prefix, matching `initAnalytics`. Do **not** toast — `plausible.ts:7-9` is explicit that users are never told about analytics failures.

Then migrate all 27 call sites across the 13 files. This makes the union type the single registry of what the app reports.

**Three docblocks become false in this step and must be corrected in the same change** — leaving them is exactly the drift `docs/lessons.md` keeps punishing:

- `plausible.ts:52-58` ("there is no central `track()` wrapper to gate") — falsified by this step.
- `plausible.ts:78-87` (`withAnalyticsSuppressed`'s "…the case on BOTH mobile release lanes, where it is an explicit exemption") — falsified by Step 3. The `delete` behaviour is still load-bearing for self-host and dev builds; re-ground the justification on those.
- `plausible.test.ts:103-106` repeats the same stale claim.

### Step 2 — Passive-event regression guard

`PASSIVE_EVENTS` (Step 1) _is_ the guard. Add a test asserting its exact membership — the four auto-fired events, and that no `*_dismissed` event is a member. Today, forgetting the flag silently corrupts bounce rate; after this, an auto-fired event is non-interactive unless someone deliberately adds it to the set, and the test forces them to notice.

### Step 3 — Native release lanes

- Add `VITE_PLAUSIBLE_DOMAIN` (the literal from `deploy.yml:187`) to `mobile-ios-release.yml` and `mobile-android-release.yml`, replacing the `# NOTE: … intentionally omitted` comments.
- **Delete** the exemption entries at `workflowEnvParity.test.ts:39,42`, reducing `EXEMPT` to `{}`. **Keep its docblock (`:33-36`) and the `!(v in exempt)` clause** — the mechanism is the point; the exemption is what's being retired.
- **Do not touch the debug lanes** (see Caveats).
- **Post-deploy: exclude your own app traffic.** `plausible_ignore` is a per-ORIGIN `localStorage` flag (`src/pages/PlausibleExcludePage.vue:13-17`, route at `router/index.ts:301`), and an installed iOS/Android app is a separate storage origin from the browser. So greg's own production-app usage would count as a visitor — and, if he creates a pod, a signup — against a 17-family dataset where one person is material. Run `/plausible-exclude` **inside each installed app** after the deploy, and note the limitation in `data-sources.md`.

### Step 4 — Signup platform on the registry (three places, or it silently no-ops)

**The Lambda whitelists fields.** `infrastructure/lambda/registry/index.mjs:157-202` builds the persisted `item` as an explicit field list and PUTs it with `marshall(item, { removeUndefinedValues: true })`. A `platform` on the client payload is **discarded with no error on either end** — Requirements 5 and 7 would read `unknown` forever. All three of these are required:

0. **Vocabulary — use ONE.** `capabilities.getPlatform()` returns `'web' | 'ios' | 'android'`; `src/utils/platformLabel.ts:14-31` returns `'app' | 'pwa' | 'web'` and already feeds the new-joiner Slack ping. Use `getPlatform()` for both Plausible and the registry, and add a one-line cross-reference in **both** docblocks (`platformLabel.ts`: "coarse Slack-only bucket; the analytics/registry vocabulary is `getPlatform()`", and the inverse on `RegistryEntry.signupPlatform`). Otherwise a third vocabulary appears in six months.
1. **Lambda** — add the field, stamped **at row CREATION only**, and **validate the value**.
   ⚠️ The plain write-once idiom (`existing.x ?? body.x`) is WRONG here. The Lambda's own comment at `:82-84` says it: _"registerFamily() fires on every sync-config change, so only the first write should stamp these."_ `existing.signupPlatform` is undefined for all 17 pre-existing rows, so that idiom would stamp each of them with whichever device wrote next — a family created on iOS in June becomes `web` the first time its owner opens a browser. That silently contradicts this plan's own "absent ⇒ unknown, excluded" rule, on exactly the rows that cannot be verified. Key off the row's existence instead (the Lambda already reads `existingRaw` at `:86`), which is what makes the NAME `signupPlatform` true:
   ```js
   signupPlatform: existingRaw ? (existing.signupPlatform ?? null) : (validPlatform(body.signupPlatform) ?? null),
   ```
   And validate: every other body-sourced field is type-guarded (`typeof body.country === 'string'` `:189`; the `beanpodSizeKb` number guard `:196-199`). This one is client-supplied AND permanent, so an unguarded value persists forever. `const SIGNUP_PLATFORMS = new Set(['web','ios','android'])`; anything else → `null`. Write-once is mandatory, not stylistic: `registerCurrentFamily` fires on _every_ login and config write (`syncStore.ts:4021-4041`), so last-writer-wins would relabel an iOS-created family as `web` the first time its owner opened a browser. The name `signupPlatform` states the intent.
2. **Client** — `syncStore.ts` has **two** near-identical payload sites (`_registerCurrentFamilySync:1490-1501` and `registerCurrentFamily:4029-4041`). **Extract `buildRegistryPayload({ overrides, isLoginEvent })` → payload object** and add the field there once. **The extraction returns the payload and nothing else**: the two sites also differ in calling `registerFamilyOrThrow` vs `registerFamily`, and that throw/no-throw choice carries a load-bearing invariant documented at `syncStore.ts:1486-1489`. Folding the call into the helper would turn that invariant into a boolean parameter — each caller keeps its own `registry.*` call.
3. **Type** — `RegistryEntry` in `src/types/models.ts:1716-1733`.

Plus a test asserting a second PUT from a different platform does **not** move the field, AND that a pre-existing row is never stamped retroactively.
**Runner matters:** extend the existing **vitest-authored** `infrastructure/lambda/registry/index.test.mjs` — it runs under `npm run test`, NOT `npm run test:lambda`, whose glob covers only `telemetry|ai-extract|oauth` (`package.json`). A `node:test`-style file here would either never run or break the gate (`vitest.config.ts` warns about exactly this).

**Declined, deliberately:** extracting `writeOnce()` / `preserveOnOmit()` helpers from the Lambda's item builder. It genuinely is at its complexity ceiling — six hand-rolled merge idioms across 45 lines (`:157-202`), and `signupPlatform` makes seven — but the Lambda deploys on its own cadence and cannot be rolled back in lockstep with the client. Refactoring six live merge behaviours in the same change that adds a new field widens the blast radius of the one component here with an independent, non-atomic deploy. Add the field using the existing inline `writeOnce` idiom; file the refactor as a follow-up.

**Absent = `unknown`, and `unknown` is EXCLUDED from web-only denominators — never assumed web.** Assuming web would re-introduce the exact inflation this fixes, on precisely the historical rows we cannot verify.

### Step 5 — `feature_used` coverage, from one place

**Do NOT put this inside `wrapAsync`.** An earlier draft did; it is the wrong seam for four reasons:

1. `wrapAsync` owns exactly three things — loading state, error state, and the toast/`reportError` policy (`useStoreActions.ts:53-102`) — and it has **111 call sites**. Adding a `feature?` option makes every future store-action author consider a product-analytics question inside an options bag whose docblock is about wasm engine panics, and drags `plausible → capabilities → @capacitor/core` into every store's module graph and unit tests.
2. **It structurally cannot express Requirement 9.** `familyStore.createMember` (`:224`) is called from the signup path (`authStore.ts:700-701`) AND onboarding AND the Meet-the-Beans page; the right answer is "emit from the user-initiated caller." A `wrapAsync` option attaches the feature to the _action definition_, not the _invocation_, so the first multi-caller store forces a per-call escape hatch and the "one word in an options object" collapses back into conditionals inside a shared helper.
3. **The DRY win is near zero** — it converts 21 one-line calls into 21 options entries. The only genuine win is the repeated `if (result)` guard.
4. **It silently changes the success predicate** from truthiness (what the existing four use) to "did not throw", which differs for any action returning `void`/`false`.

**Instead: a one-line pass-through in `plausible.ts`.**

```ts
export function trackFeature<T>(result: T, feature: FeatureName): T {
  if (result !== undefined && result !== null) track('feature_used', { props: { feature } });
  return result;
}
```

Call site: `return trackFeature(await wrapAsync(isLoading, error, fn, { action: 'goalsStore:createGoal' }), 'goal');`

The guard lives in one place (fire-on-failure stays structurally impossible), the event shape lives in one place, `wrapAsync` stays single-purpose, it is greppable and deletable in one `git grep trackFeature`, and — decisively — it works at the **caller**, which is exactly what `createMember` and the non-`wrapAsync` `photoStore.addPhoto` (`:303`) need. `FeatureName` lives in `plausible.ts` beside `AnalyticsEvent`.

**The feature vocabulary is CURATED and decided here, not deferred.** "Every store with a create action" would be ~21 values in a ranked list nobody reads; the dashboard question is "which surfaces do families use", which is roughly the nav. Ship exactly these 16:

- **Unchanged** (keeps the historical series continuous): `transaction`, `budget`, `vacation`, `goal`
- **Added**: `activity`, `list`, `todo`, `meal_plan`, `recipe`, `account`, `asset`, `milestone`, `photo`, `medication`, `emergency_contact`, `saying`
- **Deliberately excluded**: `family_member` — `createMember` fires on the signup path, so it would read as ~100% adoption and **re-invert the very ranking this plan exists to fix**. Also `allergy`, `member_note`, `favorite` — low-signal sub-features of surfaces already counted.

**`photo` emits at `usePhotos.add` (`src/composables/usePhotos.ts`), NOT in the store.** `photoStore.addPhoto:303` throws on failure and is reachable from non-user paths; the composable is the user-initiated caller. This is Step 5's own "it works at the caller" argument — state it so the implementer doesn't put it in the store.

**Every target create action returns `X | null`**, so `trackFeature`'s `!= null` guard is exact. Worth stating because the deliberately-excluded `listStore.addItem:295` returns `FamilyList | null` too and is indistinguishable at the call site — the exclusion is a decision, not something the types will enforce.

**Multi-create disambiguation (decided):** `listStore` — `createList` and `createFromTemplate` both count; `addItem` does **not** (item-level, not adoption). `recipesStore` — `createRecipe` only, not `createCookLog`. `medicationsStore` — `createMedication` only, not `createMedicationLog`.

**Requirement 9 is already satisfied architecturally — verify, don't rebuild.** `seedDocument` deliberately bypasses the stores and says so in its docblock; `demoSeed` suppresses analytics. A test already exists: `demoSeed.test.ts:177` (_"emits no Plausible events, and leaves window.plausible as it found it"_). **Extend that assertion** to also fire a `feature_used` inside the mocked `signUp` — do not add a second test. It only proves something if the mock fires through the real `track()`/`trackFeature`: the existing mock (`demoSeed.test.ts:180-182`) calls `window.plausible?.()` directly, which would bypass the seam entirely.

### Step 6 — Dashboard: one honest headline, plus volume

- **The query already has a template.** `build_dashboard.mjs:155-157` reads `pl.app.goals` via `goalV('Signup Completed')`, sourced from a `dimensions: ['event:goal']` query — which **cannot** be broken down by a prop. Add one query modelled exactly on the existing `feature_used` breakdown at `query_plausible.mjs:229-236`: `filters: [['is','event:name',['signup']]], dimensions: ['event:props:platform']`. Reuse the pattern; add no new machinery.

- **⚠️ VERIFY the goal and the event are the same population BEFORE dividing one by the other.** `completed` comes from a Plausible **dashboard-configured goal**, substring-matched (`build_dashboard.mjs:153-156,165`) — the goal→event mapping is Plausible-side config this repo cannot see. Direct evidence it is not 1:1: the sibling goal `Family Create - Button Clicked` has **no matching event name** in the app's 17-event census. So the new `filters:[['is','event:name',['signup']]]` query may return a different total from `goalV('Signup Completed')`, and the dashboard would show "N signups" beside a percentage computed off a different N. Run both, assert agreement; if they disagree, derive the **web SHARE** from the breakdown and apply it to the goal count (keeping numerator and displayed count consistent). Document the mapping in `data-sources.md`.

- **⚠️ THE ABSENT-PLATFORM RULE IS PER-SOURCE, and getting this wrong ships a visibly broken number.**
  - **Plausible: absent ⇒ WEB.** Defect 3's root cause is that native never loaded Plausible _at all_, so every historical `signup` goal fire is _provably_ web. Applying an "unknown ≠ web" rule here would dump the entire pre-deploy history into a `(none)` bucket and make the web-only headline read ≈0% for the first 30 days — indistinguishable from a regression.
  - **Registry: absent ⇒ UNKNOWN, excluded.** Here the rows genuinely cannot be attributed, and assuming web would re-introduce the exact inflation this fixes.
  - **`(none)` is a LITERAL bucket.** Pre-deploy `signup` events carry no prop, so Plausible returns them under the string `(none)`. Fold that row into `web` explicitly, and make sure `signupsByPlatform` never renders a `(none)` row — the array-driven template will happily print one.

- **ONE headline percentage, not two.** `build_dashboard.mjs:140-175` + `dashboard-template.html:450-462` already carry five conversion figures, one needing a full explanatory paragraph (`:452`). Adding a web-only/all-platform axis on top of the existing cross-site/single-site axis is a 2×2 the reader must hold, and two percentages invite "which one is real?" — precisely the confusion `overallPctUpperBound` created and this plan is deleting. So: **`conversion.overallPct` = web-only ÷ marketing visitors** is the single headline (the only like-for-like pairing), and total/native ship as a **volume** stat in the existing `convrow` (`dashboard-template.html:455-459`) — e.g. _"17 signups — 11 web, 6 native"_. Same information, one number to defend.

- **Emit the split as an array.** `conversion.signupsByPlatform = [{ platform, visitors }, …]`, looped in the template. Hardcoding `ios`/`android` branches into HTML makes the next platform (or a `(none)` bucket) an HTML edit.

- **Retire `overallPctUpperBound`** — one render site, `dashboard-template.html:459`. **And its prose tail at `:460`**, which offers _"or native app"_ as an explanation for the gap. Once native is measured that sentence is wrong and would send a reader off to re-diagnose a solved bug.

- **`actualNewFamilies` stays ALL-PLATFORM.** It renders as "families actually created (registry)" (`dashboard-template.html:457`) — a volume fact. An implementer following "web-only" mechanically would make it web-only too, and on the first post-deploy runs (when correctly NO in-window row carries a platform, per Step 4) that tile would read **0** while `gapIsMaterial` sat silently suppressed by its own `newInWindow > 0` guard (`build_dashboard.mjs:214,232`). Add a separate `newWebInWindow` for the gap maths and leave the volume alone.

- **Gate `gapIsMaterial` on platform COVERAGE.** Compute it only when the share of in-window registry rows carrying a platform exceeds a stated threshold; otherwise `null`, and render nothing. This is the real home for the "render `—` until coverage" idea, and it also answers the threshold question below — with a coverage gate, a firing flag means something again.

- **`gapIsMaterial` (`build_dashboard.mjs:231`) needs its threshold reconsidered, not just its inputs.** Restricting both sides to web-only roughly halves `n`, so the constant floor in `max(3, n * 0.34)` becomes the binding term at realistic monthly volumes — i.e. it fires on ordinary ad-blocker noise and becomes something to ignore, which is how a flag dies. Either raise the floor or state the expected trigger rate in `data-sources.md` so a firing flag still means something.

- **`inAppPct` and `funnelAcq` stay all-platform ONLY IF iOS autocapture works.** If the Caveat's pre-approved fallback fires (iOS pageviews off), iOS signups land in the NUMERATOR (`completed`, a custom event) with no iOS arrivals in the DENOMINATOR (`appArrivals`, a pageview count) — inflating the one metric `data-sources.md` calls the one to optimise against. So: if iOS autocapture is off, either exclude iOS from `completed` for `inAppPct` or render it `—`, and record which branch shipped. Same for `funnelAcq`'s app-arrivals step. Only `overallPct` goes web-only unconditionally.

### Step 7 — Store declarations + docs

**These gate a store submission and must land in the same change.** Native analytics is new data collection:

- `ios/App/App/PrivacyInfo.xcprivacy` (not the repo root) — Analytics / Product Interaction.
- ⚠️ `docs/runbooks/native-store-submission.md:60` currently ASSERTS _"no third-party analytics SDK in the app"_ — that sentence becomes false and must be **edited**, not just the table under it. State explicitly that **`NSPrivacyTracking` stays `false`** (Plausible is cookieless, no device identifiers, no cross-app linkage) so nobody flips it and drags App Tracking Transparency into the next submission.
- `web/src/pages/privacy.astro:56-70` and `:175` frame Plausible as _website_ analytics — **extend the existing wording** to cover the apps rather than bolting on a second section.
- The Play Data Safety answers; `web/src/pages/privacy.astro`; the data-collection table in `docs/runbooks/native-store-submission.md`.

And in `references/data-sources.md`: the platform split and what each conversion number means; that Plausible has **no offline queue** (CloudWatch has `logQueue.ts`), so native under-counts somewhat — far less than today's 100%; that the deploy date is a series break for the marketing bounce rate, the app property's arrivals/top pages/bounce/`inAppPct`, AND `conversion.overallPct`; the per-source absent-platform rule; the expected `gapIsMaterial` trigger rate; and the `plausible_ignore` per-origin caveat for installed apps.

### Sequencing

**The registry Lambda deploy is EXEMPT from the #70 deploy hold.** The hold covers the web and app bundles; the Lambda is an independent component with its own deploy, and it must precede the client or the first native signups write nothing and lose the field permanently. Say this explicitly so the implementer neither breaks the hold nor ships the client first.

**Step 6 (the dashboard) lives in `.claude/skills/` and is never deployed**, so it can land any time — but landing it before the client leaves every registry-derived web-only figure at 0. That is what the coverage gate is for.

**The registry Lambda (Step 4.1) must be deployed BEFORE the client ships**, or the first native signups write nothing and the field is permanently lost for those rows. Otherwise: Step 1 → 2 → 3 → 4 → 5 → 6 → 7, with 6 and 7 able to run alongside 5.

## Files Affected

**Modified — app**

- `src/services/analytics/plausible.ts` (`track`, `AnalyticsEvent`, `PASSIVE_EVENTS`, two stale docblocks), `src/services/analytics/plausible.test.ts` (co-located — **not** a new `__tests__/` file; also fix the stale comment at `:103-106`)
- `src/composables/useStoreActions.ts` — `feature?` on `WrapAsyncOptions`
- The 13 call-site files: `src/App.vue`, `src/stores/authStore.ts`, `src/pages/SettingsPage.vue`, `src/components/login/{WelcomeGate,InviteGateOverlay}.vue`, `src/composables/{useInstallNudge,useCommunityNudge,useStalePwaNotice}.ts`, `src/utils/discord.ts`, and the four existing `feature_used` stores
- The stores gaining `feature_used` (see Step 5's caveats)
- `src/stores/syncStore.ts` — extract `buildRegistryPayload`, add `signupPlatform`
- `src/types/models.ts` — `RegistryEntry`
- `src/config/features.ts` — add `['analytics', 'VITE_PLAUSIBLE_DOMAIN', …]` to the boot-warning array (see Observability)

**Modified — tests asserting exact plausible args** (these break once `platform` rides on every event): `src/components/login/__tests__/InviteGateOverlay.test.ts:53-55`, `WelcomeGate.test.ts`, `src/composables/__tests__/useCommunityNudge.test.ts`, `src/stores/transactionsStore.test.ts`, `src/services/demo/__tests__/demoSeed.test.ts`, `src/services/analytics/plausible.test.ts`

**Modified — infrastructure**

- `infrastructure/lambda/registry/index.mjs` + `index.test.mjs`

**Modified — build lanes**

- `.github/workflows/mobile-{ios,android}-release.yml`, `src/config/__tests__/workflowEnvParity.test.ts`

**Modified — dashboard skill**

- `scripts/{build_dashboard,query_plausible,pull_registry}.mjs`, `assets/dashboard-template.html`, `references/data-sources.md`

**Modified — compliance**

- `ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro`, `docs/runbooks/native-store-submission.md`

**All**: `docs/STATUS.md` + `CHANGELOG.md` on push.

## Observability Coverage

Analytics instrumentation is itself a diagnostic surface, so the bar is that a _silent stop_ is detectable.

- **Reuse the existing boot-warning mechanism first.** `src/config/features.ts:94-113` already has an array + loop that warns, on PROD cloud builds, when a feature is off because its env var is unset — created for exactly this class of bug (the comment at `:83-97` names the `feedbackReporter` incident that also produced the parity test). Add one entry: `['analytics', 'VITE_PLAUSIBLE_DOMAIN', 'Product analytics will be silently absent']`, and add the analytics line to the incident docblock at `:81-92`. **Rename the array in the same edit**: it is literally called `operationalWebhooks` (`:94`) and a Plausible domain is not a webhook — `operationalIntegrations` is one declaration and one loop. This plan polices exactly this kind of drift in Step 1; it should not create a fresh instance.
- **`logEvent({ level:'warn', surface:'analytics', message:'analytics-init', context:{ action } })` — the ANOMALOUS branch ONLY.** Do not log the `enabled` case: it would fire on every boot for every user, create a brand-new `analytics` surface that ranks near the top of `query_cloudwatch.sh`'s by-surface counts, and distort the report it feeds — and the healthy case is already proven by the Plausible data itself. Encode the platform in the already-allowed `action` key (`'disabled-no-domain:ios'` — six fixed values, no new `ALLOWED_CONTEXT_KEYS` entry), because without it the event cannot answer the question defect 3 posed. Note it fires from `main.ts` BEFORE Pinia is installed, so it carries no `family_id` — safe (`enrichAndRedact` is Pinia-tolerant) but worth knowing. **This is the event that would have caught defect 3 in a day rather than a month**: a native build reporting `disabled-no-domain` in CloudWatch is unmissable, where the current silent no-op was invisible for the entire life of the native apps. `console.warn` alone is invisible in production, which is why the remote signal is needed on top of the boot warning. Fires on both platforms — CloudWatch telemetry _is_ enabled natively.
- **`logEvent({ level:'warn', surface:'analytics', message:'track-failed', context:{ action } })`** — `track()`'s catch, `action` = the event name (fixed, low-cardinality). Answers "did we stop reporting, or did nobody use the feature?" — the exact ambiguity that made defect 2 hard to reason about. **Bounded**: `logEvent`'s limiter keys on `surface + normalizedMessage` (`logEvent.ts:85-86`), so every event shares ONE `analytics::track-failed` bucket at `RATE_MAX_PER_WINDOW = 50` (`:75`) — more conservative than per-surface, so a per-event warn cannot flood.
- **No new `ALLOWED_CONTEXT_KEYS` entries. Confirmed**: `action` is present at `src/utils/diagnosticContext.ts:68`. `surface: 'analytics'` satisfies the kebab-case/greppable rule (`CLAUDE.md`). No Lambda-mirror or store-declaration change is needed _for telemetry_ (Step 7's declarations are for Plausible itself).
- **No `severity: 'critical'`.** Nothing here risks user data or fails a user action — analytics is explicitly non-blocking.
- **No silent failures**: `track()` catches and reports; `initAnalytics` already catches; the registry write is part of an existing reported path.
- **No `perfTiming`** — `track()` is a fire-and-forget queue push far below `TELEMETRY_FLOOR_MS = 250`.
- **No i18n work by design** — this plan adds no user-facing string; analytics failures are never toasted (`plausible.ts:7-9`), so `uiStrings.ts` is knowingly untouched.

## Acceptance Criteria

- [ ] Every app-side analytics call goes through `track()`; no bare `window.plausible?.()` remains in **production** `src/`. Test files may touch the global **only where the global itself is the subject under test** — `plausible.test.ts:83-144` (which tests `withAnalyticsSuppressed`'s save/`delete`/restore, and would test nothing if routed through `track()`) and `demoSeed.test.ts:103,108` (which `delete window.plausible` as setup) are named exemptions — as is `plausible.ts` itself, which owns and installs the global.
- [ ] Every event carries a `platform` prop attached centrally via `getPlatform()` — no call site passes it by hand, and a `getPlatform()` throw cannot break a user action.
- [ ] `interactive` is not a `track()` parameter; interactivity derives solely from `PASSIVE_EVENTS`, whose exact membership is asserted. The `*_dismissed` events remain interactive.
- [ ] `VITE_PLAUSIBLE_DOMAIN` is on both **release** lanes; the `workflowEnvParity` exemption is deleted (`EXEMPT` = `{}`, mechanism intact); the **debug lanes do NOT carry it**.
- [ ] The registry Lambda persists `signupPlatform` **write-once**, proven by a Lambda test that a second PUT from a different platform does not move it; the client writes it from **one** extracted payload builder; `RegistryEntry` is typed.
- [ ] Rows without the field read `unknown` and are **excluded** from web-only denominators, never assumed web.
- [ ] `feature_used` is emitted from `wrapAsync`, not from 21 hand-written lines; it cannot fire on a failed action; `familyStore.createMember`'s signup/onboarding callers do not inflate adoption.
- [ ] The extended `demoSeed.test.ts:177` proves a seeded demo family emits no `feature_used`.
- [ ] The dashboard shows marketing-funnel conversion (web-only) and total signups (all platforms) as two distinctly labelled numbers; `overallPctUpperBound` and the 6.0–12.8% range are gone; `inAppPct`/`funnelAcq` remain all-platform.
- [ ] `gapIsMaterial` compares the goal against web-only registry rows.
- [ ] `ios/App/App/PrivacyInfo.xcprivacy`, Play Data Safety, `privacy.astro` and `native-store-submission.md` all declare analytics collection — in this change.
- [ ] `data-sources.md` documents the platform split, the offline-queue under-count, **all three series breaks**, the per-source absent-platform rule, and the installed-app `plausible_ignore` caveat.
- [ ] `features.ts`'s boot warning covers `analytics`; `analytics-init` and `track-failed` fire as specified.
- [ ] iOS pageview behaviour under `capacitor://` is checked on a real build, and the outcome (works / autocapture disabled) is recorded in `data-sources.md`.
- [ ] Absent platform is resolved **per source**: Plausible ⇒ web (native emitted nothing, by construction), registry ⇒ unknown and excluded. The web-only headline does not read ≈0% for the first post-deploy window.
- [ ] The dashboard shows **one** conversion percentage plus a signups-by-platform volume stat, emitted as an array rather than hardcoded platform branches; `overallPctUpperBound` **and its "or native app" prose at `dashboard-template.html:460`** are gone.
- [ ] `AnalyticsEvent` and interactivity come from **one** `EVENTS` record — it is impossible to add an event without declaring it.
- [ ] `feature_used` is emitted via `trackFeature` at the caller, **not** from `wrapAsync`; the curated 16-value `FeatureName` list is what ships; `family_member` is excluded.
- [ ] Type-check, lint, full suite (incl. `npm run test:lambda`) and `npm run build` green.

## Testing Plan

1. **`track()` unit tests** — platform attached for web/ios/android (mock `getPlatform`, the pattern already used at `src/utils/platformLabel.test.ts:20` and `passkeyService.test.ts:48-54`); a `PASSIVE_EVENTS` member is non-interactive and a non-member is interactive; a `getPlatform()` throw falls back to `'web'`; a throw inside `window.plausible` is caught and reported rather than propagating.
2. **`EVENTS` record snapshot** — asserts every event's declared interactivity, so an undeclared addition cannot compile and a mis-declared one fails the test. No `*_dismissed` event is passive.
3. **Workflow env-parity** — with the exemption gone, the test passes with the var on all three lanes. Proving the failure direction requires a **local edit-and-revert** (the test reads the real workflow files), so do it by hand and record it; a guard that cannot fail is not a guard (`docs/lessons.md`).
4. **Lambda write-once** — a second PUT with a different `signupPlatform` leaves the stored value unchanged.
5. **Suppression still works** — a `withAnalyticsSuppressed` block emits nothing through `track()`, and `window.plausible`'s ABSENCE is restored faithfully (the `delete` path), not replaced with a no-op.
6. **`feature_used` from `wrapAsync`** — fires on success, does **not** fire when the wrapped fn throws, and carries the platform. Plus the extended `demoSeed` assertion.
7. **Migrated arg-asserting tests** — the six files assert the platform-bearing shape (or `expect.objectContaining`), not the old exact args.
8. **Registry platform** — a new entry carries it; `pull_registry.mjs` surfaces it; an absent field reads `unknown` and is excluded from the web-only count rather than counted as web.
9. **Dashboard maths** — with a fixture of web + native signups, marketing-funnel conversion uses only web signups, total counts all, and `gapIsMaterial` is false when web-only goal and web-only registry agree despite a large native population. Pick fixture numbers where right and wrong answers differ (`docs/lessons.md`).
10. **Manual, post-deploy** — re-run `/early-adopter-metrics`; confirm believable bounce on both properties, an adoption ranking that matches page traffic, two labelled conversion numbers, and iOS events actually arriving.
11. `npm run build` + type-check + lint + `npm run translate` before pushing.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted around the observation that all three defects share one cause — the absence of a central `track()` seam — and verified before drafting that `5df0fe0c` already covers every auto-fired event (all app events enumerated; `login`'s three sites are user-initiated), reducing scope item 1 from re-tagging to a regression guard. Established that platform is needed on BOTH the Plausible goal and the registry row for different consumers, and that absent-platform rows must read `unknown` rather than be assumed web.
- **Pass 2 (DRY + error handling)**: Corrected three factual errors (the **iOS origin is `capacitor://`, not https** — `androidScheme` was generalised to both platforms; `isNativePlatform()` does not exist, it is `getPlatform()`; the plausible test file is co-located, so the plan added no new file); caught two silent-failure paths the plan would have shipped (the registry Lambda whitelists fields, so `platform` is dropped unless added there **write-once**, and only one of syncStore's two payload sites was named); replaced 21 hand-copied `feature_used` lines with an optional `feature` on the existing `wrapAsync` options — which also makes fire-on-failure impossible — and surfaced four call-site traps including `familyStore.createMember` firing on the signup path, which would have re-inverted the very ranking this plan fixes; folded `interactive` entirely into `PASSIVE_EVENTS`; reused the existing `features.ts` boot-warning array and the existing `feature_used` Plausible query shape; and added the native-pageview series break, the debug-lane exclusion, `src/utils/discord.ts`, and six argument-asserting test files to scope.
- **Pass 3 (Sustainability)**: Reversed Step 5's `feature_used`-in-`wrapAsync` decision — it couples product analytics to the 111-call-site error helper and structurally cannot express Requirement 9's per-invocation intent (as the plan's own `createMember` caveat proved) — in favour of a one-line `trackFeature(result, feature)` pass-through, which also makes the non-`wrapAsync` `photoStore.addPhoto` trivial; collapsed the `AnalyticsEvent` union and `PASSIVE_EVENTS` set into one const record so interactivity cannot be left undeclared; caught that "absent platform is never web" is right for the registry but WRONG for Plausible history (native never loaded the script, so every historical goal fire IS web) — as drafted the headline would have read ~0% for 30 days; reduced the two-percentage split to one headline plus a volume stat emitted as an array; unified the two competing platform vocabularies; scoped `buildRegistryPayload` to the payload only so the throw/no-throw invariant survives; declined the Lambda merge-idiom refactor with a stated reason (independent, non-atomic deploy); curated `FeatureName` to 16 values at planning time and excluded `family_member` (fires on the signup path, would re-invert the ranking); and added the `plausible_ignore` per-origin self-traffic trap, the `plausible.d.ts` ambient-export footgun, the third series break, and corrections to the census (17 events / 27 sites) and four line references.
- **Pass 4 (Fresh-eyes sweep)**: Swept out four contradictions the Pass-3 reversal left behind (Files Affected still listed `useStoreActions.ts`; two ACs and a Testing item still assumed `wrapAsync`; Requirements 6 and 8 still described the retired two-percentage/every-store design); caught six new-bug risks the draft would have shipped — the Lambda write-once idiom stamping every PRE-EXISTING family on its next login rather than at signup (it fires on all writes, per the Lambda's own comment), an unvalidated client-supplied enum persisted permanently, a memoized platform that would break its own three-platform test, `platform` left hand-passable in `PropKey`, the review-demo release lanes now reporting every reviewer tap to the production property (`reviewDemo` is armed on exactly the two lanes gaining Plausible), and `inAppPct` becoming a MIS-stated funnel under the plan's own pre-approved iOS-autocapture fallback; established that the `signup` event and the `Signup Completed` goal are not proven to be the same population before dividing one by the other; kept `actualNewFamilies` all-platform and moved the "render — until coverage" guard onto the registry-derived figures that actually need it; and corrected the `login` census (five sites, not three), the registry-Lambda test runner (vitest, not `test:lambda`), and the `operationalWebhooks` misnomer.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (assembled by /beanies-pre-plan from Notion #71)

The full `=== BEANIES PRE-PLAN ===` block for #71, captured verbatim on the tracker row's `beanies-plan prompt` property and in this session.

### Shaping decisions (greg, 2026-08-23 s2)

- Hold BOTH the web and app deploys until the #70 recurrence fix-review passes.
- Investigate scope item 3 BEFORE planning (done — root cause in Context).
- On being asked whether there was a valid reason not to send events from native: _"usage on apps to me is equivalent to usage on web, and installing the app to me is the same as a conversion coming from the web to install the web version or pwa. also i'd like to measure everything in one place… it keeps the codebase simpler to keep the apps in line with the web version."_ → scope item 3 rewritten from "document the difference" to "close the gap".
- No mockup needed.

</details>
