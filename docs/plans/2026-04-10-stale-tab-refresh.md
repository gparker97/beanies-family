# Plan: Stale Tab Refresh

> Date: 2026-04-10
> Related issues: none (user-reported quality-of-life issue)

## Context

When users leave the beanies.family tab open overnight or their PC sleeps for hours, they return to stale data:

- Recurring transactions for the new day aren't generated (`processRecurringItems` only runs at init)
- Exchange rates may be outdated
- Remote changes from other devices aren't reflected

The app already has visibility handling in `App.vue:626-654` that pauses/resumes file polling and calls `reloadIfFileChanged()`, but it has no concept of **how long** the tab was idle or whether a **day boundary** was crossed.

## Approach

Create a composable `useStaleTabRefresh` with two staleness tiers and sleep/wake detection.

### New file: `src/composables/useStaleTabRefresh.ts`

**Internal state:**

- `lastActiveAt: number` — `Date.now()` when tab was last active
- `lastActiveDate: string` — `YYYY-MM-DD` when tab was last active (for day boundary detection)
- `heartbeatTimer` — 30s `setInterval` for sleep/wake detection
- `isRefreshing: Ref<boolean>` — prevents concurrent refreshes
- `started: boolean` — gate so nothing fires before init completes

**API:**

```ts
export function useStaleTabRefresh(callbacks: {
  onHide: () => void; // saveWithKeyRecovery
  onReconnect: () => Promise<void>; // attemptSilentReconnect
}): {
  start: () => void;
  stop: () => void;
  isRefreshing: Readonly<Ref<boolean>>;
};
```

**Sleep detection heartbeat:**

- `setInterval` every 30s updates `lastActiveAt`
- If elapsed between ticks > 60s → machine was asleep → run `handleWake(elapsed)`

**Visibility change handler (replaces `App.vue:handleVisibilityChange`):**

On **hidden**:

- Record `lastActiveAt = Date.now()`, `lastActiveDate = toDateInputValue(new Date())`
- `syncStore.pauseFilePolling()`
- Call `callbacks.onHide()` (save)

On **visible**:

- Calculate `elapsed = Date.now() - lastActiveAt`
- Calculate `dayCrossed = toDateInputValue(new Date()) !== lastActiveDate`
- Dispatch to tier

**Tier 0 — Short absence (< 5 min, same day):**

- Resume polling, silent reconnect, `reloadIfFileChanged()` — current behavior, unchanged

**Tier 1 — Long absence (5+ min) OR day boundary crossed:**

- Guard: `if (isRefreshing.value || !familyStore.isSetupComplete) return`
- `isRefreshing.value = true`
- Pause file polling (prevent concurrent reload during refresh)
- `reloadAllStores()` — refresh Pinia from in-memory Automerge doc
- `processRecurringItems()` — generate any missing recurring transactions
  - If `result.processed > 0` → reload transactions + goals stores
- `updateRatesIfStale()` — refresh exchange rates if >24h old
- `attemptSilentReconnect()` — refresh Google auth token
- Resume file polling
- `reloadIfFileChanged()` — check for remote changes
- `isRefreshing.value = false`

Day boundary detection uses `toDateInputValue(new Date())` from `src/utils/date.ts` — timezone-safe, already used throughout the app.

### Changes to `src/App.vue`

1. **Remove** the existing `handleVisibilityChange` function (lines 626-635) and its `document.addEventListener('visibilitychange', ...)` registration (line 646) and cleanup (line 651)

2. **Import and wire up** the composable:

```ts
const { start: startStaleRefresh, stop: stopStaleRefresh } = useStaleTabRefresh({
  onHide: saveWithKeyRecovery,
  onReconnect: attemptSilentReconnect,
});
```

3. **Call `startStaleRefresh()`** after `syncStore.startDeferredPolling()` completes (after line 504) — ensures init is fully done before the composable activates

4. **Call `stopStaleRefresh()`** in `onUnmounted` — replaces the `visibilitychange` removeEventListener

5. **Keep** `beforeunload` and `online` handlers as-is (different concerns)

### Files affected

| File                                    | Change                                     |
| --------------------------------------- | ------------------------------------------ |
| `src/composables/useStaleTabRefresh.ts` | **New** — composable                       |
| `src/App.vue`                           | Replace visibility handler with composable |

### Existing functions reused

- `syncStore.pauseFilePolling()` / `resumeFilePolling()` — `syncStore.ts:1309-1317`
- `syncStore.reloadIfFileChanged()` — `syncStore.ts:1229`
- `syncStore.reloadAllStores()` — `syncStore.ts:1050`
- `processRecurringItems()` — `recurringProcessor.ts:28`
- `updateRatesIfStale()` — `exchangeRateService.ts:151`
- `useFamilyStore().isSetupComplete` — `familyStore.ts:25`
- `toDateInputValue()` — `utils/date.ts`

### Edge cases handled

- **Init not complete**: `started` gate prevents any handler from firing before `start()` is called
- **No family loaded**: Guard on `familyStore.isSetupComplete`
- **Concurrent refreshes**: `isRefreshing` ref prevents stacking
- **Tab hidden during refresh**: In-flight refresh completes; next visibility event sees short elapsed time
- **processRecurringItems idempotency**: Already deduplicates via `alreadyExists` check
- **Deferred polling**: Composable starts after `startDeferredPolling()`, no interference with init

## Verification

1. `npm run dev` — open app, switch away for > 5 min, switch back, verify `processRecurringItems` runs (check console logs)
2. Change system clock past midnight, switch tabs back — verify day boundary triggers full refresh
3. Verify no duplicate `processRecurringItems` calls during init
4. Verify `beforeunload` and `online` handlers still work
5. `npm run type-check` — no TypeScript errors
6. `npm run lint` — no lint errors
