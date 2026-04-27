# Plan: Tab/PWA freshness — reactive `today` + simplified stale-tab refresh

> Date: 2026-04-27
> Replaces: `docs/plans/2026-04-10-stale-tab-refresh.md` (rewritten in place)
> Related: none filed — user-reported quality-of-life bug ("PWA shows yesterday's data when first opened")

---

## Context

Two related bugs share one symptom: opening the PWA (or switching back to the browser tab) on a new day shows the previous day's data, and a backgrounded laptop misses recurring transactions, exchange-rate refreshes, and remote Drive changes.

**Problem A — UI staleness across midnight.** No reactive "today" exists. Every consumer either calls `new Date()` inside a `computed` (which only re-runs on its other reactive deps, not on a wall-clock advance) or assigns today once into a `ref` at mount. Worst offender: `activityStore.ts:159` (`upcomingActivities`).

**Problem B — Data staleness on long absence.** App on wake doesn't re-run `processRecurringItems()`, doesn't refresh exchange rates, and doesn't pull remote Drive changes. Previously specced in the April 10 plan with a 30s heartbeat + tier dispatch.

Both share the same triggers (`visibilitychange`, midnight cross). Combining lets us land **a single event-listener registration** for the whole app's wake-detection, drop the heartbeat, and end up with two small, decoupled composables and a per-step error-classified refresh.

---

## Approach

**Two composables. One owns the listeners + reactive state. The other is pure orchestration that watches that state. Neither registers events the other registers.**

### 1. `src/composables/useToday.ts` — single event sink

Module-scoped singleton matching `useOnline.ts` exactly: `let initialized`, lazy `init()`, `readonly()` exposure, listeners persist for app lifetime. No `onScopeDispose` (skip the no-op `useBreakpoint` adds — cleaner shape).

```ts
useToday(): {
  today:         Readonly<Ref<string>>;     // YYYY-MM-DD, local
  startOfToday:  ComputedRef<Date>;
  isVisible:     Readonly<Ref<boolean>>;
  lastVisibleAt: Readonly<Ref<number>>;     // Date.now() of last hidden→visible
  lastHiddenAt:  Readonly<Ref<number>>;     // Date.now() of last visible→hidden
}
```

**Updates fire on:** `visibilitychange`, `pageshow` (when `e.persisted`), and a self-rearming midnight `setTimeout`. The midnight delay is **always recomputed from `new Date(y, m, d+1, 0, 0, 0)`** (DST-safe — never `prev + 86_400_000`) and the timer is **always cleared and rearmed on visibility-becomes-visible** (since `setTimeout` is unreliable across device sleep).

**Failure surface:** none worth catching. Every internal operation is a ref mutation or a string compare on values `useToday` itself produced. Adding try/catch here would be code bloat without a failure mode to handle.

**Code comment to add in `utils/date.ts` near the consolidated `localToday()`:**

> `/** For one-shot reads only. Reactive UI consumers should read \`useToday().today\` instead — that ref auto-advances at midnight and on tab wake. \*/`

This is the only structural guardrail against future contributors silently re-introducing the bug.

### 2. `src/composables/useStaleTabRefresh.ts` — pure orchestration

Imports `useToday`, `useFamilyStore`, `useSyncStore`, `processRecurringItems`, `updateRatesIfStale`, `attemptSilentRefresh`, `showToast`, `useTranslation`. The import list is intentionally the orchestration boundary — this is the **single place** in the codebase that knows the wake-time refresh sequence.

```ts
useStaleTabRefresh(): {
  isRefreshing: Readonly<Ref<boolean>>;     // exposed so App could render a tiny indicator if desired
}
```

**Logic:**

```ts
const LONG_ABSENCE_MS = 5 * 60 * 1000;
const isRefreshing = ref(false);
let initialized = false;

export function useStaleTabRefresh() {
  if (!initialized) {
    initialized = true;
    const { today, isVisible, lastVisibleAt } = useToday();

    watch(today, () => void run('day-changed'));
    watch(isVisible, (now, prev) => {
      if (!now || prev) return;
      if (Date.now() - lastVisibleAt.value >= LONG_ABSENCE_MS) void run('long-absence');
    });
  }
  return { isRefreshing: readonly(isRefreshing) };
}
```

**`run(reason)` — single linear function, inlined steps, per-step try/catch:**

