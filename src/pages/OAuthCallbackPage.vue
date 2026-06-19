<script setup lang="ts">
/**
 * OAuth callback page — receives authorization code from Google.
 *
 * Popup mode: sends code to parent window via postMessage, then closes.
 * Iframe mode (silent auth attempt): posts to window.parent — the iframe
 *   container in googleAuth.ts removes the iframe after receiving the message.
 * Redirect mode (mobile): saves code to sessionStorage and redirects back
 *   to the original page so completeRedirectAuth() can finish the exchange.
 */
import { onMounted } from 'vue';
import { REDIRECT_AUTH_CODE_KEY } from '@/services/google/googleAuth';
import { reportError } from '@/utils/errorReporter';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (window.opener) {
    // Popup mode — send code to parent and close
    window.opener.postMessage({ type: 'oauth-callback', code, error }, window.location.origin);
    setTimeout(() => window.close(), 300);
    return;
  }

  if (window.parent !== window) {
    // Iframe mode (silent auth) — post to the iframe's parent window
    window.parent.postMessage({ type: 'oauth-callback', code, error }, window.location.origin);
    return;
  }

  // Redirect mode — save code and redirect back to the original page. The
  // sessionStorage read itself can THROW in iOS Safari Private Browsing (the
  // same context that loses the state across the Google round-trip), so guard
  // it — a throw is treated identically to "state missing".
  let stateJson: string | null = null;
  try {
    stateJson = sessionStorage.getItem('beanies_redirect_auth');
  } catch (e) {
    console.warn('[OAuthCallback] sessionStorage read failed (private browsing?):', e);
  }

  if (stateJson && code) {
    try {
      sessionStorage.setItem(REDIRECT_AUTH_CODE_KEY, code);
      const state = JSON.parse(stateJson);
      window.location.href = state.returnPath || '/';
    } catch {
      window.location.href = '/';
    }
    return;
  }

  // We have an auth `code` but couldn't recover the redirect state — the
  // sessionStorage write from `startRedirectAuth` didn't survive (or threw),
  // which is the iOS-Private-Browsing failure mode. Don't silently drop the
  // code at `/`; send the user to an actionable error surface + report it.
  if (code) {
    reportError({
      surface: 'oauth.redirectStateLost',
      message:
        'OAuth redirect returned with a code but no sessionStorage state — likely Private Browsing blocked storage during the redirect',
      // Critical, not warning: a code-in-hand-but-state-lost HARD-BLOCKS
      // onboarding for a real (even non-private) user — it must page Slack, not
      // die in telemetry. The device's `web_storage` context distinguishes
      // throwing/blocked storage from a wipe (2026-06-20).
      severity: 'critical',
    });
    window.location.href = '/welcome?authError=storage';
    return;
  }

  // Error or genuinely unexpected state (no code) — redirect home.
  if (error) {
    try {
      sessionStorage.removeItem('beanies_redirect_auth');
    } catch {
      // sessionStorage unavailable — nothing to clean up.
    }
  }
  window.location.href = '/';
});
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-[#F8F9FA]">
    <p class="font-outfit text-lg text-[#2C3E50]">{{ t('auth.loadingFile') }}</p>
  </div>
</template>
