/**
 * App-level resume for a calendar redirect-auth round-trip (P2).
 *
 * A calendar connect/reconnect on a redirect surface (PWA / iOS / native) leaves
 * the app entirely (full-page redirect) or opens the system browser, then returns
 * to a `returnPath` carrying a `calResume` query (`resumeIntent.ts`: a fresh
 * connect, or the connection to reconnect; or, for a view-only calendar, a fresh
 * view consent or the view account to reconnect, routed to `calendarViewStore`). The one-time OAuth code is stashed in a
 * grant-namespaced sessionStorage slot by OAuthCallbackPage / the native deep-link
 * handler.
 *
 * This watcher (reactive, SPA-safe — not `onMounted`-only, per the native
 * `router.replace` caveat) fires whenever a `calResume` intent is present:
 *  - waits for the Automerge doc to be loaded (a fresh web reload runs boot in
 *    parallel; the CRDT commit needs the doc), then
 *  - redeems the code via the store (memoized → redeemed exactly once). A fresh
 *    connect writes nothing: the credential waits in the pending slot and the
 *    settings drawer opens the add step at the calendar list (no toast, nothing is
 *    connected yet). A reconnect commits in place;
 *  - toasts a reconnect's outcome and any failure (this IS a user-initiated action
 *    → a success toast is appropriate, unlike a remote self-heal), and
 *  - strips the `calResume` query so a refresh/back can't re-trigger it.
 *
 * Double-firing is harmless: `completeCalendarRedirectAuth` redeems the one-time
 * code once and returns `null` to any later caller.
 */
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useCalendarViewStore } from '@/stores/calendarViewStore';
import { isViewResumeIntent, parseCalendarResumeIntent } from '@/utils/calendar/resumeIntent';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { connectFailureToast } from '@/utils/calendar/connectFailureToast';
import { waitForDocLoaded } from '@/composables/waitForDocLoaded';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';

export function useCalendarRedirectResume(): void {
  const route = useRoute();
  const router = useRouter();
  const { t } = useTranslation();

  // Guards a re-entrant fire while an in-flight resume is still settling (the
  // watcher can tick again before the query is stripped).
  let running = false;

  async function stripQuery(): Promise<void> {
    const { calResume: _drop, ...rest } = route.query;
    await router.replace({ path: route.path, query: rest }).catch(() => {
      // A redirected/aborted nav here is non-fatal — the code is already redeemed.
    });
  }

  /**
   * A returning view-only consent. A fresh one ends in the pending slot (the drawer
   * opens the add step at the calendar list, no toast); a reconnect commits in place
   * and toasts. The view store never throws; it reports and toasts anything
   * unexpected itself (`code: 'unexpected'`).
   */
  async function runView(intent: string): Promise<void> {
    const result = await useCalendarViewStore().resumeViewRedirect(intent);
    await stripQuery();
    if (!result) return;
    if (result.status === 'pending' || result.status === 'redirecting') return;
    if (result.status === 'reconnected') {
      showToast(
        'success',
        t('calendarView.toast.reconnected.title'),
        t('calendarView.toast.reconnected.message')
      );
    } else {
      // The one failure mapper the popup paths use too: translated copy only, and
      // silent, so an account email shown in a mismatch never reaches telemetry.
      // Here the add step is gone (the page reloaded), so another go means reopening
      // the calendar settings drawer.
      const toast = connectFailureToast('view', result, t);
      if (!toast) return;
      showToast('error', toast.title, toast.message, {
        silent: toast.silent,
        actionLabel: t('action.tryAgain'),
        actionFn: openCalendarSettings,
      });
    }
  }

  function openCalendarSettings(): void {
    router.push({ path: '/settings', query: { open: CALENDAR_SYNC_OPEN } }).catch((err) =>
      reportError({
        surface: 'calendar-redirect-resume',
        severity: 'warning',
        message: 'calendar redirect resume: could not open calendar settings',
        error: err,
      })
    );
  }

  async function run(intent: string): Promise<void> {
    if (running) return;
    running = true;
    try {
      const ready = await waitForDocLoaded();
      if (!ready) {
        // No loaded family to commit into (signed-out / torn-down return). Leave
        // the query so a later ready state can retry; breadcrumb it.
        reportError({
          surface: 'calendar-redirect-resume',
          severity: 'warning',
          message: 'calendar redirect resume: doc not loaded within budget — deferring',
        });
        return;
      }

      // A view-only consent belongs to the view store (plan 2026-11-17, A2): its
      // own scope check, its own pending slot kind, its own toasts.
      if (isViewResumeIntent(parseCalendarResumeIntent(intent))) {
        await runView(intent);
        return;
      }

      // Instantiate the store lazily — only when a resume is genuinely pending
      // (a calResume intent is present). Mounting this composable is therefore
      // zero-cost when the calendar feature is off / no redirect is in flight.
      const store = useCalendarSyncStore();
      const result = await store.resumeRedirectConnect(intent);
      // Strip the query regardless of outcome so a refresh can't re-run it.
      await stripQuery();

      if (!result) return; // no pending code (Drive redirect / declined) — show nothing
      // A fresh connect's consent now waits for the member to choose a calendar:
      // the settings drawer watches the pending slot and opens the add step.
      if (result.status === 'pending' || result.status === 'redirecting') return;
      if (result.status === 'connected') {
        // Only a reconnect reaches here: a fresh connect returns `pending` above.
        showToast(
          'success',
          t('calendarSync.toast.reconnected.title'),
          t('calendarSync.toast.reconnected.message')
        );
      } else if (result.status === 'failed') {
        // Never `result.message`: for an account mismatch it is the stored account's
        // email, and a non-silent toast forwards its text to `reportError`.
        const toast = connectFailureToast('sync', result, t);
        if (toast) {
          showToast('error', toast.title, toast.message, {
            silent: toast.silent,
            surface: 'calendar-redirect-resume',
            context: { action: 'resume-connect', error_code: result.code },
          });
        }
      }
    } catch (e) {
      // resumeRedirectConnect's CRDT writes can throw — never fail silently.
      await stripQuery();
      showToast(
        'error',
        t('calendarSync.toast.connectFailed.title'),
        t('calendarSync.reconnect.bannerError'),
        {
          silent: true,
          surface: 'calendar-redirect-resume',
          error: e,
        }
      );
    } finally {
      running = false;
    }
  }

  watch(
    () => route.query.calResume,
    (calResume) => {
      const intent = Array.isArray(calResume) ? calResume[0] : calResume;
      if (!intent) return;
      void run(intent);
    },
    { immediate: true }
  );
}