```
guard: if (isRefreshing.value || !familyStore.isSetupComplete) return;
isRefreshing.value = true;
syncStore.pauseFilePolling();
console.info('[useStaleTabRefresh] start', reason);
try {
  // 1. Critical: reload Pinia stores from in-memory Automerge.
  //    On failure, abort downstream — they assume current state.
  try { await syncStore.reloadAllStores(); }
  catch (e) {
    console.error('[useStaleTabRefresh] reloadAllStores', e);
    showToast('error',
      t('errors.backgroundRefresh.reload.title'),
      t('errors.backgroundRefresh.reload.help'));
    return;  // wrapped in finally below — cleanup still runs
  }

  // 2. Non-critical, sequential (depends on step 1's current state).
  //    Idempotent via `alreadyExists` dedup — safe to retry next wake.
  try { await processRecurringItems(); }
  catch (e) { console.warn('[useStaleTabRefresh] processRecurringItems', e); }

  // 3. Non-critical, parallel (independent subsystems).
  //    attemptSilentReconnect is the SHARED wrapper (see "Shared utility" below) —
  //    handles the "reconnected" toast when there was a prior visible error.
  const [rates, reconnect] = await Promise.allSettled([
    updateRatesIfStale(),
    attemptSilentReconnect(),
  ]);
  if (rates.status === 'rejected')
    console.warn('[useStaleTabRefresh] updateRatesIfStale', rates.reason);
  if (reconnect.status === 'rejected')
    // SaveFailureBanner + syncStore.showGoogleReconnect already cover the user-facing path.
    console.warn('[useStaleTabRefresh] attemptSilentReconnect', reconnect.reason);

  // 4. Non-critical, last by design (see "Order assumption" below).
  try { await syncStore.reloadIfFileChanged(); }
  catch (e) { console.warn('[useStaleTabRefresh] reloadIfFileChanged', e); }
} finally {
  syncStore.resumeFilePolling();
  isRefreshing.value = false;
  console.info('[useStaleTabRefresh] done');
}
```

**Shared utility — `attemptSilentReconnect()`:** the existing wrapper in `App.vue:691-714` does the right thing (tries `attemptSilentRefresh`, fires the "reconnected" toast + `syncStore.handleGoogleReconnected()` only when there was a visible error) but is local to App.vue AND swallows errors with a bare `catch {}`. Extract it to `src/services/google/googleAuth.ts` (alongside `attemptSilentRefresh`) as `export async function attemptSilentReconnect(): Promise<void>`, replace the bare catch with `console.warn('[attemptSilentReconnect]', e)`, and have both App.vue (the `online` handler at line 747) and `useStaleTabRefresh` import the shared version. The module-scoped `isReconnecting` guard moves to the utility too. **Net DRY win:** one source of truth for silent reconnect, one fewer silent catch in the codebase.

**Step ordering is deliberate** (document this in a code comment):

> Steps run in order so that local state is current before we ask Drive for deltas. `reloadIfFileChanged` runs LAST and can overwrite freshly-generated recurring tx with a slightly-older Drive view — that's accepted because (a) `processRecurringItems` is idempotent via `alreadyExists`, so the next wake re-generates anything truncated, and (b) doing the Drive delta first risks generating recurring tx against stale local state, which is harder to detect.

**Error policy — explicit, not silent:**

| Step                  | Severity     | User surface                                | Dev surface                                                     |
| --------------------- | ------------ | ------------------------------------------- | --------------------------------------------------------------- |
| reloadAllStores       | Critical     | `showToast('error', ...)` with title + help | `console.error('[useStaleTabRefresh] reloadAllStores', e)`      |
| processRecurringItems | Non-critical | none — retries next wake                    | `console.warn('[useStaleTabRefresh] processRecurringItems', e)` |
| updateRatesIfStale    | Non-critical | none — cached rates render                  | `console.warn`                                                  |
| attemptSilentRefresh  | Non-critical | none — SaveFailureBanner already handles    | `console.warn`                                                  |
| reloadIfFileChanged   | Non-critical | none — next polling tick retries            | `console.warn`                                                  |

No `try/catch` in the codebase swallows these — every catch logs with the `[useStaleTabRefresh]` prefix and the original `Error` object, so the stack and message are visible. Critical failures surface to users via the existing 2-line `showToast(type, title, help)` pattern; non-critical failures are deliberately quiet because their natural fallback (cached rates, retry, existing banner) is already user-visible. No new error UI invented.

### 3. `src/App.vue` — no new event listeners

- **Remove** `handleVisibilityChange` (lines 730–739), its `addEventListener` (line 750), and its cleanup (line 755).
- **Add** `useStaleTabRefresh()` after `syncStore.startDeferredPolling()` resolves.
- **Add** a single watcher for save-on-hide, replacing the hide branch of the removed handler:
  ```ts
  const { isVisible } = useToday();
  watch(isVisible, (visible) => {
    if (!visible) saveWithKeyRecovery();
  });
  ```
