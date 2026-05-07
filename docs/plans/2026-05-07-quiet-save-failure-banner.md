# Plan: Quiet the "Your data isn't being saved" red banner

> Date: 2026-05-07

## Context

The critical-severity red banner ("Your data isn't being saved") is firing more and more often, especially after overnight idle on both the PWA and the browser app. A manual page refresh almost always fixes it. The banner sits at `z-[250]` `fixed top-0` and physically covers `AppHeader` — which on standalone PWAs (no browser chrome) leaves the user with no in-app way to refresh.

### Root cause

The banner is a **stuck UI signal after auth has already self-healed**:

1. Tab JS suspends overnight; access token expires (1h TTL).
2. On wake, `useStaleTabRefresh` runs `processRecurringItems` (`src/composables/useStaleTabRefresh.ts:82`), which mutates the doc → fires `triggerDebouncedSave` 2s later (`src/services/sync/syncService.ts:1019`). Token is still stale, save fails, `recordSaveFailure` increments `consecutiveFailures` (`syncService.ts:728, 1039`).
3. Multiple silent-refresh attempts race the saves; on flaky-wake networks, ≥3 save failures land before silent refresh settles. `consecutiveFailures ≥ 3 → 'critical'` (`syncService.ts:178-186`) → banner shown (`src/stores/syncStore.ts:160-164`).
4. Silent refresh eventually succeeds — but `setupTokenExpiryHandler`'s `onTokenAcquired` callback only clears `showGoogleReconnect`, **not** `showSaveFailureBanner` (`syncStore.ts:1721-1729`). And no save is attempted post-recovery, so `recordSaveSuccess` never fires.
5. Banner sits there until the user mutates something or refreshes the page.

That's why a refresh "fixes" it: the underlying problem is already gone; the banner just doesn't know.

### CTA mismatch

- "Reconnect to Google Drive" duplicates `GoogleReconnectToast` (driven by `showGoogleReconnect`) — the canonical reconnect surface. Two-surface duplication.
- "Download backup" is panic-mode UX; already in Settings.
- No "Refresh" option, despite refresh being the actually-effective fix. Banner physically blocks AppHeader's existing refresh affordance.

## Approach

Three small, ordered changes. Each independently shippable. Designed for low coupling, named functions over inline callbacks, single-responsibility helpers, and defensive cleanup on store reset.

### 1. Clear the stuck banner on silent token recovery (root cause)

**File:** `src/stores/syncStore.ts:1721-1729`

Extend the existing `onTokenAcquired` handler with a sibling branch. No new mechanism — reuses `syncService.saveNow()` so success/failure naturally routes through the existing `recordSaveSuccess`/`recordSaveFailure` callback chain, which clears the banner via the existing event handler.

```ts
tokenAcquiredUnsub = onTokenAcquired(() => {
  if (showGoogleReconnect.value) {
    handleGoogleReconnected().catch((e) => {
      console.warn('[syncStore] auto-clear of reconnect banner failed', e);
    });
    return;
  }
  // Token healthy. If save-failure banner is up because saves failed during
  // a wake-time auth race, kick a save now: success → banner auto-clears via
  // recordSaveSuccess; failure → banner stays accurately up.
  if (saveFailureLevel.value === 'critical' && !driveFileNotFound.value) {
    syncService.saveNow().catch((e) => {
      console.error('[syncStore] post-token-acquired saveNow rejected unexpectedly', e);
      reportError({
        surface: 'syncStore',
        message: 'post-token-acquired saveNow rejected',
        error: e,
      });
    });
  }
});
```

`saveNow()` doesn't normally throw; this `catch` is defensive against unexpected rejections. Per `feedback_no_silent_failures.md`: classified, prefixed, reported. Non-critical → console + Slack, no toast (the failure-tracking system's own banner is the user-facing surface for real failures).

### 2. Defer the banner during in-flight recovery — extract a named handler

**File:** `src/services/google/googleAuth.ts` — one new exported sync getter near `pendingSilentRefresh` at line 535:

```ts
export function isSilentRefreshPending(): boolean {
  return pendingSilentRefresh !== null;
}
```

