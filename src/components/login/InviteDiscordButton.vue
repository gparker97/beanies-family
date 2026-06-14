<script setup lang="ts">
/**
 * The Heritage-Orange gradient "Discord" CTA used in the invite gate (the request
 * CTA and the confirmed-mode "join the Discord"). Extracted so the gradient + white-
 * ring-glyph chrome lives in ONE place (DRY). Deliberately login-scoped, not a shared
 * `ui/` component — the nudge/onboarding Discord CTAs use a different scoped-CSS idiom.
 *
 * `@click`, `data-testid`, and an extra `class` (e.g. `mb-2`) all fall through to the
 * root <button>, so callers attach behaviour/spacing without extra props.
 */
import DiscordGlyph from '@/components/ui/DiscordGlyph.vue';

defineProps<{ label: string }>();
</script>

<template>
  <button
    type="button"
    class="font-outfit from-primary-500 to-terracotta-400 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br px-4 py-3 text-sm font-bold text-white shadow-md transition hover:-translate-y-px hover:shadow-lg"
  >
    <span class="flex shrink-0 rounded-full bg-white p-1">
      <DiscordGlyph :size="18" />
    </span>
    {{ label }}
  </button>
</template>
