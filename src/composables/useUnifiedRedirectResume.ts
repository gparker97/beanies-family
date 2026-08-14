/**
 * App-level resume for a UNIFIED Drive+Calendar reconnect redirect (tracker #62,
 * commit 5).
 *
 * The unified reconnect goes out as an ordinary Drive redirect carrying the scope
 * union + a `unifiedResume` marker on the returnPath. The Drive half completes
 * through the EXISTING path (App.vue boot `ensureRedirectAuthSettled` on web; the
 * native deep-link handler on native). This watcher runs the CALENDAR half: once
 * the doc is loaded and the Drive token is committed, it fans that token out to the
 * same-account `needs_reconnect` connections.
 *
 * Critically (Pass 4): the fan-out gates on the READ-BACK Drive token's presence,
 * NOT on `ensureRedirectAuthSettled`'s return value — that memo is a deliberate
 * no-op returning `null` on native (ADR-029), even though the token IS committed by
 * the deep-link handler. Gating on the return value would skip calendar restore on
 * every iOS reconnect. See `fanOutCalendarAfterUnifiedConsent`.
 *
 * No success toast: the Drive reconnect is silent (its self-heal clears the prompt),
 * so the unified flow stays silent too — the reconnect prompt vanishing IS the
 * feedback. Double-firing is harmless (the fan-out is idempotent: a second run
 * finds the connections already `ok` and matches nothing).
 */
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { reportError } from '@/utils/errorReporter';
import { waitForDocLoaded } from '@/composables/waitForDocLoaded';
import { UNIFIED_RESUME_KEY } from '@/services/google/unifiedReconnect';

export function useUnifiedRedirectResume(): void {
  const route = useRoute();
  const router = useRouter();

  // Guards a re-entrant fire while an in-flight resume is still settling.
  let running = false;

  async function stripQuery(): Promise<void> {
    const { [UNIFIED_RESUME_KEY]: _drop, ...rest } = route.query;
    await router.replace({ path: route.path, query: rest }).catch(() => {
      // A redirected/aborted nav here is non-fatal — the fan-out already ran.
    });
  }

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const ready = await waitForDocLoaded();
      if (!ready) {
        // No loaded family to write into yet — leave the marker so a later ready
        // state retries; breadcrumb it.
        reportError({
          surface: 'unified-reconnect',
          severity: 'warning',
          message: 'unified reconnect resume: doc not loaded within budget — deferring',
        });
        return;
      }

      // Ensure the Drive completion has settled on WEB (memoized, reject-sticky).
      // On native this is a no-op returning null; the deep-link handler already
      // committed the token. Either way we then gate the fan-out on the read-back
      // token, not on this return value.
      const { ensureRedirectAuthSettled } = await import('@/services/google/googleAuth');
      await ensureRedirectAuthSettled().catch(() => {
        // A failed/absent Drive settle is fine here — fanOut checks the token home.
      });

      const { fanOutCalendarAfterUnifiedConsent } =
        await import('@/services/google/unifiedReconnect');
      await fanOutCalendarAfterUnifiedConsent();

      await stripQuery();
    } catch (e) {
      await stripQuery();
      reportError({
        surface: 'unified-reconnect',
        severity: 'warning',
        message: 'unified reconnect resume failed',
        error: e instanceof Error ? e : new Error(String(e)),
      });
    } finally {
      running = false;
    }
  }

  watch(
    () => route.query[UNIFIED_RESUME_KEY],
    (marker) => {
      if (!marker) return;
      void run();
    },
    { immediate: true }
  );
}