**File:** `src/stores/syncStore.ts:157-165` — replace the existing inline `onSaveFailureChange` callback with two named, single-responsibility helpers inside the store setup. Mutable timer state stays scoped to the store closure (cleared on `resetState`), not module-level.

```ts
// Banner display owned in this store. The timer covers a brief wake-time
// race where saves fail before silent refresh settles; we delay alarming
// the user until the recovery window has had a fair shot. See plan
// 2026-05-07 / docs/STATUS.md.
const BANNER_DEFER_MS = 5000;
let bannerDeferTimer: ReturnType<typeof setTimeout> | null = null;

function cancelBannerDefer(): void {
  if (bannerDeferTimer) {
    clearTimeout(bannerDeferTimer);
    bannerDeferTimer = null;
  }
}

function showBannerWithTelemetry(deferred: boolean): void {
  showSaveFailureBanner.value = true;
  reportError({
    surface: 'save-failure-banner',
    message: deferred
      ? 'banner shown after deferred recovery window'
      : 'banner shown immediately (no recovery in flight)',
    context: { lastSaveError: lastSaveError.value, deferred },
  });
}

function handleSaveFailureChange(level: SaveFailureLevel, failError: string | null): void {
  cancelBannerDefer();
  saveFailureLevel.value = level;
  lastSaveError.value = failError;

  if (level !== 'critical') {
    showSaveFailureBanner.value = false;
    return;
  }

  if (!isSilentRefreshPending()) {
    showBannerWithTelemetry(false);
    return;
  }

  // Recovery in flight. Defer; fix #1 (saveNow on tokenAcquired) usually
  // clears the failure within this window. If not, alarm the user.
  bannerDeferTimer = setTimeout(() => {
    bannerDeferTimer = null;
    if (saveFailureLevel.value !== 'critical') return; // recovery worked
    showBannerWithTelemetry(true);
  }, BANNER_DEFER_MS);
}

syncService.onSaveFailureChange(handleSaveFailureChange);
```

Inside `resetState()` at line 1434, add `cancelBannerDefer()` so the timer doesn't survive sign-out. Without this, a sign-in/sign-out/sign-in cycle could leave a stale timer that fires against the new session. Matches the existing `stopFilePolling()` cleanup pattern in the same function.

Telemetry comes for free via `showBannerWithTelemetry` — every banner show is reported with `deferred: true|false`, giving us a closed loop to confirm the fix lands.

### 3. Banner CTA + position redesign

The banner becomes single-action for the auth-stuck branch. The reconnect surface stays in `GoogleReconnectToast` — no duplication.

