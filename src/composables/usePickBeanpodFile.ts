import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
} from '@/services/google/googleAuth';
import { pickBeanpodFile } from '@/services/google/drivePicker';

/**
 * Composable for re-picking a `.beanpod` file from Google Drive — used by
 * recovery surfaces (SaveFailureBanner re-select, future inviter flows)
 * that need the user to grant or re-grant `drive.file` scope to a
 * specific file.
 *
 * Token acquisition strategy: try silent first (cached or refresh-token),
 * then fall back to interactive auth — popup on browsers that support
 * it, full-page redirect on standalone PWAs and iOS Safari where
 * `window.open` either fails or can't bridge `postMessage` back to
 * the app window.
 */
export function usePickBeanpodFile() {
  const isPicking = ref(false);
  const pickError = ref<string | null>(null);

  /**
   * Open the Google Picker for the user to select a `.beanpod`. Returns
   * the picked file metadata, `null` if the user cancelled, or `null`
   * after triggering a full-page redirect (the page will navigate away).
   * Never throws — failures populate `pickError` and resolve to `null`.
   *
   * **Always forces the consent / account-chooser screen.** This composable
   * is invoked from recovery surfaces where account drift is the most
   * likely cause of the failure (e.g. wrong-Drive on the file-not-found
   * banner). Forcing consent surfaces Google's account chooser so the
   * user explicitly confirms which account to use — eliminating the
   * "I picked A but landed in B" failure mode at the cost of one extra
   * tap on the account chooser.
   */
  async function pick(): Promise<{ fileId: string; fileName: string } | null> {
    isPicking.value = true;
    pickError.value = null;
    try {
      // Skip silent-token fast path: recovery flows must show the chooser
      // so the user can pick the correct account.
      if (shouldUseRedirectAuth()) {
        const returnPath = `${window.location.pathname}${window.location.search}`;
        await startRedirectAuth(returnPath);
        // Page navigates; this resolves to null. The next session will
        // complete redirect auth and the user can re-trigger the pick.
        return null;
      }
      const token = await requestAccessToken({ forceConsent: true });
      const picked = await pickBeanpodFile(token);
      return picked;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[usePickBeanpodFile] pick failed:', message);
      pickError.value = message || 'Picker failed';
      return null;
    } finally {
      isPicking.value = false;
    }
  }

  return { isPicking, pickError, pick };
}
