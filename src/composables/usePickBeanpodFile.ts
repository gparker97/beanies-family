import { ref } from 'vue';
import {
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  tryGetSilentToken,
} from '@/services/google/googleAuth';
import { pickBeanpodFile, type PickBeanpodFileResult } from '@/services/google/drivePicker';

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
   * Open the Google Picker for the user to select a `.beanpod`.
   * Always returns a structured result — never throws. See
   * `PickBeanpodFileResult` for the discriminated outcomes.
   *
   * The try/catch here narrowly wraps the auth chain (silent-token /
   * redirect / popup). A thrown error there is surfaced as
   * `{ kind: 'failed', reason: 'auth', message }` with the underlying
   * Error.message captured so the join flow's diagnostic blob carries
   * the actual cause. The `pickBeanpodFile` call lives outside the try
   * because it always resolves to a structured result by contract — it
   * has its own catch sites that map to `'load'` / `'open'` / `'iframe'`
   * / `'timeout'`. Keeping the two concerns visibly separate prevents
   * future drift back to a single opaque `'script'` catch-all.
   *
   * When the auth flow kicks off a full-page redirect (PWA / iOS Safari
   * standalone), the page navigates away; the returned promise resolves
   * to `'cancelled'` since no Picker actually opened — the next session
   * completes redirect auth and the user re-triggers.
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
  }): Promise<PickBeanpodFileResult> {
    const forceConsent = opts?.forceConsent ?? true;
    const loginHint = opts?.loginHint;
    isPicking.value = true;
    pickError.value = null;

    try {
      // Auth chain — narrow try/catch so callers can distinguish auth
      // failures (`reason: 'auth'`) from picker failures (`'load' /
      // 'open' / 'iframe' / 'timeout'`).
      let token: string | null = null;
      try {
        // Recovery flows skip the silent-token fast path so the user
        // explicitly confirms the account. First-time join flows can
        // accept a silent token (forceConsent=false).
        if (!forceConsent) {
          token = await tryGetSilentToken();
        }
        if (!token) {
          if (shouldUseRedirectAuth()) {
            const returnPath = `${window.location.pathname}${window.location.search}`;
            await startRedirectAuth(returnPath, loginHint);
            // Page navigates; the next session completes redirect auth
            // and the user re-triggers. Treat as a cancellation from
            // the current call's perspective.
            return { kind: 'cancelled' };
          }
          token = await requestAccessToken({ forceConsent, loginHint });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[usePickBeanpodFile] auth failed before picker:', message);
        pickError.value = message || 'Authentication failed';
        return { kind: 'failed', reason: 'auth', message };
      }

      // pickBeanpodFile always resolves to a structured result by
      // contract — no try/catch needed at this layer.
      return await pickBeanpodFile(token);
    } finally {
      isPicking.value = false;
    }
  }

  return { isPicking, pickError, pick };
}
