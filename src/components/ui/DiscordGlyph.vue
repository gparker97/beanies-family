<script setup lang="ts">
/**
 * The Discord logo mark. The ONLY place Discord blurple (#5865F2) appears in the
 * app — a single, deliberate third-party-recognition exception to the 5-colour
 * CIG palette (everything around it stays on-brand; primary CTAs are Heritage
 * Orange). Decorative: callers provide the accessible label on the surrounding
 * control, so the SVG is aria-hidden.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 20 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="#5865F2"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.074.074 0 0 0-.079.037c-.34.6-.717 1.385-.98 2.001a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.997-2.001.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C1.235 8.018.572 11.578.9 15.093a.08.08 0 0 0 .031.055 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-4.06-.838-7.59-3.549-10.697a.06.06 0 0 0-.031-.028zM8.02 12.952c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.419-2.157 2.419z"
    />
  </svg>
</template>
