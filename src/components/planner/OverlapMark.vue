<script setup lang="ts">
// The #34 overlap-mark motif: two rounded shapes sharing one moment ("two things
// at the same time"). Heritage Orange via `currentColor` — never Alert Red, because
// a clash is information, not a failure. Defined ONCE here and reused by
// ClashIndicator (grid/agenda) and the drawer callout. Size + colour come from the
// parent via class fallthrough (`h-3 w-auto text-primary-500`); the viewBox keeps
// the aspect ratio.
</script>

<template>
  <svg viewBox="0 0 26 16" fill="none" aria-hidden="true">
    <circle cx="9" cy="8" r="6.2" stroke="currentColor" stroke-width="1.7" opacity="0.85" />
    <circle cx="17" cy="8" r="6.2" stroke="currentColor" stroke-width="1.7" opacity="0.85" />
    <path
      d="M13 3.1 A6.2 6.2 0 0 1 13 12.9 A6.2 6.2 0 0 1 13 3.1 Z"
      fill="currentColor"
      opacity="0.9"
    />
  </svg>
</template>
