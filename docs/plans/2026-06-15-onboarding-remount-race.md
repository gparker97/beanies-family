# Plan: Fix the onboarding remount race (infinite spinner after create-pod step 1)

> Date: 2026-06-15
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-15-onboarding-remount-race.md` (final save target)
> **No GitHub issue created.** Approved for direct implementation; full prompt history in `## Prompt Log`.

## User Story

As a new family signing up, I want the create-pod wizard to advance smoothly from step 1 (account) to step 2 (storage) so that I can finish onboarding — instead of being stranded on an infinite spinner under a half-rendered app sidebar.

## Context

New users are hitting a **hard onboarding block**: after completing step 1 of the create-pod wizard at `/create`, the screen intermittently shows the app sidebar + a centered beanies.family logo + an infinite spinner (as if routed to `/nook` with no pod). greg reproduced it 3 of 4 attempts on both dev and prod. The `app.onboardingZombieState` critical Slack alert that fires on "almost every" family creation is the **symptom** (stranded users reload and land on the recovery screen); this race is the **disease**.

### Confirmed root cause (a reactive remount race)

`/create` renders `LoginPage.vue` (route name `CreateFamily`, `props: { initialView: 'create' }` → `CreatePodView`).

1. Step 1 sign-up (`authStore.signUp`, `src/stores/authStore.ts:512`) flips `isAuthenticated → true` while the route is still `/create` and `podCreated = false` (the `.beanpod` file isn't written until step 2/3 via `syncStore.createNewFile` → `markPodCreated()`).
2. `showLayout` (`src/App.vue:269-282`) = `isAuthenticated && !noLayoutPages.includes(route.name)`. `noLayoutPages` lists `Welcome`/`Login`/`JoinFamily` but **omits `CreateFamily`** → `showLayout` flips **true** on `/create`.
3. App.vue renders `<router-view>` in **two separate template branches** — `v-if="showLayout"` (app shell + sidebar, `~1684`) and `v-else` (`~1731`). Toggling `showLayout` swaps branches → Vue **destroys and remounts LoginPage** (the sidebar appears).
4. The **remounted** `LoginPage.onMounted` (`src/pages/LoginPage.vue:178`) hits `if (authStore.isAuthenticated && !authStore.podCreated) return;` — which **deliberately leaves `isInitializing = true`** (spinner template at `:527` inside `<LoginBackground>` = centered logo), on the documented assumption that App.vue's one-time boot redirect to `/welcome?resume=setup` will rescue it.
5. App.vue's `initializeApp` runs **once at boot** and does **not** re-run on a remount → the rescue never comes → **infinite spinner** under the sidebar.

**Intermittency:** it races whether some navigation fires a router guard that injects `?resume=setup` (LoginPage's `watchEffect` at `:106` then recovers) vs. not (hangs). Hence ~3/4 failures.

### Intended outcome

Onboarding advances deterministically; the app chrome never wraps a session without a pod; the recovery path can never strand the spinner; and the `app.onboardingZombieState` critical alert stops firing on legitimate onboarding routes (while still catching genuine zombies).

## Requirements

1. After create-pod step 1, the wizard advances to step 2 with **no remount, no sidebar flash, no spinner hang** — deterministically, every time.
2. The authenticated app chrome (sidebar/header/main) must **never** render for a session that has no pod yet, on any route.
3. The `LoginPage` recovery path must **self-rescue** (not depend on App.vue's one-time boot redirect), so no future remount/re-entry can strand the spinner.
4. The `app.onboardingZombieState` **critical** alert must not fire for legitimate onboarding routes (`CreateFamily`, `OpenFromDrive`) or the recovery screen; the redirect-to-recovery behavior is preserved, and genuine zombies (authenticated-no-pod reaching a `requiresAuth` route) are still caught by the throttled `requiresAuth` guard.
5. The "authenticated but no pod" predicate is consolidated into a single store getter (DRY).
6. Ship **ungated** (bug fix; feature-gate-by-request policy). **Do not deploy** — greg deploys explicitly.

## Important Notes & Caveats

- **`route.name` / `route.meta` are reliable in App.vue.** App.vue uses `useRoute()`. The layout decision moves to a `route.meta.noChrome` flag (see Approach), read in App.vue and the helper.
- **Keep the redirect on boot for `/create`.** With Layer 1 in place, App.vue's boot zombie block only runs on a _genuine fresh boot_ (it does not re-run on remount). A user who genuinely cold-boots mid-create should still be redirected to `/welcome?resume=setup` (the established recovery) — we only remove the _critical alert_ noise for that case, not the recovery.
- **Completion transient:** when step 3 finishes, `markPodCreated()` flips `podCreated → true` while still briefly on `/create` before `emit('signed-in','/nook')` navigates. The `meta.noChrome` flag on `CreateFamily`/`OpenFromDrive` covers that tick (onboarding routes never show app chrome regardless of `podCreated`) — belt-and-suspenders with the `needsPodSetup` short-circuit.
- **`load-drive` resume must not be rewritten to `setup`.** LoginPage's self-rescue (Layer 2) and the App.vue redirect exempt `resume === 'load-drive'` as well as `setup`, mirroring the `ALREADY_AUTH_REDIRECT` guard (`src/router/index.ts:318`), or a returning-but-podless Drive-load user would be stranded on resume-setup instead of the picker (ADR-029).
- **Getter definition (verified canonical form):** the existing boot block at `App.vue:825` uses `!authStore.needsAuth && !authStore.podCreated`; the router guard at `index.ts:312-318` uses the equivalent `isAuthenticated && !podCreated`. Define the getter as `needsPodSetup = computed(() => !needsAuth.value && !podCreated.value)` and collapse both forms onto it.
- **No silent failures (reconciled):** the current App.vue boot block does a **bare `await router.replace('/welcome?resume=setup')`** (`:846`) with no `NavigationFailure` handling. Layer 3 **upgrades** it to the existing in-file `safeRouterReplace(...)`. LoginPage's Layer 2 uses a small local `replaceOrSurface(...)` (see Approach) — never a bare `router.replace`. No instruction anywhere to swallow a failure.

## Assumptions

> Review before implementation.

1. `podCreated` is set true by `markPodCreated()` on both file-creation (`syncStore.ts:1252`) and pod-load success (`syncStore.ts:2373`), and restored from localStorage for returning users — so legitimate onboarded users always have a pod before reaching an app route. **(Verified this session.)**
2. The `requiresAuth` guard (`src/router/index.ts:348-372`, with its one-shot `zombieStateReported` report) remains the primary safety net catching genuine zombies; the showLayout gate is a second, defensive layer. **(Verified.)**
3. No existing unit tests mount App.vue for `showLayout`; LoginPage onMounted coverage must be confirmed/added (existing files: `src/pages/__tests__/LoginPage.resumeLoadDrive.test.ts`, `LoginPage.tdz.test.ts`).
4. **(Pass-4 correction)** The no-chrome flag goes on **7 real in-app routes**: `Welcome`, `Login`, `JoinFamily`, `CreateFamily`, `OpenFromDrive`, `PlausibleExclude`, `NotFound`. `CreateFamily`/`OpenFromDrive` are the leaking surfaces (the bug); `PlausibleExclude`/`NotFound` render in-app and carry the flag; `Welcome`/`Login`/`JoinFamily` already render chrome-less. **`BeanstalkBlog`/`BeanstalkPost` in today's `noLayoutPages` literal are DEAD names** — those routes were migrated to `externalRedirect` stubs (`BeanstalkBlogRedirect` etc., router:253-256) that `window.location.replace` cross-origin and never render — so they are dropped, not migrated. Do NOT touch the stubs, `NoAccess`, or `OAuthCallback` (their behavior is unchanged and correct).

## Approach

A single store getter + a minimal pure predicate + `meta.noChrome` route flags + three coordinated layers, built on **existing hardened primitives** (no new navigation util). This is _less_ new surface than a name-list approach.

### Sustainability decisions (locked — no "decide during implementation")

1. **Do NOT extract `safeRouterReplace`.** App.vue's version closes over five component-scope identifiers (`route`, `initError`, `initErrorDetail`, `t`, `initBreadcrumbs`) plus module-local loop constants. Extracting it would destabilize the boot path for no benefit here. App.vue's Layer 3 **reuses the existing in-file `safeRouterReplace` unchanged**. LoginPage gets a small **local** `replaceOrSurface(target, callerTag)` that **mirrors App.vue's numeric-`type` NavigationFailure convention** (`const r = await router.replace(target); if (r && typeof r.type === 'number') { … }`, not an `isNavigationFailure` import), `reportError`s `warning` + `console.warn`s dev guidance on a cancel/throw, and **always clears `isInitializing` in a `finally`**. It deliberately omits the `location.replace` fallback + loop-counter backstop (LoginPage's reactive `watchEffect` recovers the view; it has no init-health `route.path` read). No new `src/utils/safeRouterReplace.ts`.
2. **No parallel route-name array.** A name list in `appChrome.ts` duplicating `router/index.ts` is a drift hazard. Instead add **`meta: { noChrome: true }`** to the nine no-chrome routes in `router/index.ts`; `shouldShowAppLayout` reads `route.meta.noChrome`. Adding a future no-chrome route is then a single self-documenting line next to the route — nothing else to keep in sync.
3. **Keep `appChrome.ts` token-free and narrow.** A generic util must not import from `src/components/login/...`. `appChrome.ts` exports only `shouldShowAppLayout`. The resume-query classifier `isPodlessRecoveryQuery` is colocated in `resumePaths.ts` (which already owns the tokens).

### DRY foundation — `authStore.needsPodSetup` getter

`src/stores/authStore.ts` (beside `needsAuth`/`displayName`, exported in the return object):

```ts
/** Authenticated session whose `.beanpod` file does not exist yet — the
 *  half-finished-onboarding ("zombie") state. Single source of truth, consumed
 *  by the router guards, App.vue boot, the layout helper, and LoginPage. */
const needsPodSetup = computed(() => !needsAuth.value && !podCreated.value);
```

Replace the inline predicate at: App.vue boot block (`:825`), `showLayout` (`:269`, via the helper), LoginPage onMounted (`:178`), and the router guards (`:313`, `:361`).

### Resume-token classifier — `src/components/login/resumePaths.ts`

Add the one missing named token and a tiny colocated helper (so `'setup'` is named once, and the recovery classification lives with its tokens):

```ts
export const RESUME_SETUP = 'setup'; // value of ?resume= for the create/recovery continuation
export function isPodlessRecoveryQuery(resume: unknown): boolean {
  return resume === RESUME_SETUP || resume === RESUME_LOAD_DRIVE;
}
```

Reuse the existing `RESUME_SETUP_PATH` (`src/services/sync/connectStorage.ts:28`) for navigation targets.

### Pure helper — `src/utils/appChrome.ts` _(new, minimal)_

```ts
import type { RouteLocationNormalizedLoaded } from 'vue-router';

/** Whether the authenticated app shell (sidebar/header) should render.
 *  Routes opt out of chrome via `meta.noChrome` (set in router/index.ts), so
 *  there is no name list to keep in sync. A podless session never gets chrome. */
export function shouldShowAppLayout(
  route: Pick<RouteLocationNormalizedLoaded, 'meta'>,
  flags: { isAuthenticated: boolean; needsPodSetup: boolean }
): boolean {
  if (!flags.isAuthenticated) return false;
  if (flags.needsPodSetup) return false; // never frame a podless session
  return route.meta?.noChrome !== true;
}
```

### Router — `src/router/index.ts`

- Add `meta: { ...existing, noChrome: true }` to the **7 real in-app routes**: `Welcome`, `Login`, `JoinFamily`, `CreateFamily`, `OpenFromDrive`, `PlausibleExclude`, `NotFound` (per Assumption 4 — `BeanstalkBlog`/`BeanstalkPost` are dead names and dropped; stubs/`NoAccess`/`OAuthCallback` untouched).
- Add the **first** `RouteMeta` augmentation in the repo — co-located here, intentionally **partial** to avoid a speculative typing change: `declare module 'vue-router' { interface RouteMeta { noChrome?: boolean } }` with a one-line comment noting other meta fields remain untyped by design.
- Swap the two guard predicates (`:313`, `:361`) to `authStore.needsPodSetup`; replace the literal resume check (`:318`) with `isPodlessRecoveryQuery`. No behavior change.

### Layer 1 (root cause) — `showLayout` via the helper

`src/App.vue:269`:

```ts
const showLayout = computed(() =>
  shouldShowAppLayout(route, {
    isAuthenticated: authStore.isAuthenticated,
    needsPodSetup: authStore.needsPodSetup,
  })
);
```

`needsPodSetup` short-circuits `showLayout` to false during step-1 signUp; `meta.noChrome` on `CreateFamily`/`OpenFromDrive` covers the completion transient. Either alone keeps `showLayout` stable across the wizard → no remount.

### Layer 2 (defense-in-depth) — `LoginPage` self-rescue

Replace the bare early-return at `src/pages/LoginPage.vue:178`:

```ts
if (authStore.needsPodSetup) {
  // Already on a deliberate recovery view? watchEffect(:106)/sync check(:164)
  // set activeView + clear isInitializing — just bail.
  if (isPodlessRecoveryQuery(route.query.resume)) return;
  // (Re)mounted podless without recovery context — App.vue's boot redirect
  // won't re-run on a remount, so self-rescue rather than hang the spinner.
  await replaceOrSurface(RESUME_SETUP_PATH, 'LoginPage.onMounted.podlessRescue');
  isInitializing.value = false;
  return;
}
```

`isPodlessRecoveryQuery` exempts both `setup` and `load-drive` (ADR-029). `replaceOrSurface` (local helper, decision 1) never leaves the spinner stuck.

### Layer 3 (alert hygiene + replace upgrade) — App.vue boot block

`src/App.vue:825-849`:

```ts
if (authStore.needsPodSetup) {
  initBreadcrumbs.push('auth: authenticated but no pod file — routing to resume-setup');
  const expectedPodless =
    route.meta?.noChrome === true || isPodlessRecoveryQuery(route.query.resume);
  if (!expectedPodless) {
    reportError({
      surface: 'app.onboardingZombieState',
      severity: 'critical',
      message: 'App boot found an authenticated session with no pod file — routing to resume-setup',
      context: { route_path: route.fullPath },
    });
  }
  if (!isPodlessRecoveryQuery(route.query.resume)) {
    await safeRouterReplace(RESUME_SETUP_PATH, 'app.boot.onboardingZombie'); // upgraded from bare router.replace
  }
  isInitializing.value = false;
  return;
}
```

The throttled `requiresAuth` guard (`src/router/index.ts:351`, `zombieStateReported` one-shot) still fires the critical alert for genuine zombies on SPA navigation — unchanged except the `needsPodSetup` swap. (`expectedPodless` via `meta.noChrome` automatically covers `CreateFamily`/`OpenFromDrive` and any future no-chrome route — no separate name check.)

## Files Affected

- `src/components/login/resumePaths.ts` — `RESUME_SETUP` token + `isPodlessRecoveryQuery` helper (colocated with tokens).
- `src/stores/authStore.ts` — `needsPodSetup` getter (`!needsAuth && !podCreated`) + export.
- `src/utils/appChrome.ts` _(new, minimal)_ — `shouldShowAppLayout(route, flags)` reading `meta.noChrome`; no name list, no token imports.
- `src/router/index.ts` — `meta.noChrome: true` on the **7 real in-app routes** (+ the repo's first, intentionally-partial `RouteMeta` augmentation); swap guard predicates to `needsPodSetup`; resume check via `isPodlessRecoveryQuery`.
- `src/App.vue` — `showLayout` delegates to `shouldShowAppLayout`; boot block uses `needsPodSetup` + `expectedPodless` and **upgrades** the bare `router.replace` to the existing `safeRouterReplace` (its signature/closure unchanged).
- `src/pages/LoginPage.vue` — self-rescue branch via local `replaceOrSurface`; `isPodlessRecoveryQuery`; predicate swap.
- _(NOT created:_ `src/utils/safeRouterReplace.ts` — decision 1._)_
- Tests (below).

## Acceptance Criteria

- [ ] Create-pod step 1 → step 2 advances with no sidebar flash / spinner hang (manual, repeated ≥5×).
- [ ] `shouldShowAppLayout` returns false whenever `needsPodSetup` is true, on every route (including ones without `meta.noChrome`).
- [ ] A route carrying `meta.noChrome` renders without app chrome; a test asserts the helper reads `meta`, not a name list (drift-resistance), incl. an unknown route name + `noChrome:true` → hidden.
- [ ] `LoginPage` authenticated-no-pod on a non-recovery route self-navigates to `/welcome?resume=setup`; `isInitializing` never stuck (incl. guard-cancelled rescue).
- [ ] App.vue boot zombie redirect goes through `safeRouterReplace` (no silent resolve).
- [ ] No `app.onboardingZombieState` critical `reportError` for `CreateFamily`/`OpenFromDrive`/recovery; genuine protected-route zombies still alert via the `requiresAuth` guard.
- [ ] `needsPodSetup` is the single predicate at all call sites; no remaining inline duplication.
- [ ] `npm run validate` green.

## Testing Plan

1. **Unit — `authStore.needsPodSetup`:** true when authenticated && no pod; false when `needsAuth`; false after `markPodCreated()`.
2. **Unit — `src/utils/__tests__/appChrome.test.ts`:** `shouldShowAppLayout` matrix — unauthenticated → false; `needsPodSetup` → false; `meta.noChrome` → false; otherwise → true. Drift assertion: an unknown-name route with `meta.noChrome:true` is hidden (proves meta-driven, not name-list).
3. **Unit — `resumePaths.test.ts`:** `isPodlessRecoveryQuery` for `setup` / `load-drive` / neither / `undefined`.
4. **Component — `LoginPage`** (extend `src/pages/__tests__/`): authenticated-no-pod on a non-recovery route → `replaceOrSurface` to `RESUME_SETUP_PATH` called, `isInitializing` ends false (no hang); guard-cancelled rescue still clears the spinner + reports; with `resume=setup`/`resume=load-drive` it does NOT redirect (defers to the watchEffect).
5. **Regression — zombie alert:** alert suppressed for `meta.noChrome`/recovery surfaces; still fires for a non-recovery protected route; redirect uses `safeRouterReplace`.
6. **E2E (only if it fits the 25-test budget + three-gate filter):** create-pod happy path is a critical, data-blocking journey. Assert via state (store/IndexedDB), not DOM timing; no `waitForTimeout`. Extend an existing create-pod E2E if present; otherwise weigh against the budget. Log in `docs/E2E_HEALTH.md` if changed.
7. **Manual:** reproduce greg's steps (invite code → step 1 → Next) ≥5× on `npm run dev`; step 2 every time; confirm `/welcome?resume=setup` recovery still works on a genuine mid-create reload; check light/dark. Then `npm run validate`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the `needsPodSetup` getter + 3-layer fix (showLayout podCreated gate & pure helper, LoginPage self-rescue, zombie-alert exemption) with DRY consolidation and a unit/component/E2E test plan.
- **Pass 2 (DRY + error handling)**: Reused the existing hardened `safeRouterReplace` instead of a bare `router.replace` that would silently swallow `NavigationFailure`; folded duplicated `setup`/`load-drive` + onboarding route literals into shared predicates + a `RESUME_SETUP` token reusing `RESUME_SETUP_PATH`/`LOAD_DRIVE_PATH`.
- **Pass 3 (Sustainability)**: Decided AGAINST extracting `safeRouterReplace` (verified 5-identifier closure) — App.vue reuses its in-file version, LoginPage uses a local `replaceOrSurface`; replaced the drift-prone name array with `meta.noChrome` route flags; narrowed `appChrome.ts` to one token-free predicate (no login-component import); confirmed all three layers justified (net new surface lower than Pass 2); reconciled the stale bare-`router.replace` caveat (Layer 3 upgrades `App.vue:846`); corrected the getter to the verified `!needsAuth && !podCreated`.
- **Pass 4 (Fresh-eyes sweep)**: Corrected the no-chrome route set 9→**7 real in-app routes** (`Welcome`/`Login`/`JoinFamily`/`CreateFamily`/`OpenFromDrive`/`PlausibleExclude`/`NotFound`) — `BeanstalkBlog`/`BeanstalkPost` are dead names (now external-redirect stubs), dropped not migrated; flagged the `RouteMeta` augmentation as the repo's first and scoped it partial (`noChrome?: boolean`); pinned `replaceOrSurface` to App.vue's numeric-`type` NavigationFailure convention with a `finally` spinner-clear. Verified (all HOLD): `route.meta` reactivity in the computed, no replace-loop on Layer-2 self-rescue (destination carries `resume=setup` → bails), no getter collision + valid TDZ ordering, Layer-3 `meta.noChrome` exemption strictly better than the old `onResumeScreen`-only check (both intents preserved), and zero other consumers of the old `noLayoutPages`/`showLayout` name-list semantics (nav/header/sidebar inherit visibility transitively).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial trigger (during /error-review)

greg, on reviewing the `app.onboardingZombieState` critical alert: "This seems to have revealed a much larger and more serious problem with the onboarding flow. I've just tried the onboarding myself … on both dev and prod, and there is a serious problem after step 1 … After step 1, i get an infinite spinner and a screen as if i'm trying to sign in. Steps to reproduce: 1) Start a new pod - input invite code 2) complete step 1 of setup wizard (family name, email, pw, etc) 3) click on next -> sidebar appears, beanies.family logo in the middle of the screen, infinite spinner - as if i am being routed to the /nook but there is no user created yet. this is the bug. I tried to create a new family 3 times and hit this bug every time. on the 4th time, i was correctly routed to step 2 of the setup wizard (family data file creation). So the bug appears to be intermittent, but as this impacts the onboarding / family creation process it is top priority. Please perform a full and comprehensive investigation of the onboarding process to identify, isolate, and definitely fix this issue … The error i asked you to review above is a symptom of this issue …"

### Process choice

greg chose: "Run /beanies-plan first" (full 4-pass rigor for this auth/routing-core change) over implementing directly.

</details>
