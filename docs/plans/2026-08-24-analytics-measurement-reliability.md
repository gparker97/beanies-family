# Plan: Analytics measurement reliability — bounce rate, feature coverage, and the signup-goal gap

> Date: 2026-08-24
> Related issues: Beanies tracker #71 (Notion). **No GitHub issue** — direct implementation.
> Plan file: `docs/plans/2026-08-24-analytics-measurement-reliability.md`

## User Story

As the person deciding where to spend the next month of effort, I want beanies' own analytics to report numbers I can act on, so that "which features do families actually use" and "how many visitors become families" are answered by measurement rather than by guesswork.

## Context

Three defects compound to make the founder-metrics dashboard untrustworthy. All figures are live queries run 2026-08-23 over the trailing 30 days.

**1. Bounce rate is structurally meaningless.** Plausible counts ANY custom event as engagement unless sent with `interactive: false`. The marketing site's Web Vitals RUM script fires CWV events on every page load — 122 of 133 visitors emitted `CWV FCP` — so essentially no session could ever be a bounce, and the site reports **1% bounce at 1.7 pages/visit**. The app site has the same defect in milder form (30%) via `storage_persist_denied` (fires on boot, 43 of 143 visitors), `install_nudge_shown`, `community_nudge_shown` and `pwa_stale_detected`.

**Verified 2026-08-24: `5df0fe0c` already fixes this completely.** It tagged all five CWV metrics plus those four app events, and added `interactive` to the `PlausibleQueue` type. I enumerated every event the app fires (**18 distinct events across 29 call sites in 13 files**) and checked each; the only non-obvious case is `login`, whose three emit sites are all inside user-initiated functions (`signIn:626`, `signInWithPasskey:1138`, `createSessionForVerifiedMember:1174`), so it is correctly interactive. **Nothing was missed.** Scope item 1 therefore needs no new tagging — it needs a guard so the next auto-fired event cannot silently regress it.

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
2. **Passive events cannot silently regress.** Interactivity is derived _entirely_ from a declared `PASSIVE_EVENTS` set — no call site can contradict it — and a test asserts the set's exact membership.
3. **Native apps report to Plausible.** `VITE_PLAUSIBLE_DOMAIN` on both **release** lanes; the `workflowEnvParity` exemption deleted so silent drift fails CI.
4. **Every event carries a platform** (`web` | `ios` | `android`), attached centrally by the seam — never hand-passed.
5. **The registry row carries the signup platform, write-once** — client, Lambda and type. Separate from (4): `gapIsMaterial` compares against _registry_ rows.
6. **Conversion is two labelled numbers, not a range.** Marketing-funnel = **web-only** signups ÷ marketing visitors; total signups = all platforms.
7. **`gapIsMaterial` compares like with like** — the Plausible goal against **web-only** registry rows.
8. **`feature_used` covers every store with a user-facing create action**, emitted from one place rather than 21.
9. **`feature_used` never fires on programmatic, seed, or non-user-initiated writes.**
10. **Store data-collection declarations ship in the same change.**
11. **Both series breaks are documented** — bounce rate _and_ the app property's arrivals/pages/bounce, which native traffic also shifts.

## Important Notes & Caveats

- **Scope item 1 is verification, not new tagging.** `5df0fe0c` is complete (see Context). Add the regression guard; do not re-tag.
- **DO NOT DEPLOY.** Both web and app deploys are held until the #70 recurrence fix-review passes (greg, 2026-08-23 s2). The deploy is a separate, explicitly-instructed step.
- **⚠️ iOS serves over `capacitor://`, NOT https.** `capacitor.config.ts:22-25` sets `androidScheme: 'https'` + `hostname: 'app.beanies.family'`, but the comment at `:13-21` is explicit: `iosScheme: 'https'` is **silently ignored** (WKWebView reserves `https`), so _"the iOS origin therefore IS and must stay `capacitor://app.beanies.family` — the comment above describes ANDROID only… Tried and reverted in build 8."_
  **Consequence and pre-decided fallback:** Android pageviews will look identical to the PWA. iOS pageview autocapture under a non-HTTP protocol is **unverified** — confirm on a real iOS build that the tracker sends at all and records a sane path. **If it does not, ship anyway with pageview autocapture disabled on iOS**: every requirement in this plan is satisfied by the _custom_ events (`signup`, `feature_used`), which do not depend on the origin scheme. Do not block the plan on this.