**File:** `src/components/google/SaveFailureBanner.vue` — simplify the **else branch** (auth-stuck) only. The `fileNotFound` branch is preserved unchanged (it's a real permanent state with correct UX: file picker + Settings link).

Remove from else branch (deletes ~30 lines + several imports):

- `Download backup` button + `handleDownloadBackup` + imports `reEncryptEnvelope`, `downloadAsFile`, `getFamilyKey`, `getEnvelope` + `isDownloading` ref
- `Reconnect to Google Drive` button + `handleReconnect` + import `useGoogleReconnect` + `isReconnecting` destructure

Add to else branch:

```vue
<button
  class="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
  @click="handleRefresh"
>
  {{ t('googleDrive.saveFailureRefresh') }}
</button>
```

```ts
import { hardReload } from '@/utils/hardReload';
import { reportError } from '@/utils/errorReporter';

function handleRefresh(): void {
  // Fire-and-forget. hardReload navigates away on success; its internal
  // try/catch falls through to location.replace even on SW-cleanup error,
  // so the only reachable rejection here is the unreachable case where
  // location.replace itself throws. No isRefreshing state needed: the
  // page is unloading; double-clicks are harmless (operations are idempotent).
  hardReload().catch((e) => {
    console.error('[SaveFailureBanner] hardReload threw unexpectedly', e);
    showToast('error', t('error.refreshFailed'), t('error.refreshFailedHelp'));
    reportError({ surface: 'save-failure-banner', message: 'hardReload threw', error: e });
  });
}
```

`hardReload()` is the canonical refresh primitive (`src/utils/hardReload.ts:30`) — evicts SW precache before navigating. `location.reload()` won't survive a stale service worker.

**File:** `src/components/common/ErrorBanner.vue:33`

Switch from fixed-top to inline-flow positioning. Banner becomes part of document flow, pushing AppHeader down instead of covering it. Transition (`-translate-y-full → translate-y-0`) works the same inline:

```diff
- class="fixed top-0 right-0 left-0 z-[250] px-4 py-3 text-white shadow-lg"
+ class="w-full px-4 py-3 text-white shadow-lg"
```

Update the docstring at line 1-12 — `PhotoAccessRecoveryBanner` is referenced but doesn't actually exist in the codebase; remove that reference.

**File:** `src/stores/syncStore.ts` — add a single computed that rolls up the sync-side display logic, so App.vue's gate stays simple and the rule "banner is mutually exclusive with reconnect toast" lives in the store, not the template:

```ts
const shouldShowSaveFailureBanner = computed(
  () => showSaveFailureBanner.value && !showGoogleReconnect.value
);
// expose alongside showSaveFailureBanner in the return block
```

**File:** `src/App.vue:965-969`

Move `<SaveFailureBanner>` from its current location to the top of the app shell, **above** `<AppHeader>`. Switch the gate to the new computed:

```diff
- <SaveFailureBanner
-   :show="syncStore.showSaveFailureBanner && !authStore.needsAuth"
-   :file-not-found="syncStore.driveFileNotFound"
-   @reconnected="handleGoogleReconnected"
- />
+ <SaveFailureBanner
+   :show="syncStore.shouldShowSaveFailureBanner && !authStore.needsAuth"
+   :file-not-found="syncStore.driveFileNotFound"
+   @reconnected="handleGoogleReconnected"
+ />
```

The `@reconnected` emit stays — still emitted by the file-not-found branch's `handleReselectFile` after successful recovery.

**File:** `src/services/translation/uiStrings.ts`

Add 3 keys (en + beanie variants per CLAUDE.md):

- `googleDrive.saveFailureRefresh` — `en: 'Refresh app'` / `beanie: 'refresh app'`
- `error.refreshFailed` — `en: 'Refresh failed'` / `beanie: "couldn't refresh"`
- `error.refreshFailedHelp` — `en: 'Try closing and reopening the app.'` / `beanie: 'try closing and reopening the app.'`

Delete unused keys (verify no other consumers via `grep` first; only delete lines confirmed unused):

- `googleDrive.downloadBackup`
- `googleDrive.downloadBackupUnavailableTitle/Body`
- `googleDrive.downloadBackupFailedTitle/Body`

After edits: `npm run translate` to sync Chinese (per CLAUDE.md translation pipeline rules).

## Files affected

**Modify (5 source + 1 strings):**

- `src/stores/syncStore.ts` — fixes #1 + #2 + #3 (extract `handleSaveFailureChange`, `cancelBannerDefer`, `showBannerWithTelemetry` named helpers; add `shouldShowSaveFailureBanner` computed; clear timer in `resetState`)
- `src/services/google/googleAuth.ts` — add `isSilentRefreshPending` exporter
- `src/components/google/SaveFailureBanner.vue` — fix #3 (replace download/reconnect with single fire-and-forget Refresh button)
- `src/components/common/ErrorBanner.vue` — fix #3 (inline-flow positioning; docstring fix)
- `src/App.vue` — fix #3 (move banner above AppHeader; switch to `shouldShowSaveFailureBanner`)
- `src/services/translation/uiStrings.ts` — 3 new keys; delete unused download-backup keys after grep confirms no consumers

**Test (2 new, run existing):**

- `src/stores/__tests__/syncStore.bannerVisibility.test.ts` (new) — covers fix #1 + #2 in one focused file:
  - banner clears + `saveNow` is called when `onTokenAcquired` fires while `saveFailureLevel === 'critical'`
  - `driveFileNotFound` guard prevents the post-recovery `saveNow` call
  - banner deferred 5s when `isSilentRefreshPending()` returns true
  - banner stays hidden if level returns to 'none' during defer window
  - banner shown after timeout if level stays critical
  - timer cleared on `resetState()` (call resetState mid-defer; assert no banner appears after timer would have fired)
- `src/components/google/__tests__/SaveFailureBanner.test.ts` (new) — covers fix #3:
  - Refresh button rendered + invokes `hardReload`
  - Reconnect button removed from DOM
  - Download backup button removed from DOM
  - File-not-found branch unchanged (reselect + Settings link still render)
- Existing `src/services/sync/__tests__/saveFailureTracking.test.ts` — unchanged, still passes (counter logic untouched).

## Reuse — no duplication

| Need                       | Reused from                                                                                  | Why I'm not adding new                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hard refresh primitive     | `src/utils/hardReload.ts:30`                                                                 | Already canonical; handles SW precache eviction, falls through to `location.replace`. `location.reload()` doesn't survive a stale SW. |
| Reconnect UI surface       | `src/components/google/GoogleReconnectToast.vue` (driven by `showGoogleReconnect`)           | Already the canonical reconnect surface. Banner gates against it via the new `shouldShowSaveFailureBanner` computed.                  |
| Save-failure tracking      | `recordSaveFailure` / `recordSaveSuccess` / `getSaveFailureLevel` (`syncService.ts:178-228`) | Mechanism unchanged; we only restructure what consumes its output.                                                                    |
| Permanent-expiry self-heal | `handleGoogleReconnected` (`syncStore.ts:1469-1481`)                                         | Untouched; fix #1 adds a sibling branch in the same callback, doesn't modify the existing path.                                       |
| Silent-refresh dedup       | `pendingSilentRefresh` + `attemptSilentRefresh` (`googleAuth.ts:535-552`)                    | Read via new sync getter; no logic changes inside auth.                                                                               |
| Banner chrome              | `ErrorBanner.vue`                                                                            | Reused; only its position class changes. Single consumer (`SaveFailureBanner`) — no other components break.                           |
| File-not-found UX          | `usePickBeanpodFile` + `recoverFromMissingFile`                                              | Untouched; that branch is preserved verbatim.                                                                                         |
| Error reporting            | `reportError` (`src/utils/errorReporter.ts`)                                                 | Same pattern used by `useStaleTabRefresh.ts:86-91`.                                                                                   |

## Maintainability notes

- **Named functions over inline callbacks.** `handleSaveFailureChange`, `cancelBannerDefer`, `showBannerWithTelemetry` — each has a single responsibility documented in 1-2 lines. The store's `onSaveFailureChange` wire-up reads as one line: `syncService.onSaveFailureChange(handleSaveFailureChange)`. Future readers see _what_ in the wire-up and _how_ in the named functions.
- **Closure-scoped timer, not module-scoped.** `bannerDeferTimer` lives inside `defineStore` setup, lifetime-bound to the store instance. Cleared on `resetState()` so sign-in/sign-out cycles don't leak timers.
- **Single computed for display rule.** `shouldShowSaveFailureBanner` rolls up the "banner mutually exclusive with reconnect toast" rule. Lives in the store, not duplicated across templates. If the rule needs to change later, one place to edit.
- **Telemetry as a side effect of one helper, not scattered `reportError` calls.** Adding more telemetry classifications later means editing one function (`showBannerWithTelemetry`), not hunting through callback bodies.
- **No new abstraction layer.** Considered extracting a `useSaveFailureBannerController` composable but the logic is small (~25 lines), the dependencies (`syncService`, `googleAuth`, refs) are already store-coupled, and the store is already the natural owner of `showSaveFailureBanner`. A separate composable would be a ceremony layer without a clear ownership win. Revisit only if a second consumer of the same logic emerges.
- **No new mutable module-level state.** All state is store-scoped (timer in closure) or already-existing (refs, callback registrations).
- **Fire-and-forget hardReload.** No `isRefreshing` ref, no disabled state, no `'...'` placeholder. The page is unloading; tracking transient state would be ceremony with no UX payoff. Double-clicks are safe because every operation in `hardReload` is idempotent.

## Silent-failure audit (per `feedback_no_silent_failures.md`)

Every new `catch` is classified, prefixed, and reported. No bare `catch {}`.

| Path                                     | Failure mode                                                               | Handling                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onTokenAcquired` → `saveNow` rejection  | Unexpected (saveNow has internal try/catch)                                | `console.error` with prefix + `reportError` (Slack). Non-critical: real save failures are already counted by `recordSaveFailure` and surfaced via the banner. |
| `handleSaveFailureChange` body           | None — synchronous setters + `setTimeout`                                  | n/a                                                                                                                                                           |
| Defer-timer callback                     | None — synchronous setters                                                 | n/a                                                                                                                                                           |
| `handleRefresh` → `hardReload` rejection | Unreachable in practice (`hardReload` falls through to `location.replace`) | `console.error` + toast (`error.refreshFailed` + help text) + `reportError`. User-visible: page didn't reload as expected, they need to know.                 |

Existing pre-bug pattern at `AppHeader.handleRefreshAll:222` (`catch { showToast('warning', ...) }` — no classification, no `reportError`) is **not in scope** but flagged here for a separate cleanup PR.

## Verification

**Unit + type:**

```bash
npm run test -- syncStore.bannerVisibility
npm run test -- SaveFailureBanner
npm run test -- saveFailureTracking
npm run type-check
npm run translate            # confirm parser still works after uiStrings edits
```

**Manual repro (forced banner state):**

1. `npm run dev`, sign in with Google Drive.
2. Make a small mutation; confirm save succeeds.
3. Force banner via Vue DevTools: set `syncStore.showSaveFailureBanner = true`, `syncStore.saveFailureLevel = 'critical'`.
4. Confirm: AppHeader is still clickable (banner pushed it down, didn't cover it).
5. Click "Refresh app" → page reloads via `hardReload()`; banner gone post-reload.
6. Confirm: no Reconnect button (since `showGoogleReconnect = false`); no Download backup.

**Manual repro (real wake-up scenario):**

1. Sign in, make a mutation, leave tab idle 70+ minutes (token expires; silent refresh hasn't run).
2. Return to tab. Watch the network tab + console.
3. **Expected:** silent refresh fires on `visibilitychange`. If wake race produced any save failures, fix #2's 5s defer absorbs the blip; fix #1's `saveNow` on token-acquired clears the banner. **Net UI: no banner shown.** If a banner does show, telemetry tells us why (`deferred: true|false` + `lastSaveError`).

**Mutual-exclusion check:**

1. Force `showGoogleReconnect = true` AND `showSaveFailureBanner = true`.
2. Confirm: only the reconnect toast (bottom-right) is visible; banner is suppressed by `shouldShowSaveFailureBanner` returning false.
3. Click Reconnect: toast clears, `handleGoogleReconnected` runs, fix #1 fires `saveNow`, banner stays clear.

**Layout regression check:**

- Sidebar opens/closes correctly with banner visible.
- Bottom mobile-nav unaffected.
- AppHeader profile dropdown opens correctly when banner is visible (banner pushes header down, doesn't overlap).
- PWA standalone-mode: install PWA, force banner, confirm Refresh works and AppHeader stays interactive.

**Production telemetry (post-deploy, 7-14 days):**
Watch `#beanies-errors` for `surface: save-failure-banner`:

- `deferred: true` events → recovery window may be too short; tune `BANNER_DEFER_MS`.
- `deferred: false` events → genuine save failures, separate investigation.
- Overall rate should drop sharply for the wake-up case.

## Out of scope (deliberately)

- Reordering `useStaleTabRefresh` (silent reconnect before `processRecurringItems`). Tempting; riskier; made invisible by fixes #1 + #2.
- Changing the failure threshold from 3. Definition stays; only the surfacing changes.
- Cleaning up `AppHeader.handleRefreshAll`'s under-classified catch (line 222) — separate PR.
- File-not-found branch UX (`driveFileNotFound`) — real permanent state, correct UX; preserved verbatim.
- Extracting a `useSaveFailureBannerController` composable — premature abstraction at current scope; revisit if a second consumer emerges.
