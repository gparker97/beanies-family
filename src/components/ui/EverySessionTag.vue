<script setup lang="ts">
/**
 * The small Sky Silk "Every Session" pill (#114): marks a to-do or list linked to the
 * WHOLE of a repeating activity, so it shows on every session rather than just this one.
 *
 * Background is `--tint-silk-20`, which carries its own dark value (style.css), so it needs no
 * `dark:bg-*` partner. Ink: `#1f5f80` on light (5.9:1 on the tint), `silk-lift` on dark
 * (5.5:1 on raised, 4.9:1 on overlay). The ↻ glyph is decorative.
 */
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <span
    class="font-outfit dark:text-silk-lift inline-flex flex-none items-center gap-1 rounded-full bg-[var(--tint-silk-20)] px-2 py-px text-xs font-semibold whitespace-nowrap text-[#1f5f80]"
    data-testid="every-session-tag"
  >
    <span aria-hidden="true">↻</span>{{ t('activityLinks.everySession') }}
  </span>
</template>
