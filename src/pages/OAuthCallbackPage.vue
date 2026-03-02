<script setup lang="ts">
/**
 * OAuth callback page — receives authorization code from Google and sends it
 * to the parent window via postMessage. This page runs inside a popup.
 */
import { onMounted } from 'vue';

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (window.opener) {
    window.opener.postMessage({ type: 'oauth-callback', code, error }, window.location.origin);
  }

  // Close the popup after a short delay to ensure message is sent
  setTimeout(() => window.close(), 300);
});
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-[#F8F9FA]">
    <p class="font-outfit text-lg text-[#2C3E50]">counting beans...</p>
  </div>
</template>
