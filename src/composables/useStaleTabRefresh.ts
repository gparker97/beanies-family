import { ref, readonly, watch, effectScope, type EffectScope, type Ref } from 'vue';
import { useToday } from '@/composables/useToday';
import { useFamilyStore } from '@/stores/familyStore';
import { useSyncStore } from '@/stores/syncStore';
import { processRecurringItems } from '@/services/recurring/recurringProcessor';
import { updateRatesIfStale } from '@/services/exchangeRate/exchangeRateService';
import { attemptSilentReconnect } from '@/utils/silentReconnect';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { reportError } from '@/utils/errorReporter';

/**
 * Heavy refresh on tab wake or day change.
 *
 * Owns the wake-time refresh sequence: reload Pinia stores from Automerge,
 * generate today's recurring transactions, refresh exchange rates and Google
 * token, then pull remote Drive deltas. This is the SINGLE place in the
 * codebase that knows the wake-time refresh ordering.
 *
 * Registers no DOM event listeners of its own — `useToday` is the single
 * sink for `visibilitychange` / `pageshow` / midnight timer, and this
 * composable just `watch`es its reactive state.
 *
 * Triggers:
 *   1. `today` ref change   → run('day-changed')   (midnight cross OR wake-after-day-change)
 *   2. `isVisible` true     → run('long-absence')  (only if elapsed since last visible >= 5 min)
 *
 * The `isRefreshing` guard prevents concurrent runs. Vue runs watchers
 * synchronously in registration order, so when both triggers fire on the
 * same wake (common: laptop wakes after midnight), the first call sets
 * `isRefreshing=true` before any await yields and the second is suppressed.
 */

const LONG_ABSENCE_MS = 5 * 60 * 1000;
const isRefreshing = ref(false);
let initialized = false;
let scope: EffectScope | null = null;

/**
 * Step ordering is deliberate. Local state is made current first
 * (reloadAllStores) so subsequent steps work against fresh data.
 * `reloadIfFileChanged` runs LAST and may overwrite freshly-generated
 * recurring tx with a slightly-older Drive view — accepted because:
 *   (a) processRecurringItems is idempotent via `alreadyExists` dedup, so
 *       the next wake re-generates anything truncated; and
 *   (b) doing the Drive delta first would risk generating recurring tx
 *       against stale local state, which is harder to detect.
 */
async function run(reason: 'day-changed' | 'long-absence'): Promise<void> {
  const familyStore = useFamilyStore();
  const syncStore = useSyncStore();
  const { t } = useTranslation();

  if (isRefreshing.value || !familyStore.isSetupComplete) return;
  isRefreshing.value = true;
  syncStore.pauseFilePolling();

  try {
    // 1. Critical — downstream steps depend on stores being current.
    //    On failure: toast the user, abort downstream, finally-block still
    //    resumes polling and resets isRefreshing.
    try {
      await syncStore.reloadAllStores();
    } catch (e) {
      console.error(`[useStaleTabRefresh] reloadAllStores failed (${reason})`, e);
      // Pass surface explicitly so the auto-report from showToast tags this
      // correctly in Slack (otherwise Layer A defaults to 'app').
      showToast(
        'error',
        t('error.backgroundRefreshFailed'),
        t('error.backgroundRefreshFailedHelp'),
        { surface: 'stale-tab-refresh', error: e, context: { action: reason } }
      );
      return;
    }

    // 2. Non-critical, sequential — depends on step 1's current state.
    //    Idempotent via `alreadyExists` dedup, safe to retry next wake.
    //    Failure is silent to the user (recurring tx will retry next wake)
    //    but support still gets notified via reportError so we can see the
    //    pattern if it's persistent.
    try {
      await processRecurringItems();
    } catch (e) {
      console.warn(`[useStaleTabRefresh] processRecurringItems failed (${reason})`, e);
      reportError({
        surface: 'stale-tab-refresh',
        message: 'processRecurringItems failed',
        error: e,
        context: { action: reason },
      });
    }

    // 3. Non-critical, parallel — independent subsystems.
    const [rates, reconnect] = await Promise.allSettled([
      updateRatesIfStale(),
      attemptSilentReconnect(),
    ]);
    if (rates.status === 'rejected') {
      console.warn(`[useStaleTabRefresh] updateRatesIfStale failed (${reason})`, rates.reason);
      reportError({
        surface: 'stale-tab-refresh',
        message: 'updateRatesIfStale failed',
        error: rates.reason,
        context: { action: reason },
      });
    }
    if (reconnect.status === 'rejected') {
      // SaveFailureBanner + syncStore.showGoogleReconnect already cover the
      // user-facing path — don't double-surface to the user, but still
      // notify support so we can correlate sessions to reconnect failures.
      console.warn(
        `[useStaleTabRefresh] attemptSilentReconnect failed (${reason})`,
        reconnect.reason
      );
      reportError({
        surface: 'stale-tab-refresh',
        message: 'attemptSilentReconnect failed',
        error: reconnect.reason,
        context: { action: reason },
      });
    }

    // 4. Non-critical — pull remote Drive changes (see ordering note above).
    try {
      await syncStore.reloadIfFileChanged();
    } catch (e) {
      console.warn(`[useStaleTabRefresh] reloadIfFileChanged failed (${reason})`, e);
      reportError({
        surface: 'stale-tab-refresh',
        message: 'reloadIfFileChanged failed',
        error: e,
        context: { action: reason },
      });
    }
  } finally {
    syncStore.resumeFilePolling();
    isRefreshing.value = false;
  }
}

export function useStaleTabRefresh(): { isRefreshing: Readonly<Ref<boolean>> } {
  if (!initialized) {
    initialized = true;
    // Detached scope — watchers persist for the app lifetime, independent of
    // any caller's component-setup context. A `__resetStaleTabRefreshForTesting`
    // hook below stops the scope between unit tests.
    scope = effectScope(true);
    scope.run(() => {
      const { today, isVisible, lastVisibleAt } = useToday();

      watch(today, () => {
        void run('day-changed');
      });

      watch(isVisible, (now, prev) => {
        if (!now || prev) return; // only on hidden→visible transition
        if (Date.now() - lastVisibleAt.value >= LONG_ABSENCE_MS) {
          void run('long-absence');
        }
      });
    });
  }
  return { isRefreshing: readonly(isRefreshing) };
}

/**
 * Test-only reset hook. Stops the watcher scope and resets the singleton
 * guard so unit tests can re-initialize between cases. Production code
 * never calls this.
 */
export function __resetStaleTabRefreshForTesting(): void {
  scope?.stop();
  scope = null;
  initialized = false;
  isRefreshing.value = false;
}
