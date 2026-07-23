<script setup lang="ts">
/**
 * The beanie-bell — "the bell IS the beanie cap" (#55): ribbed cap body, folded
 * cuff as the bell rim, a pom for the clapper hanger, and the clapper below.
 *
 * Monoline and drawn in `currentColor` so it inherits from its container, with
 * the pom as the single accent. Extracted here because it is now used in more
 * than one place (the Settings → Reminders card and that drawer's header);
 * `NotificationsBell` keeps its own copy because it animates individual paths
 * and layers the unread ring-lines on top.
 *
 * Decorative by default: callers put the accessible name on the interactive
 * parent, so this renders `aria-hidden`.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 26 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 40 40"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M20 6C14.2 6 10.8 10.8 10.8 18c0 5.2-1.4 7.6-2.7 9.4-.7 1 0 2.5 1.2 2.5h21.4c1.2 0 1.9-1.5 1.2-2.5-1.3-1.8-2.7-4.2-2.7-9.4C29.2 10.8 25.8 6 20 6Z"
    />
    <path d="M9.9 24.6c3.4 1.35 16.8 1.35 20.2 0" />
    <path d="M20 7.6V24.3" stroke-opacity=".5" />
    <path
      d="M20 30.2c-1.7 0-2.8 1.1-2.8 2.6a2.8 2.8 0 0 0 5.6 0c0-1.5-1.1-2.6-2.8-2.6Z"
      fill="currentColor"
      stroke="none"
    />
    <circle cx="20" cy="4.4" r="2.1" fill="currentColor" stroke="none" />
  </svg>
</template>
