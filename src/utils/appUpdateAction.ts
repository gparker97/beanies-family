/**
 * The "Update beanies" recovery button, shared by `PodAccessBanner` and `JoinPodView`
 * (the `updateApp` recovery on `FILE_NEWER_VERSION`).
 *
 * Both callers invoke handlers as `void handler()` with no catch, so this NEVER rejects:
 * every failure is reported (`warning`, surface `app-update`) and shown as a generic toast.
 *
 * - Native: the store listing opens in the click's own tick (`openExternal` must run inside the
 *   user gesture, before any await). iOS cannot update inside the app, and the store is the one
 *   path that works on both platforms.
 * - Web: one `runUpdateCheck({ userRequested: true })`, the same entry point the poll uses, so
 *   the native/`dev` refusals, single-flight and quiet rules exist once.
 */
import { showToast } from '@/composables/useToast';
import { getPlatform, isNative } from '@/services/sync/capabilities';
import { storeUrlFor } from '@/services/appUpdate/storeUrl';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';
import { openExternal } from '@/utils/openExternal';
import { runUpdateCheck } from '@/utils/webUpdate';

const SURFACE = 'app-update';

function toastGenericFailure(): void {
  // `warning`, not `error`: an error toast auto-reports a second time.
  showToast('warning', useTranslationStore().t('error.generic'));
}

export async function runAppUpdateAction(): Promise<void> {
  try {
    if (isNative()) {
      const url = storeUrlFor(getPlatform());
      if (!url) {
        reportError({
          surface: SURFACE,
          severity: 'warning',
          message: 'no store url for platform',
          context: { action: 'no-store-url' },
        });
        toastGenericFailure();
        return;
      }
      openExternal(url);
      return;
    }

    const result = await runUpdateCheck({ trigger: 'visible', userRequested: true });
    switch (result) {
      case 'reloading':
        return; // the page is going away
      case 'current':
        showToast('info', useTranslationStore().t('appUpdate.alreadyCurrent'));
        return;
      default:
        // 'unavailable' | 'deferred' | 'failed'
        reportError({
          surface: SURFACE,
          severity: 'warning',
          message: 'update action did not reload',
          context: { action: 'not-updated', detail: result },
        });
        toastGenericFailure();
    }
  } catch (e) {
    try {
      reportError({
        surface: SURFACE,
        severity: 'warning',
        message: 'update action failed',
        error: e,
      });
      toastGenericFailure();
    } catch (inner) {
      console.warn('[appUpdateAction] could not report failure:', inner);
    }
  }
}
