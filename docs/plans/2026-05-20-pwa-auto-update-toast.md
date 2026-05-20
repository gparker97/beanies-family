# Plan: Auto-apply PWA updates + a post-update confirmation toast

> Date: 2026-05-20
> Related issues: None — direct implementation.
> Plan file (save on approval): `docs/plans/2026-05-20-pwa-auto-update-toast.md`
> **No GitHub issue created.** Direct implementation; full prompt history in the Prompt Log below.

## User Story

As a beanies.family user, I want the app to quietly update itself to the latest version as soon as one is available (no "do you want to update?" prompt), and then show me a friendly confirmation that it's been updated — so I'm always on the newest build without being nagged, and I get a small, reassuring signal that the team keeps improving the app.

## Context

The PWA currently uses `registerType: 'prompt'` and shows a "A new version is available — Update now / Later" banner (`UpdatePrompt.vue`). greg wants to flip this to **auto-apply** (always land on the latest HEAD ASAP, no question) and instead show an **informational/marketing toast after** the update is applied ("you're on the latest version — we're always improving your experience").

Two facts established during research:

- **Service-worker updates are not incremental.** The browser fetches `sw.js`, byte-compares to the installed one, and installs the single newest SW (latest precache manifest). A user many builds behind jumps straight to HEAD in **one** update — they never cycle through intermediate versions. So "consolidate to one update to latest" is already inherent; this plan just removes the prompt and adds the post-update toast.
- **Do NOT use `registerType: 'autoUpdate'`.** `vite.config.ts:52-60` documents that enabling `skipWaiting`/`clientsClaim` (what `autoUpdate` does) caused a 4–5 minute chunk-load recovery loop on iPhone Safari (2026-05-13, `e091b47`) — the new SW claimed the page mid-precache-install. We deliver auto-apply **behavior** by KEEPING `registerType: 'prompt'` (so we control activation timing) and driving the update ourselves on a quiet moment. **`vite.config.ts` is not changed.**

## Requirements

