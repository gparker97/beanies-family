import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  tryGetSilentToken,
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
   * @param opts.forceConsent When true, always shows Google's account
   *   chooser even if a valid token is cached. Default `true` because
   *   most callers (recovery surfaces — `SaveFailureBanner`'s "Pick file
   *   from Drive" action) need explicit account confirmation to avoid
   *   silent account drift. The join flow passes `false` so first-time
   *   joiners with a valid silent token aren't asked to re-pick their
   *   account unnecessarily.
   * @param opts.loginHint Optional Google email to pre-populate the
   *   account chooser via `login_hint`. Use when the expected account
   *   is known (e.g. invitee's email from the invite URL hint).
   */
  async function pick(opts?: {
    forceConsent?: boolean;
    loginHint?: string;
  }): Promise<{ fileId: string; fileName: string } | null> {
    const forceConsent = opts?.forceConsent ?? true;
    const loginHint = opts?.loginHint;
    isPicking.value = true;
    pickError.value = null;
    try {
      // Recovery flows skip the silent-token fast path so the user
      // explicitly confirms the account. First-time join flows can
      // accept a silent token (forceConsent=false).
      let token: string | null = null;
      if (!forceConsent) {
        token = await tryGetSilentToken();
      }
      if (!token) {
        if (shouldUseRedirectAuth()) {
          const returnPath = `${window.location.pathname}${window.location.search}`;
          await startRedirectAuth(returnPath, loginHint);
          // Page navigates; this resolves to null. The next session
          // completes redirect auth and the user can re-trigger.
          return null;
        }
        token = await requestAccessToken({ forceConsent, loginHint });
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
