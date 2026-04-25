import { ref } from 'vue';
import {
  tryGetSilentToken,
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  hasRefreshToken,
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
   */
  async function pick(): Promise<{ fileId: string; fileName: string } | null> {
    isPicking.value = true;
    pickError.value = null;
    try {
      let token = await tryGetSilentToken();
      if (!token) {
        if (shouldUseRedirectAuth()) {
          const returnPath = `${window.location.pathname}${window.location.search}`;
          await startRedirectAuth(returnPath);
          // Page navigates; this resolves to null. The next session will
          // have the token cached and the user can re-trigger the pick.
          return null;
        }
        token = await requestAccessToken({ forceConsent: !hasRefreshToken() });
      }
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
