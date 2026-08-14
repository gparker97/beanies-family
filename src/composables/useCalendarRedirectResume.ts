/**
 * App-level resume for a calendar redirect-auth round-trip (P2).
 *
 * A calendar connect/reconnect on a redirect surface (PWA / iOS / native) leaves
 * the app entirely (full-page redirect) or opens the system browser, then returns
 * to a `returnPath` carrying a `calResume` query (`connect`, or a connectionId to
 * reconnect). The one-time OAuth code is stashed in a grant-namespaced
 * sessionStorage slot by OAuthCallbackPage / the native deep-link handler.
 *
 * This watcher (reactive, SPA-safe — not `onMounted`-only, per the native
 * `router.replace` caveat) fires whenever a `calResume` intent is present:
 *  - waits for the Automerge doc to be loaded (a fresh web reload runs boot in
 *    parallel; the CRDT commit needs the doc), then
 *  - redeems the code + commits via the store (memoized → redeemed exactly once),
 *  - toasts the outcome (this IS a user-initiated action → a success toast is
 *    appropriate, unlike a remote self-heal), and
 *  - strips the `calResume` query so a refresh/back can't re-trigger it.
 *
 * Double-firing is harmless: `completeCalendarRedirectAuth` redeems the one-time
 * code once and returns `null` to any later caller.
 */
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { waitForDocLoaded } from '@/composables/waitForDocLoaded';

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

      // Instantiate the store lazily — only when a resume is genuinely pending
      // (a calResume intent is present). Mounting this composable is therefore
      // zero-cost when the calendar feature is off / no redirect is in flight.
      const store = useCalendarSyncStore();
      const result = await store.resumeRedirectConnect(intent);
      // Strip the query regardless of outcome so a refresh can't re-run it.
      await stripQuery();

      if (!result) return; // no pending code (Drive redirect / declined) — show nothing
      if (result.status === 'connected') {
        const isReconnect = intent !== 'connect';
        showToast(
          'success',
          t(
            isReconnect
              ? 'calendarSync.toast.reconnected.title'
              : 'calendarSync.toast.connected.title'
          ),
          t(
            isReconnect
              ? 'calendarSync.toast.reconnected.message'
              : 'calendarSync.toast.connected.message'
          )
        );
      } else if (result.status === 'failed' && result.code !== 'cancelled') {
        showToast('error', t('calendarSync.toast.connectFailed.title'), result.message, {
          silent: result.code === 'missing_scope',
        });
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
