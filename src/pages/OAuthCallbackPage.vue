<script setup lang="ts">
/**
 * OAuth callback page — receives authorization code from Google.
 *
 * Popup mode: sends code to parent window via postMessage, then closes.
 * Redirect mode (mobile): saves code to sessionStorage and redirects back
 * to the original page so completeRedirectAuth() can finish the exchange.
 */
import { onMounted } from 'vue';

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

  // Redirect mode — save code and redirect back to the original page
  const stateJson = sessionStorage.getItem('beanies_redirect_auth');
  if (stateJson && code) {
    sessionStorage.setItem('beanies_redirect_auth_code', code);
    try {
      const state = JSON.parse(stateJson);
      window.location.href = state.returnPath || '/';
    } catch {
      window.location.href = '/';
    }
    return;
  }

  // Error or unexpected state — redirect home
  if (error) {
    sessionStorage.removeItem('beanies_redirect_auth');
  }
  window.location.href = '/';
});
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-[#F8F9FA]">
    <p class="font-outfit text-lg text-[#2C3E50]">counting beans...</p>
  </div>
</template>
