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
import { decodeRedirectState } from '@/services/google/redirectState';
import { stashPickerSelection } from '@/services/google/pickerRedirect';
import { classifyOAuthError } from '@/services/google/oauthError';
import { reportError } from '@/utils/errorReporter';
import { useTranslation } from '@/composables/useTranslation';
import { setResumeReason } from '@/components/login/resumePaths';
import { classifyCreateDriveFailure } from '@/services/sync/createDriveErrors';
import { trackOnboardingStep } from '@/services/telemetry/onboardingAttempt';

const { t } = useTranslation();

/**
 * Whether this callback closes the create flow's Drive-consent redirect (#128). Mode alone is
 * not enough: the calendar connect redirect is also `mode: 'create'` (`calendarSyncStore`), and
 * a calendar decline must neither stash the create flow's resume reason nor count as a Drive
 * consent exit.
 */
function isCreateDriveGrant(d: ReturnType<typeof decodeRedirectState>): boolean {
  return d?.mode === 'create' && d.grant === 'drive';
}

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
  // One rule with the native deep link (`classifyOAuthError`): only a BARE `access_denied` is a
  // decline; a described one is forwarded as `access_denied: <description>` for each consumer to
  // classify (the create flow reads it as a decline too).
  const classified = classifyOAuthError(params.get('error'), params.get('error_description'));
  const error = classified?.message ?? null;
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

  // PICKER grant: the system-browser Google Picker returning a file selection.
  //
  // ⚠️ ABOVE THE CODE ARM ON PURPOSE, so ONE arm owns every picker outcome. Traced against the
  // ladder below, both alternatives are actively wrong:
  //   - a cancel returns neither `code` nor `error`, so it would fall past `if (code)` and
  //     `if (error)` to the terminal `window.location.href = '/'`, DISCARDING THE INVITE URL and
  //     dead-ending the joiner silently — the exact class of bug the comment block down there was
  //     written to fix;
  //   - a decline that DOES return `error=access_denied` would take the join arm and append
  //     `?authError=access_denied`, which renders as a sign-in failure. True for a declined
  //     consent, false for "I closed a file chooser".
  // So every picker outcome, including cancel and decline, returns to `returnPath` (never `/`,
  // never with `?authError`). The picked ids are parked for the next `pick()`.
  if (decoded?.grant === 'picker') {
    if (!stashPickerSelection(params.get('picked_file_ids'), 'web')) {
      reportError({
        surface: 'oauth.redirectStateLost',
        severity: 'critical',
        message: 'picker redirect returned but the selection could not be stashed',
      });
    }
    window.location.href = decoded.returnPath;
    return;
  }

  if (decoded && code) {
    // Route the code to the grant's own key so a calendar code can never collide
    // with (or be consumed as) a Drive code. A full-page redirect makes only one
    // grant's code pending at a time — the keys are structurally isolated.
    const codeKey =
      decoded.grant === 'calendar' ? CALENDAR_REDIRECT_CODE_KEY : REDIRECT_AUTH_CODE_KEY;
    if (stashCode(code, codeKey)) {
      // The create funnel's web consent exit (#128): Google said yes. Recorded here because
      // App.vue's settle returns a token, not a mode. The attempt was hydrated from localStorage
      // at boot, and `logEvent` enqueues synchronously, so the event rides the unload beacon.
      if (isCreateDriveGrant(decoded)) trackOnboardingStep('drive-consent', 'submitted');
      window.location.href = decoded.returnPath;
      return;
    }
    // Couldn't forward the code — fall through to the reported "lost" surface.
  }

  // GENUINELY LOST: a code in hand we can't forward (no valid `state`, or the code
  // stash threw). A hard onboarding block — report it.
  if (code) {
    reportError({
      surface: 'oauth.redirectStateLost',
      message:
        'OAuth redirect returned with a code but no usable routing state (malformed/absent `state` param, or storage write failed)',
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
      //
      // ⚠️ THIS ARM IS THE RECORD of a failed web redirect (#128). The page that started the
      // redirect has unloaded, so nobody else can log it or explain it. For the create flow's
      // Drive grant, EVERY error (a bare decline included): stash its create registry code so
      // the resume screen says what happened (never a silent PIN step), and close the funnel's
      // `drive-consent` step with the same code. The classifier reads the classified string as
      // readily as an `Error`: a bare `access_denied` is `cancelled`, a described one
      // `access-denied`, and only Google's explicit policy codes are `app-blocked`. `error` is an attacker-controllable query parameter (and
      // `redactContext` only truncates), so the firehose gets the closed code set, never the
      // raw value.
      if (isCreateDriveGrant(decoded)) {
        const code = classifyCreateDriveFailure(error);
        setResumeReason(code);
        trackOnboardingStep('drive-consent', 'back', { error_code: code });
      }
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