- **Historical data cannot be corrected retroactively.** The deploy date is a series break for bounce rate **and** for the app property's `visitors`/`topPages`/`bounce_rate`/`inAppPct`, because native pageviews start landing in it mid-series.
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

```ts
export type AnalyticsEvent = 'signup' | 'login' | 'feature_used' | …;  // the 18 measured events
export const PASSIVE_EVENTS = new Set<AnalyticsEvent>([
  'storage_persist_denied', 'install_nudge_shown', 'community_nudge_shown', 'pwa_stale_detected',
]);

export function track(event: AnalyticsEvent, opts?: Omit<PlausibleOptions, 'interactive'>): void;
```

- **Platform, centrally.** Use `getPlatform()` from `src/services/sync/capabilities.ts:53` — it already returns exactly `'web' | 'ios' | 'android'`, so no mapping is needed. **Not `isNativePlatform()`, which does not exist**; `capabilities.ts:39-45` declares itself the one place `Capacitor.isNativePlatform()` may appear (ADR-029). Wrap the call in try/catch with a `'web'` fallback, mirroring `src/utils/platformLabel.ts:22-32`, which exists for exactly this reason.
- **`interactive` is NOT a parameter.** It is derived solely from `PASSIVE_EVENTS`. This is the point of Requirement 2: if the flag stayed passable, a call site could contradict the set and the membership test would be blind to it. The four sites currently passing it by hand (`App.vue:908`, `useInstallNudge.ts:109`, `useStalePwaNotice.ts:38`, `useCommunityNudge.ts:173`) each drop the argument.
- **Reuse the existing options type.** `src/types/plausible.d.ts` already types the call signature's options inline; name that type (`PlausibleOptions`) and derive from it rather than re-declaring the shape.
- **Never throws.** try/catch + `console.warn` with the `[analytics]` prefix, matching `initAnalytics`. Do **not** toast — `plausible.ts:7-9` is explicit that users are never told about analytics failures.

Then migrate all 29 call sites across the 13 files. This makes the union type the single registry of what the app reports.

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

### Step 4 — Signup platform on the registry (three places, or it silently no-ops)

**The Lambda whitelists fields.** `infrastructure/lambda/registry/index.mjs:157-202` builds the persisted `item` as an explicit field list and PUTs it with `marshall(item, { removeUndefinedValues: true })`. A `platform` on the client payload is **discarded with no error on either end** — Requirements 5 and 7 would read `unknown` forever. All three of these are required:

1. **Lambda** — add the field, **write-once**, modelled on `ownerEmail` (`:171`): `signupPlatform: existing.signupPlatform ?? body.signupPlatform ?? null`. Write-once is mandatory, not stylistic: `registerCurrentFamily` fires on _every_ login and config write (`syncStore.ts:4021-4041`), so last-writer-wins would relabel an iOS-created family as `web` the first time its owner opened a browser. The name `signupPlatform` states the intent.
2. **Client** — `syncStore.ts` has **two** near-identical payload sites (`_registerCurrentFamilySync:1490-1501` and `registerCurrentFamily:4029-4041`) differing only in their `overrides.*` fallbacks and `isLoginEvent`. **Extract one `buildRegistryPayload()` used by both** and add the field there once, rather than editing two literals.
3. **Type** — `RegistryEntry` in `src/types/models.ts:1716-1733`.

Plus a Lambda test (`infrastructure/lambda/registry/index.test.mjs`) asserting a second PUT from a different platform does **not** move the field.

**Absent = `unknown`, and `unknown` is EXCLUDED from web-only denominators — never assumed web.** Assuming web would re-introduce the exact inflation this fixes, on precisely the historical rows we cannot verify.

### Step 5 — `feature_used` coverage, from one place

**Do not hand-add 21 emit lines.** Every existing site is the identical shape (`goalsStore.ts:117-129`, and identically at `transactionsStore:500`, `budgetStore:248`, `vacationStore:175`):

```ts
const result = await wrapAsync(isLoading, error, fn, { action: 'goalsStore:createGoal' });
if (result) window.plausible?.('feature_used', { props: { feature: 'goal' } });
```

