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
import { decodeRedirectState } from '@/services/google/redirectState';
import { reportError } from '@/utils/errorReporter';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

/** Stash the auth code for `completeRedirectAuth()` on the returnPath load.
 *  This post-bounce, same-origin write reliably survives (it's not a tracking
 *  bounce). Returns false if storage throws — caller treats that as "lost". */
function stashCode(code: string): boolean {
  try {
    sessionStorage.setItem(REDIRECT_AUTH_CODE_KEY, code);
    return true;
  } catch (e) {
    console.warn('[OAuthCallback] failed to stash auth code', e);
    return false;
  }
}

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const stateParam = params.get('state');

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

  // Redirect mode — flat precedence ladder. Each transport forwards-and-returns
  // or falls through to the next.

  // NEW PATH: routing rides in the OAuth `state` param (survives WebKit
  // bounce-tracking storage clearing — the iOS failure mode). No dependency on
  // pre-bounce sessionStorage. `decodeRedirectState` validates the same-origin
  // returnPath (open-redirect guard) and returns null on anything malformed.
  const decoded = decodeRedirectState(stateParam);
  if (decoded && code) {
    if (stashCode(code)) {
      window.location.href = decoded.returnPath;
      return;
    }
    // Couldn't forward the code — fall through to the reported "lost" surface.
  }

  // LEGACY (remove after 2026-09-30): completes in-flight redirects started by
  // the pre-bounce-fix build, which wrote `beanies_redirect_auth` before the
  // redirect. The getItem can throw on blocked storage — guarded.
  let legacyState: string | null = null;
  try {
    legacyState = sessionStorage.getItem('beanies_redirect_auth');
  } catch (e) {
    console.warn('[OAuthCallback] legacy state read failed', e);
  }
  if (legacyState && code) {
    try {
      sessionStorage.setItem(REDIRECT_AUTH_CODE_KEY, code);
      const state = JSON.parse(legacyState);
      window.location.href = state.returnPath || '/';
    } catch {
      window.location.href = '/';
    }
    return;
  }

  // GENUINELY LOST: a code in hand we can't forward (no valid `state`, no legacy
  // stash, or the code stash threw). A hard onboarding block — report it.
  if (code) {
    reportError({
      surface: 'oauth.redirectStateLost',
      message:
        'OAuth redirect returned with a code but no usable routing state (malformed/absent `state` param and no legacy stash, or storage write failed)',
      // Critical: a code-in-hand-but-routing-lost HARD-BLOCKS onboarding — it
      // must page Slack. The device's `web_storage` context distinguishes a
      // genuine storage fault from this (now-rare) malformed-callback case.
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
