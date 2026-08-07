<script setup lang="ts">
/**
 * The Vue-side twin of the Astro OAuth bridge interstitial
 * (`web/src/pages/oauth/native.astro`).
 *
 * Reaching this page means the apex exemption for `/oauth/native` is not serving
 * (see `infrastructure/modules/web/functions/apex-cutover.js`) or a stale
 * bare-URL 301 was cached on-device. It is never expected — but when it happens
 * the user is mid-sign-in with an auth code in the URL, so the one thing this
 * page must NOT do is silently redirect and drop it. That is the bug it exists
 * to catch.
 *
 * Same contract as the Astro page: report it, attempt the hop once, and always
 * render a working manual link. No timers — an earlier design armed a
 * `setTimeout` fallback, which races the hop it is meant to back up (a
 * successful hop backgrounds the app, the timer survives, and it navigates a
 * *successful* sign-in away to an error surface on resume).
 */
import { onMounted, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { reportError } from '@/utils/errorReporter';
import { hasOAuthResult, nativeBridgeUrl, NATIVE_BRIDGE_URI } from '@/constants/nativeOAuth';

const { t } = useTranslation();

// Rendered whether or not the hop is attempted, so a blocked, refused or
// dismissed hop always leaves a working manual path.
const bridgeHref = ref(NATIVE_BRIDGE_URI);

onMounted(() => {
  const search = window.location.search;

  reportError({
    surface: 'native-oauth',
    // `error`, not `critical`: the user recovers by signing in again, and the
    // Slack page budget is reserved for "data at risk". This still lands in the
    // CloudWatch firehose, which is where the regression will be visible.
    severity: 'error',
    message:
      'OAuth native return reached the Vue app — apex /oauth/native exemption is not serving',
    context: { action: 'web_backstop', route_path: window.location.pathname },
  });

  if (search) bridgeHref.value = nativeBridgeUrl(search);

  // A bare visit (no code, no error) must not hop: it would reach the app with
  // no `state` and fire a spurious native-oauth-state-mismatch report.
  if (hasOAuthResult(search)) {
    window.location.replace(nativeBridgeUrl(search));
  }
});
</script>

<template>
  <main class="bridge-page">
    <div class="card">
      <div class="emoji" aria-hidden="true">🫘</div>
      <h1>{{ t('oauth.nativeBridgeTitle') }}</h1>
      <p>{{ t('oauth.nativeBridgeBody') }}</p>
      <a class="cta" :href="bridgeHref">{{ t('oauth.nativeBridgeAction') }}</a>
    </div>
  </main>
</template>

<style scoped>
.bridge-page {
  align-items: center;
  background: var(--color-background);
  display: flex;
  justify-content: center;
  min-height: 100vh;
  padding: 1.5rem;
}

.card {
  max-width: 26rem;
  text-align: center;
}

.emoji {
  font-size: 2.5rem;
  margin-bottom: 0.75rem;
}

h1 {
  color: var(--color-text);
  font-family: Outfit, sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

p {
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.cta {
  background: var(--color-primary);
  border-radius: 0.75rem;
  color: #fff;
  display: inline-block;
  font-weight: 600;
  padding: 0.75rem 1.5rem;
  text-decoration: none;
}
</style>