`WrapAsyncOptions` (`src/composables/useStoreActions.ts:6-18`) **already carries a per-action label**. Add an optional `feature?: FeatureName` and emit from `wrapAsync`'s success branch (`:66-71`), inside its own try/catch. This collapses 21 duplicated lines into one word in an options object most create functions already pass, makes fire-on-failure structurally impossible (today it's a hand-written `if (result)` at each site), and gives one place to change if the event shape ever moves. Migrate the existing four to it and delete their trailing lines.

**Four call-site decisions this step must resolve** (all verified, all traps):

- **`familyStore.createMember` is called from the SIGNUP path** (`authStore.ts:700-701`) and onboarding (`CreateMembersStep.vue:79`), not just `MeetTheBeansPage.vue:295`. Emitting there would make `family_member` a 100%-adoption "feature" and **re-invert the very ranking this plan exists to fix.** Either drop it, or emit from the user-initiated caller rather than the store.
- **`familyStore.createMemberWithId` (`:240`) must never emit** — its docblock says it exists only to rebuild the owner after an onboarding redirect.
- **`photoStore.addPhoto` (`:303`) does not use `wrapAsync`** — handle explicitly or drop `photo`.
- **Multi-create stores need one designated "the feature" action**: `listStore` (`createList:162`, `createFromTemplate:183`, `addItem:295`), `recipesStore` (`createRecipe:45`, `createCookLog:79`), `medicationsStore` (`createMedication:108`, `createMedicationLog:141`).

Feature names should read as the surface a family would name, not the store. **Keep the existing four unchanged** (`transaction`, `budget`, `vacation`, `goal`) so the historical series stays continuous.

**Requirement 9 is already satisfied architecturally — verify, don't rebuild.** `seedDocument` deliberately bypasses the stores and says so in its docblock; `demoSeed` suppresses analytics. A test already exists: `demoSeed.test.ts:177` (_"emits no Plausible events, and leaves window.plausible as it found it"_). **Extend that assertion** to also fire a `feature_used` inside the mocked `signUp` — do not add a second test.

### Step 6 — Dashboard: two labelled numbers, one honest flag

In `.claude/skills/early-adopter-metrics/`:

- **The query already has a template.** `build_dashboard.mjs:155-157` reads `pl.app.goals` via `goalV('Signup Completed')`, sourced from a `dimensions: ['event:goal']` query — which **cannot** be broken down by a prop. Add one query modelled exactly on the existing `feature_used` breakdown at `query_plausible.mjs:229-236`: `filters: [['is','event:name',['signup']]], dimensions: ['event:props:platform']`, the same shape as the `features` and `loginMethods` queries. Reuse the pattern; add no new machinery.
- `conversion.overallPct` = **web-only** signups ÷ marketing visitors.
- Add `conversion.totalSignups` (all platforms) + the per-platform split; render both in `assets/dashboard-template.html`, **distinctly labelled**. Retire `overallPctUpperBound` — one render site, `dashboard-template.html:458`.
- `conversion.gapIsMaterial` (`build_dashboard.mjs:232`) compares the goal against **web-only** registry rows: `webOnlyRegistry - webOnlyCompleted` against the same `max(3, n * 0.34)` threshold, where both sides now count the same population.
- **`inAppPct` and `funnelAcq` stay all-platform** — both halves gain native, so they remain internally consistent. Only `overallPct` goes web-only.

### Step 7 — Store declarations + docs

**These gate a store submission and must land in the same change.** Native analytics is new data collection:

- `ios/App/App/PrivacyInfo.xcprivacy` (not the repo root) — Analytics / Product Interaction.
- The Play Data Safety answers; `web/src/pages/privacy.astro`; the data-collection table in `docs/runbooks/native-store-submission.md`.

And in `references/data-sources.md`: the platform split and what each conversion number means; that Plausible has **no offline queue** (CloudWatch has `logQueue.ts`), so native under-counts somewhat — far less than today's 100%; and that the deploy date is a series break for **both** the marketing bounce rate **and** the app property's arrivals/top pages/bounce/`inAppPct`.

### Sequencing

**The registry Lambda (Step 4.1) must be deployed BEFORE the client ships**, or the first native signups write nothing and the field is permanently lost for those rows. Otherwise: Step 1 → 2 → 3 → 4 → 5 → 6 → 7, with 6 and 7 able to run alongside 5.