1. **No update question.** Remove the "A new version is available — Update now / Later" banner. Updates apply automatically.
2. **Apply ASAP, but safely.** When a new SW is detected (`needRefresh`), apply it as soon as the app is in a safe state — **not** mid-edit or mid-save. Reuse the existing quiet gate (`hasOpenOverlays()` / `syncStore.isSyncing`). If quiet now → apply immediately; if busy → apply on the next quiet navigation (existing route-guard).
3. **Land the user back where they were.** Preserve the existing `pwa-post-update-route` persistence so the reload returns them to their current route.
4. **Post-update confirmation toast.** After the update reload, show a single, friendly **informational** toast (type `info`) — "you're on the latest version / we're always improving your experience." Fires once per applied update, never on an ordinary refresh or first install.
5. **On-brand, translated copy.** New `pwa.*` i18n keys with `en` + `beanie` values via `uiStrings.ts`; surfaced through `t()`. (Copy candidates below — flag for greg's voice review.)
6. **No silent failures.** All `sessionStorage` access try/caught; an update-apply error logs `[pwa]` and falls back to `hardReload()` (unregister SW + clear caches — a plain `location.reload()` can't escape a stale SW); the post-update toast call is independently try/caught and no-ops if it throws.

## Important Notes & Caveats

- **`registerType` stays `'prompt'`; `skipWaiting`/`clientsClaim` stay OFF.** This is the load-bearing decision — flipping to `'autoUpdate'` reintroduces the documented iPhone-Safari loop. "Auto-apply" is achieved by us calling the update on a quiet moment, not by the plugin claiming the page mid-install.
- **Immediate reload of an idle page is intended.** When the app is quiet (no overlays, not syncing) and a new version is ready, it reloads without asking — greg explicitly wants "as soon as available." The route is restored; scroll position is not (acceptable). The post-update toast explains what happened. Accepted edge: this can discard unsaved-but-not-yet-synced raw input in a field that hasn't triggered a save (the quiet gate covers in-flight saves + open modals/overlays, not raw keystrokes) — accepted per the always-latest directive.
- **One toast → HEAD.** A user multiple builds behind gets exactly one update + one toast (SW mechanic). No per-version stacking.
- **Detection cadence.** New versions are detected by the existing 5-min poll + `visibilitychange` (`safeServiceWorkerUpdate`) + on registration. So "ASAP" means within ≤5 min, or immediately on tab-focus / next navigation — leave the cadence as-is (don't over-tune the poll).
- **Toast must NOT fire on ordinary refresh or first install.** The trigger flag is set ONLY inside `performUpdate()` (which only runs after a genuine `needRefresh`), so a manual refresh or first-ever install won't show it.
- **Dead i18n keys.** Removing the banner makes `pwa.updateAvailable` / `pwa.updateButton` / `pwa.updateDismiss` unused — remove them (no dead code). Run `npm run translate` to resync zh and verify the `scripts/updateTranslations.mjs` parser still works (CLAUDE.md i18n rule).

## Assumptions

> Review before implementation (valid 2026-05-20).

1. `UpdatePrompt.vue` is the single owner of SW registration + the update route-guard (confirmed). No other component calls `useRegisterSW`.
2. `App.vue` onMounted (~`:581`, where `pwa-post-update-route` is read after `router.isReady()`) is the right place to read the new flag and fire the toast — the `ToastContainer` is already mounted there.
3. `showToast(type, title, message?, options?)` supports `'info'` with a title + optional subtitle (confirmed `useToast.ts:82`).
4. Auto-apply on a quiet idle page (immediate reload) is acceptable UX per greg's "as soon as available" directive.

## Approach

### A. Keep `registerType: 'prompt'`; drive auto-apply from a composable, reusing existing primitives (no banner)

Extract the SW-update logic from `src/components/common/UpdatePrompt.vue` into a new composable **`src/composables/usePwaUpdater.ts`**, called once from `App.vue` setup; **delete `UpdatePrompt.vue`** plus its `<UpdatePrompt />` import + tag (`App.vue:10`, `:1280`). The banner is gone, so a render-less `.vue` would be dead weight; a composable removes the tag and co-locates with the `App.vue` toast read. (`ToastContainer` at `App.vue:1288` is independent — no change.)

- **Lifecycle: mirror `useStaleTabRefresh.ts`** — a module-scoped `initialized` guard + detached `effectScope(true)` + a `__resetPwaUpdaterForTesting()` hook. This is an app-lifetime singleton (`useRegisterSW` must run exactly once) and the reset hook makes the quiet-gate unit-testable. Header comment states two invariants for future maintainers: (1) auto-apply is driven HERE, NOT via `registerType:'autoUpdate'` — see `vite.config.ts:52` for why `skipWaiting`/`clientsClaim` stay off; (2) this composable owns the SW poll.
- **Router/store access (avoid the `inject` trap)**: get the router via the **module singleton** `import router from '@/router'` (NOT `useRouter()` — that's `inject`-based and returns `undefined` inside a detached `effectScope`, exactly why `useStaleTabRefresh` never uses it). Use `router.beforeEach(...)` for the guard and `router.currentRoute.value.fullPath` for the immediate-apply write. `useSyncStore()` is fine inside the scope (Pinia resolves via the active pinia, not inject); `useToday`/`usePollWhileVisible` are module-singleton/scope-based, also fine.
- **Polling: reuse `usePollWhileVisible`** (`src/composables/usePollWhileVisible.ts`): `usePollWhileVisible(() => { if (swRegistration) safeServiceWorkerUpdate(swRegistration, 'poll'); }, POLL_INTERVAL_MS, { fireImmediatelyOnVisible: true })`. It already owns the timer, the visible-gate, the fire-on-tab-focus (subsumes the old `visibilitychange` update), and `onScopeDispose` cleanup — so the hand-rolled `setInterval` (and its **latent leak** at `UpdatePrompt.vue:27`) and the separate `visibilitychange` listener both disappear. Do **not** add a new `visibilitychange` listener: `useToday.ts` is the documented single visibilitychange sink (the old `UpdatePrompt` one was the flagged exception — `docs/plans/2026-04-10-stale-tab-refresh.md:159`); routing through `usePollWhileVisible` (which reads `useToday().isVisible`) restores the documented count.
- **Keep**: `useRegisterSW` + `onRegisteredSW` (store `swRegistration`), the quiet-defer route-guard (`hasOpenOverlays()` / `syncStore.isSyncing`), and the `pwa-post-update-route` persistence.
- **Remove**: the banner template, Update/Later buttons, `bannerHidden`.
- **Auto-apply**: when `needRefresh` flips true → if quiet (`!hasOpenOverlays() && !syncStore.isSyncing`), call `applyUpdate()` now; else arm the route-guard to `applyUpdate()` on the next quiet navigation.
- **One apply path, race-guarded**: a single `applyUpdate()` with a module-scoped `applying` boolean (early-return if already applying — `needRefresh` and a concurrent navigation can both reach it). It writes `pwa-post-update-route` (Approach B), `await updateServiceWorker()`, then reloads. On throw → `console.warn('[pwa] service worker update failed, hard-reloading', e)` + **`hardReload()`** (a plain reload can't escape a stale SW; this path runs when the update threw). No second/parallel `setTimeout(reload)`.

### B. Single cross-reload signal — reuse `pwa-post-update-route` (no new flag)

The toast only needs to know "this reload was an applied update," which is exactly "`pwa-post-update-route` is present." So **do not add a `pwa-just-updated` key**. Both apply paths must write it before reload: the route-guard path already writes `to.fullPath`; the **immediate-apply path** (quiet idle, no navigation) must also write `pwa-post-update-route = router.currentRoute.value.fullPath` (via the imported router singleton) so it isn't toast-less. One key, both paths, no second flag/try-catch. Add a comment at the `App.vue` read site noting the key now carries **two** meanings (resume-route AND update-toast trigger), so a future maintainer doesn't write it for a non-update reason and fire a false "updated!" toast.

### C. Fire the toast once on the post-update load

At the existing `pwa-post-update-route` read in `App.vue` onMounted (`~:582`, after `router.isReady()`), capture `const justUpdated = !!postUpdatePath` **before** removing the key (the early read still handles route-resume). **Fire the toast at the END of onMounted — after the heavy init/data-load has run and the UI has painted — NOT inline at `:582`**: non-error toasts auto-dismiss after 5s (`useToast.ts:136`), and a cold post-update load can exceed 5s before first paint, so an early toast would vanish unseen. At end-of-init, if `justUpdated`, call `showToast('info', t('pwa.updated'), t('pwa.updatedMessage'))`, **wrapped in its own try/catch** (`console.warn('[pwa] …')`, no-op) so it can't bubble to the outer onMounted catch (the chunk-load → `hardReload()` recovery path). Mirrors `App.vue:201`.

### D. i18n

Add to `uiStrings.ts` `pwa.*`:

- `pwa.updated` (toast title) + `pwa.updatedMessage` (subtitle), each with `en` + `beanie`.
  Remove the now-dead `pwa.updateAvailable`, `pwa.updateButton`, `pwa.updateDismiss`. Run `npm run translate`; verify parser + zh.

### E. Copy candidates (flag for greg's voice review)

| Mode     | Title (`pwa.updated`)          | Subtitle (`pwa.updatedMessage`)                         |
| -------- | ------------------------------ | ------------------------------------------------------- |
| `en`     | "You're on the latest version" | "We're always improving your beanies.family experience" |
| `beanie` | "fresh beans served!"          | "we're always growing — every bean counts"              |

(Greg to confirm/tweak — per his "marketing feature" framing.)

## Files Affected

- **Delete** `src/components/common/UpdatePrompt.vue`. **Add** `src/composables/usePwaUpdater.ts` — `useRegisterSW` (once, singleton), poll via `usePollWhileVisible`, quiet-defer route-guard (router module singleton), immediate-apply-when-quiet, `pwa-post-update-route` write on both paths, `applying` race-guard, `[pwa]`-logged `hardReload()` fallback, `__resetPwaUpdaterForTesting()`. (No hand-rolled `setInterval`/`visibilitychange` — `usePollWhileVisible` owns those + cleanup.)
- `src/App.vue` — call `usePwaUpdater()` in setup; remove the `<UpdatePrompt />` import + tag (`:10`, `:1280`); capture `justUpdated` at the existing `pwa-post-update-route` read (`~:582`) and fire the `info` toast at **end-of-init** (own try/catch).
- `src/services/translation/uiStrings.ts` — add `pwa.updated` + `pwa.updatedMessage` (en+beanie); remove `pwa.updateAvailable`/`updateButton`/`updateDismiss`.
- (generated) zh translations via `npm run translate`.
- **Reused (no change)**: `src/composables/usePollWhileVisible.ts` (the poll primitive), `src/composables/useStaleTabRefresh.ts` (singleton/effectScope/reset-hook template), `src/composables/useToday.ts` (single visibilitychange sink), `src/utils/safeServiceWorkerUpdate.ts`, `src/utils/hardReload.ts`. `vite.config.ts` — registerType stays `'prompt'` (verify only).
- **Stale references to fix after deleting `UpdatePrompt.vue`** (so future readers don't hunt a deleted file): the comment at `vite.config.ts:59` ("the UpdatePrompt is the intended control surface"), `App.vue:576` comment ("UpdatePrompt's route guard saves…"), `docs/TRANSLATION.md:146`, and `docs/STATUS.md:1370`. Leave dated historical `docs/plans/*.md` entries untouched.
- Docs: `CHANGELOG.md`, `docs/STATUS.md`.

## Acceptance Criteria

- [ ] No "update available" prompt/banner appears anywhere; `pwa.updateAvailable`/`updateButton`/`updateDismiss` removed and unreferenced.
- [ ] When a new SW is ready and the app is quiet, it auto-applies (reloads) without user action; when mid-edit/syncing, it defers to the next quiet navigation.
- [ ] After an applied update, the user lands on the route they were on (`pwa-post-update-route` preserved) and sees exactly one `info` toast ("you're on the latest version …").
- [ ] The toast does NOT appear on an ordinary manual refresh or first install.
- [ ] `registerType` remains `'prompt'`; `skipWaiting`/`clientsClaim` remain unset (no `vite.config.ts` change).
- [ ] New i18n keys present in both `en` and `beanie`; `npm run translate` regenerates zh cleanly; copy approved by greg.
- [ ] `npm run validate` green (type-check + lint + format + unit + build).

## Testing Plan

1. **Unit:** mock `pwa-just-updated` in `sessionStorage` + `showToast` → assert the toast fires once and the flag is cleared (App.vue init logic, or extract to a tiny tested helper). Assert the quiet-gate decision (apply-now vs defer) given `hasOpenOverlays()`/`isSyncing` (mock `virtual:pwa-register/vue`).
2. **Manual (the real proof):** local `npm run build` + preview, install as PWA; bump the build, rebuild, and confirm: (a) no prompt, (b) auto-reload when idle, (c) the post-update toast appears once, (d) deferral while a modal/save is open.
3. **Prod smoke:** after deploy, with the app open, push a follow-up deploy → confirm the app auto-updates within the poll window and shows the toast (firehose/console for `[serviceWorker]`).
4. `npm run validate` green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the auto-apply-without-prompt design — keep `registerType:'prompt'` (avoid the documented iPhone-Safari skipWaiting loop), drive update on a quiet moment, set a `pwa-just-updated` flag, fire a single `info` confirmation toast on the post-update load in `App.vue`; remove the banner + dead i18n keys; on-brand copy candidates for greg's review.
- **Pass 2 (DRY + error handling)**: Resolved the component-vs-composable fork → **`usePwaUpdater()` composable + delete `UpdatePrompt.vue`** (render-less component would be dead weight). Eliminated the proposed `pwa-just-updated` flag — **reuse the existing `pwa-post-update-route` signal** (immediate-apply path now also writes it). Caught two silent-failure/correctness gaps in the kept code: the `setInterval` poll leak (no `clearInterval`) → clear in `onScopeDispose`; and `performUpdate()`'s empty `catch {}` + plain `location.reload()` → log `[pwa]` + `hardReload()` (stale-SW-safe). Scoped the post-update toast in its own try/catch so it can't misfire the outer chunk-load `hardReload` path. All line refs verified accurate.
- **Pass 3 (Sustainability)**: Stopped reinventing existing primitives — **poll via `usePollWhileVisible`** (owns timer + visible-gate + fire-on-focus + cleanup; subsumes the `setInterval` _and_ the `visibilitychange` listener), and **mirror `useStaleTabRefresh`'s singleton (`initialized` + `effectScope(true)` + `__resetPwaUpdaterForTesting`)** so `useRegisterSW` runs once and the quiet-gate is testable. Removed the new `visibilitychange` listener (violates the documented single-sink invariant — `useToday.ts`). Race-guarded `applyUpdate()` with a module-scoped `applying` flag + a single reload path. Documented the dual-purpose of `pwa-post-update-route` at the read site, the registerType-stays-'prompt' invariant in the composable header, and listed the stale references to fix after deleting the component (`vite.config.ts:59`, `App.vue:576`, `docs/TRANSLATION.md:146`, `docs/STATUS.md:1370`).
- **Pass 4 (Fresh-eyes sweep)**: Caught a blocker — `useRouter()` is `inject`-based and returns `undefined` in the detached `effectScope`; switched to the router **module singleton** (`import router from '@/router'`) for the guard + `currentRoute.value.fullPath` (matches why `useStaleTabRefresh` avoids inject). Caught a toast-timing bug — `info` toasts auto-dismiss at 5s, so firing at `:582` before a cold load paints would vanish unseen; now capture `justUpdated` early but **fire the toast at end-of-init**. Added the unsaved-raw-input accepted-risk note, fixed stale Files-Affected wording (no hand-rolled `setInterval`/`visibilitychange`). Confirmed `usePollWhileVisible`'s `fireImmediatelyOnVisible` option, `'info'` toast support, the `pwa-post-update-route` reuse, and the dead i18n keys all check out.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Lead-in question (greg, after the SW-toast was flagged out of scope)

> I'm not seeing The 'new version' toast anymore - perhaps we were several versions behind, but as i've seen this several times, how should we handle the use case where a user is multiple builds behind the latest - do they always need to cycle through multiple update toasts, or can we always consolidate all updates to a single toast rather than showing it multiple times? Since we tend to push multiple updates and sometimes deploy to prod several times a day, it is possible that a user that hasn't logged in for several days may be multiple updates behind. how can we ensure they only get one update toast that takes them to the latest head rather than several in a row?

### Plan request (this plan, /beanies-plan)

> I would agree to apply the autoUpdate approach, but to also ensure that there is a confirmation toast informing users that a new version has been applied - more of a marketing feature than a question for users. We always want users on the latest version, but we should also make it clear to users when their app version has been updated, both for informational as well as marketing purposes (i.e. we are always working on improving your experience). can we implement this, and ensure new updates are always applied as soon as they are available with an informational toast once done?

</details>
