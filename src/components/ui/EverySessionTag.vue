<script setup lang="ts">
/**
 * The small Sky Silk "Every Session" pill (#114): marks a to-do or list linked to the
 * WHOLE of a repeating activity, so it shows on every session rather than just this one.
 *
 * Background is `--tint-silk-20` and ink `--silk-ink`, which both carry their own dark values
 * (style.css), so it needs no `dark:*` partner. The ↻ glyph is decorative.
 */
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <span
    class="font-outfit inline-flex flex-none items-center gap-1 rounded-full bg-[var(--tint-silk-20)] px-2 py-px text-xs font-semibold whitespace-nowrap text-[var(--silk-ink)]"
    data-testid="every-session-tag"
  >
    <span aria-hidden="true">↻</span>{{ t('activityLinks.everySession') }}
  </span>
</template>
