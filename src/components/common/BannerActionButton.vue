<script setup lang="ts">
/**
 * The action button inside an `ErrorBanner`.
 *
 * ⚠️ IT LIVES IN `common/`, BESIDE `ErrorBanner`, NOT IN `ui/`. Every banner in
 * this family is here; a shared child in another tree splits one feature across
 * two directories for no gain.
 *
 * The class strings were copy-pasted across three buttons in two banners and had
 * already drifted: `LineageBanner`'s export button carried no `aria-busy`, so a
 * screen reader was told nothing while an adopt ran. The extraction closes that
 * drift rather than preserving it — `aria-busy` is bound here, once.
 */
withDefaults(
  defineProps<{
    busy?: boolean;
    /** A quiet button for a secondary action (Dismiss). */
    subtle?: boolean;
  }>(),
  { busy: false, subtle: false }
);
</script>

<template>
  <button
    type="button"
    class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-white/10"
    :class="subtle ? 'hover:bg-white/10' : 'bg-white/20 hover:bg-white/30'"
    :disabled="busy"
    :aria-busy="busy"
  >
    <slot />
  </button>
</template>