- **Keep** `beforeunload` (different concern: page termination) and `online` handlers as-is.

**Net listener count for the visibility/wake surface across the whole app: one `visibilitychange`, one `pageshow`, one timer.** Down from two `visibilitychange` registrations today (App.vue + UpdatePrompt.vue:97 — note: UpdatePrompt's listener is for SW-update checks, distinct concern, leave alone).

### 4. Call-site sweep

Bug-fix sites — replace one-shot `today` reads with `useToday().today.value` / `useToday().startOfToday.value`:

- `src/stores/activityStore.ts:159` (the primary reported bug)
- `src/stores/medicationsStore.ts:33,73` — call sites use `useToday().today.value`; local `localToday()` helper moves to `utils/date.ts`. **`isMedicationActive(m: Medication)` becomes `isMedicationActive(m: Medication, today: string)` — the helper stays a pure function, the caller (in computed contexts) reads `today` reactively.** This keeps `isMedicationActive` testable as a pure function and prevents a non-reactive read from being hidden inside an apparently-pure helper.
- `src/stores/vacationStore.ts:24`
- `src/composables/useBeanTips.ts:56` — call sites; local `todayISO()` helper deleted (already in `utils/date.ts` after consolidation)
- `src/composables/useNetWorthHistory.ts:56`
- `src/composables/useProjectedTransactions.ts:18,24`
- `src/composables/useMonthOverMonthCashFlow.ts:33,46`

Already-reactive but inconsistent (low-pri tidy, same change shape):

- `src/composables/useCriticalItems.ts:40`, `src/components/nook/{ScheduleCards,FamilyStatusToast}.vue`, `src/components/pod/DoseLogConfirmModal.vue`, `src/components/ui/BeanieDatePicker.vue:78,84`, `src/pages/{TravelPlansPage,DashboardPage}.vue`

**`useCalendarNavigation.ts:60`** — initial `referenceDate` reads `useToday().today.value`. Deliberately **no auto-advance watcher**: silently shifting the visible date while the calendar is open is worse UX than the bug. The "Go to today" buttons (lines 35, 93) give explicit control.

**Modal date defaults — file as a separate enhancement, not in this plan:** `TransactionModal.vue:73-74`, `ActivityModal.vue:158`, `QuickAddTransactionModal.vue:37` set `date` to today on mount. Open at 23:59, save at 00:01 → saves yesterday. Fixing correctly needs an inline "the date has changed since you opened this — update?" prompt inside each modal (genuine UX work, distinct concern). **Action: file `enhancement` + `priority: low` issue during implementation so it's tracked.**

### 5. Translation keys

Add under existing `errors.*` namespace shape (verify the convention against `uiStrings.ts` during implementation — match what's already there, don't introduce a new pattern):

- `errors.backgroundRefresh.reload.title` — "Couldn't refresh your data"
- `errors.backgroundRefresh.reload.help` — "Some beans may be out of date. Try refreshing the app. If it keeps happening, sign out and sign back in."

en + beanie variants per the project's dual-string convention. Run `npm run translate` after.

### 6. Tests

- `useToday.test.ts` (new) — `vi.useFakeTimers`. Cases: initial value, midnight timer flips `today`, DST spring-forward + fall-back compute correct delays, `visibilitychange` updates all four refs, `pageshow` with `persisted` flips `today`, singleton identity (two calls → same ref), idempotent `init()`.
- `useStaleTabRefresh.test.ts` (new) — `vi.mock('@/composables/useToday', ...)` to control its refs; mock the four collaborating modules. Cases: `today` change triggers `run('day-changed')`; long absence triggers `run('long-absence')`; short absence does nothing; `isVisible` true→false does nothing; **first-fire safety: subscribing the watcher with current `isVisible.value=true` does NOT fire `run` (no `immediate:true`)**; concurrent triggers blocked by `isRefreshing`; **simultaneous `today` + `isVisible` watcher fire on a wake — second invocation hits the `isRefreshing` guard before any `await` yields**; `familyStore.isSetupComplete=false` blocks. **Error-classification cases:** force each step's mock to reject; assert critical step fires toast + skips downstream + still runs `finally`; non-critical steps log and proceed.
- Existing store tests — audit `activityStore`, `medicationsStore`, `vacationStore` test files for `new Date()` assumptions; add `vi.mock('@/composables/useToday', ...)` returning a fixed ref. Don't extract a shared mock helper yet — three call sites is below the abstraction threshold.
- **E2E test — deliberately not added.** Three-Gate Filter (per ADR-007 / CLAUDE.md): no data loss, no user blocked, full-stack integration borderline. The test budget is currently 33 (over the 25 cap per `docs/STATUS.md`); adding a midnight-cross E2E would require docking another, and the failure modes here are well-covered by the unit tests + manual verification (steps 5–10 in Verification). If a production regression slips through, file a follow-up E2E ticket coupled with a consolidation removal so the budget cap is respected.

### 7. Plan housekeeping

- Replace contents of `docs/plans/2026-04-10-stale-tab-refresh.md` with this combined plan.
- `CHANGELOG.md` line under today when shipped: "Fixed: app no longer shows yesterday's data on first open of a new day; long-absence refresh (recurring transactions, exchange rates, remote sync) is unified under one composable with explicit per-step error handling."
- Remove the entry from `docs/STATUS.md` "Pending / Next Session" once shipped.

---

## Files affected

| File                                                                                                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/composables/useToday.ts`                                                                                                                                                                                                                   | **New** — single visibility/pageshow/midnight sink                                                                                                                                                                                                                                                 |
| `src/composables/useStaleTabRefresh.ts`                                                                                                                                                                                                         | **New** — pure orchestration, watches `useToday`, exposes `isRefreshing`                                                                                                                                                                                                                           |
| `src/composables/__tests__/useToday.test.ts`                                                                                                                                                                                                    | **New**                                                                                                                                                                                                                                                                                            |
| `src/composables/__tests__/useStaleTabRefresh.test.ts`                                                                                                                                                                                          | **New**                                                                                                                                                                                                                                                                                            |
| `src/utils/date.ts`                                                                                                                                                                                                                             | Add canonical `localToday()` (consolidates two duplicates) + JSDoc steering reactive consumers to `useToday`                                                                                                                                                                                       |
| `src/services/translation/uiStrings.ts`                                                                                                                                                                                                         | Add `errors.backgroundRefresh.reload.{title,help}` (en + beanie)                                                                                                                                                                                                                                   |
| `src/App.vue`                                                                                                                                                                                                                                   | Remove `handleVisibilityChange` block + listener registration; remove the local `attemptSilentReconnect` function (extracted to googleAuth.ts); wire `useStaleTabRefresh()` and one `watch(isVisible)` for save-on-hide; update the `online` handler to import the shared `attemptSilentReconnect` |
| `src/services/google/googleAuth.ts`                                                                                                                                                                                                             | Add `export async function attemptSilentReconnect()` — extracted from App.vue, with `console.warn` replacing the bare `catch {}`                                                                                                                                                                   |
| `src/stores/{activityStore,medicationsStore,vacationStore}.ts`                                                                                                                                                                                  | Bug fixes (call-site swaps); medicationsStore drops local `localToday()` and changes `isMedicationActive(m)` → `isMedicationActive(m, today)`                                                                                                                                                      |
| `src/composables/{useBeanTips,useNetWorthHistory,useProjectedTransactions,useMonthOverMonthCashFlow,useCalendarNavigation}.ts`                                                                                                                  | Call-site swaps; useBeanTips drops local `todayISO()`                                                                                                                                                                                                                                              |
| `src/composables/useCriticalItems.ts` + `src/components/nook/{ScheduleCards,FamilyStatusToast}.vue` + `src/components/pod/DoseLogConfirmModal.vue` + `src/components/ui/BeanieDatePicker.vue` + `src/pages/{TravelPlansPage,DashboardPage}.vue` | Tidy to reactive ref                                                                                                                                                                                                                                                                               |
| `docs/plans/2026-04-10-stale-tab-refresh.md`                                                                                                                                                                                                    | **Rewrite in place**                                                                                                                                                                                                                                                                               |
| `CHANGELOG.md`, `docs/STATUS.md`                                                                                                                                                                                                                | Updates on ship                                                                                                                                                                                                                                                                                    |

**Existing utilities reused (zero new duplicates):** `toDateInputValue`, `getStartOfDay`, `parseLocalDate` (`utils/date.ts`); `syncStore.{pauseFilePolling, resumeFilePolling, reloadIfFileChanged, reloadAllStores, handleGoogleReconnected}`; `processRecurringItems` (already idempotent via `alreadyExists`); `updateRatesIfStale`; `attemptSilentRefresh` + new `attemptSilentReconnect` (consolidated in `googleAuth.ts`); `familyStore.isSetupComplete`; `showToast(type, title, help)` (existing 2-line pattern); `useTranslation`; `syncStore.saveFailureLevel` + SaveFailureBanner (the canonical save-side surface — don't double-surface).

**Pattern reused:** `useOnline.ts` — singleton composable shape (module-scoped state + lazy `init()` + `readonly()` exposure + listeners persist for app lifetime).

---

## Maintainability notes

- **Coupling is the orchestration boundary, not a leak.** `useStaleTabRefresh` imports 8 modules because it's the one place that owns wake-time refresh ordering. Splitting it would scatter that knowledge.
- **The 18-file call-site sweep is a one-time cost.** Future regressions are guarded by the JSDoc comment in `utils/date.ts:localToday`. Any reviewer seeing `new Date()` in a UI context will know to ask.
- **No new abstractions until earned.** No `runStep` wrapper, no refresh-registry, no DI helper. Three or four direct steps with inline try/catch is more readable than a generalized framework for one caller.
- **Step order is fixed by the comment, not by logic.** A future maintainer adding a step must explicitly think about whether it goes before or after `reloadIfFileChanged` — not infer ordering from a complex flow.
- **Pure helpers stay pure.** `isMedicationActive(m, today)` takes today as an argument; it does not call `useToday()` internally. The same rule applies to any future "today"-dependent helper — the helper is testable in isolation, the caller is responsible for the reactive read.

## Correctness scenarios verified during design

| Scenario                                                         | Outcome                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PWA opens after laptop slept overnight                           | `visibilitychange → visible` fires → `today` updates → `run('day-changed')` runs (and `run('long-absence')` is suppressed by the `isRefreshing` guard)                                                                                                                                     |
| Tab visible across midnight (active session)                     | Midnight `setTimeout` fires → `today` updates → `run('day-changed')` runs                                                                                                                                                                                                                  |
| Tab hidden across midnight, never wakes till afternoon           | Throttled `setTimeout` still fires while hidden (browser may delay up to 1 min) → `today` updates → `run` works against backgrounded network as best it can; on next wake, `visibilitychange` fires but `today` already correct, so only `run('long-absence')` may fire if elapsed > 5 min |
| iOS Safari bfcache restore                                       | `pageshow` with `e.persisted=true` updates `today` and rearms midnight timer                                                                                                                                                                                                               |
| Initial page load, tab is visible                                | `today` ref initialized with current `new Date()`; `watch(isVisible)` does NOT fire on subscribe (no `immediate:true`); no spurious `run`                                                                                                                                                  |
| `today` and `isVisible` watchers both fire on the same wake tick | Vue runs watchers synchronously in registration order; first call sets `isRefreshing=true` before any await yields; second call hits guard and returns                                                                                                                                     |
| Refresh fails midway (e.g. `reloadAllStores` throws)             | Critical step → toast + abort downstream + `finally` resumes polling and resets `isRefreshing`; non-critical step → log with prefix + continue                                                                                                                                             |
| User has multiple visible tabs                                   | Each tab's `useToday` flips independently at midnight; no focus stealing; polite to the OS scheduler                                                                                                                                                                                       |
| System clock manually changed mid-session                        | Not handled in v1 (no DOM event for clock change); next visibility wake will resync. Documented limitation.                                                                                                                                                                                |

---

## Verification

1. `npm run test -- useToday useStaleTabRefresh activityStore medicationsStore vacationStore` — green, including error-classification cases.
2. `npm run type-check && npm run lint` — clean.
3. `npm run translate` — confirm parser still works after `errors.backgroundRefresh` additions.
4. `npm run test` — full suite, no regressions.
5. **Manual — Problem A:** `npm run dev`, seed activities for today + tomorrow, set system clock to 23:55, advance past midnight, confirm Family Nook + Planner re-render with the new day within ~1s. Console shows `[useStaleTabRefresh] start day-changed`.
6. **Manual — Problem B:** background tab 6+ min via Chrome's "Emulate page in background", re-foreground, confirm `[useStaleTabRefresh] start long-absence` and the four steps run in order, no duplicate fires.
7. **Manual — error paths:** monkey-patch `syncStore.reloadAllStores` to throw → confirm toast appears AND downstream steps are skipped AND `finally` resumes polling. Repeat for each non-critical step → confirm `console.warn` fires with prefix and downstream steps still complete.
8. **iOS Safari smoke (staging):** install as PWA, leave overnight, confirm next-morning open shows today's data without manual refresh. Capture in `docs/E2E_HEALTH.md` if anything subtle surfaces.
9. **Cross-tab regression:** two visible tabs, advance system clock past midnight, confirm both flip without focus stealing.
10. **DST regression:** verified via unit test (delay computation), not manual.
