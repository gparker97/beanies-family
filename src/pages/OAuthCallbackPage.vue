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
import { CALENDAR_REDIRECT_CODE_KEY } from '@/services/calendar/calendarAuth';
import { decodeRedirectState, isSameOriginReturnPath } from '@/services/google/redirectState';
import { reportError } from '@/utils/errorReporter';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

/** Stash the auth code under a grant-scoped key for the matching completion on the
 *  returnPath load (Drive → `completeRedirectAuth`, calendar → the calendar
 *  sibling). This post-bounce, same-origin write reliably survives (it's not a
 *  tracking bounce). Returns false if storage throws — caller treats that as "lost". */
function stashCode(code: string, key: string): boolean {
  try {
    sessionStorage.setItem(key, code);
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
    // Route the code to the grant's own key so a calendar code can never collide
    // with (or be consumed as) a Drive code. A full-page redirect makes only one
    // grant's code pending at a time — the keys are structurally isolated.
    const codeKey =
      decoded.grant === 'calendar' ? CALENDAR_REDIRECT_CODE_KEY : REDIRECT_AUTH_CODE_KEY;
    if (stashCode(code, codeKey)) {
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
      // ⚠️ THE SAME ORIGIN CHECK AS THE MODERN TRANSPORT. This branch navigated to a stored
      // `returnPath` with no guard at all, so the open-redirect fix applied to
      // `decodeRedirectState` covered one of three doors. sessionStorage is app-written, so
      // this is a structural gap rather than a live exploit — but it is the branch a future
      // change is most likely to widen, and the whole point of extracting the predicate was
      // that no sink should have its own answer.
      window.location.href = isSameOriginReturnPath(state?.returnPath) ? state.returnPath : '/';
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

  // Error or genuinely unexpected state (no code).
  if (error) {
    try {
      sessionStorage.removeItem('beanies_redirect_auth');
    } catch {
      // sessionStorage unavailable — nothing to clean up.
    }

    // ⚠️ RETURN THEM WHERE THEY CAME FROM, and this is a real bug fix rather than tidying.
    //
    // Sending an `?error=` (overwhelmingly `access_denied` — the user declined consent) to `/`
    // threw away the invite URL entirely. For a JOINER that is the whole context: the family id,
    // the file id and the invite token all live in that link. They declined a permission prompt
    // and the app answered by losing their invitation, with nothing recorded anywhere.
    //
    // `decoded.returnPath` has already been through `decodeRedirectState`'s open-redirect guard,
    // so it is safe to navigate to.
    //
    // ⚠️ ONLY THE JOIN FLOW READS `authError`, so only the join flow gets it. An earlier
    // comment here claimed it was "the convention `LoginPage` already reads" — `LoginPage`
    // matches only the literal `'storage'`, and nothing reads it on the calendar, reconnect or
    // pod-recovery return paths. Appending it there was worse than useless: `useJoinFlow` is
    // the only place that strips it, so elsewhere it stuck in the address bar forever, silent
    // and unrendered, and because the return path is captured as `${pathname}${search}` each
    // later decline appended ANOTHER copy.
    //
    // ⚠️ AND IT IS BUILT WITH `URL`, not string concatenation. The old `includes('?')`
    // test puts the parameter inside the FRAGMENT when the return path carries one
    // (`/join?fam=a#frag` became `/join?fam=a#frag&authError=…`), where no query parser will
    // ever see it.
    if (decoded?.returnPath && decoded.mode === 'join') {
      const target = new URL(decoded.returnPath, window.location.origin);
      target.searchParams.set('authError', error);
      window.location.href = `${target.pathname}${target.search}${target.hash}`;
      return;
    }
    if (decoded?.returnPath) {
      // Every other mode: go back where they came from, without a parameter nobody reads.
      // The decline itself is already recorded by the caller that started the redirect.
      window.location.href = decoded.returnPath;
      return;
    }
  }
  window.location.href = '/';
});
</script>

<template>
  <div class="dark:bg-surface-ground flex h-screen items-center justify-center bg-[#F8F9FA]">
    <p class="font-outfit dark:text-ink text-lg text-[#2C3E50]">{{ t('auth.loadingFile') }}</p>
  </div>
</template>
