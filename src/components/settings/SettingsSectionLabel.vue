<script setup lang="ts">
// The small uppercase sub-heading that splits a settings drawer into sections (Beanie Wall
// Settings' "Night Mode" and "Weather", Region & Holidays' "Weather"). One component so the
// three uses cannot drift apart.
</script>

<template>
  <p
    class="font-outfit dark:text-ink-faint text-xs font-bold tracking-[0.1em] text-[var(--deep-slate)] uppercase"
  >
    <slot />
  </p>
</template>