## Files Affected

**Modified — app**

- `src/services/analytics/plausible.ts` (`track`, `AnalyticsEvent`, `PASSIVE_EVENTS`, two stale docblocks), `src/services/analytics/plausible.test.ts` (co-located — **not** a new `__tests__/` file; also fix the stale comment at `:103-106`)
- `src/types/plausible.d.ts` — name the options type
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

- **Reuse the existing boot-warning mechanism first.** `src/config/features.ts:100-113` already has an array + loop that warns, on PROD cloud builds, when a feature is off because its env var is unset — created for exactly this class of bug (the comment at `:83-97` names the `feedbackReporter` incident that also produced the parity test). Add one entry: `['analytics', 'VITE_PLAUSIBLE_DOMAIN', 'Product analytics will be silently absent']`. That is the DRY home for "cloud build, analytics off."
- **`logEvent({ level:'info', surface:'analytics', message:'analytics-init', context:{ action } })`** — once from `initAnalytics`, `action` = `'enabled'` | `'disabled-no-domain'`. **This is the event that would have caught defect 3 in a day rather than a month**: a native build reporting `disabled-no-domain` in CloudWatch is unmissable, where the current silent no-op was invisible for the entire life of the native apps. `console.warn` alone is invisible in production, which is why the remote signal is needed on top of the boot warning. Fires on both platforms — CloudWatch telemetry _is_ enabled natively.
- **`logEvent({ level:'warn', surface:'analytics', message:'track-failed', context:{ action } })`** — `track()`'s catch, `action` = the event name (fixed, low-cardinality). Answers "did we stop reporting, or did nobody use the feature?" — the exact ambiguity that made defect 2 hard to reason about. **Bounded**: `logEvent` rate-limits 50/surface/min (`logEvent.ts:85`), so a per-event warn cannot flood.
- **No new `ALLOWED_CONTEXT_KEYS` entries. Confirmed**: `action` is present at `src/utils/diagnosticContext.ts:68`. `surface: 'analytics'` satisfies the kebab-case/greppable rule (`CLAUDE.md`). No Lambda-mirror or store-declaration change is needed _for telemetry_ (Step 7's declarations are for Plausible itself).
- **No `severity: 'critical'`.** Nothing here risks user data or fails a user action — analytics is explicitly non-blocking.
- **No silent failures**: `track()` catches and reports; `initAnalytics` already catches; the registry write is part of an existing reported path.
- **No `perfTiming`** — `track()` is a fire-and-forget queue push far below `TELEMETRY_FLOOR_MS = 250`.
- **No i18n work by design** — this plan adds no user-facing string; analytics failures are never toasted (`plausible.ts:7-9`), so `uiStrings.ts` is knowingly untouched.

## Acceptance Criteria

- [ ] Every app-side analytics call goes through `track()`; no bare `window.plausible?.()` remains in `src/` **including the six test files** (excluding `plausible.ts` itself).
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
- [ ] `data-sources.md` documents the platform split, the offline-queue under-count, **and both series breaks** (marketing bounce + app-property arrivals/pages/bounce/`inAppPct`).
- [ ] `features.ts`'s boot warning covers `analytics`; `analytics-init` and `track-failed` fire as specified.
- [ ] iOS pageview behaviour under `capacitor://` is checked on a real build, and the outcome (works / autocapture disabled) is recorded in `data-sources.md`.
- [ ] Type-check, lint, full suite and `npm run build` green.

## Testing Plan

1. **`track()` unit tests** — platform attached for web/ios/android (mock `getPlatform`, the pattern already used at `src/utils/platformLabel.test.ts:20` and `passkeyService.test.ts:48-54`); a `PASSIVE_EVENTS` member is non-interactive and a non-member is interactive; a `getPlatform()` throw falls back to `'web'`; a throw inside `window.plausible` is caught and reported rather than propagating.
2. **`PASSIVE_EVENTS` membership** — exactly the four auto-fired events; no `*_dismissed` member. This is the regression guard; it must fail if someone adds an auto-fired event without declaring it.
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
- **Pass 3 (Sustainability)**: _pending_
- **Pass 4 (Fresh-eyes sweep)**: _pending_

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
