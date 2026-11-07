<script setup lang="ts">
/**
 * Small "Beta" pill for features still in early release (e.g. the AI document
 * readers, launched 2026-06-07). Calm Sky Silk tint by default — informational,
 * never an alert colour — so it reads as "new, still cooking" rather than a
 * warning. Use `tone="onAccent"` on coloured surfaces (the bold orange FAB card).
 * `tone="beans"` marks a magic beans feature (#143): the plan's lowercase name on a Heritage
 * Orange tint, so it is NOT upper-cased. White on the orange gradient measured 3.3:1 / 2.8:1 at
 * this size, under AA, so the tint pair is used: `primary-700` on the tint is 4.9:1 in light, and
 * `accent-lift` on the dark tint is 5.0:1 on a raised card.
 * Text is i18n so beanie-mode + zh apply.
 */
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

// `label` is a translation KEY (not a resolved string) so beanie-mode + zh stay
// reactive inside the badge. Defaults to "Beta"; pass another key (e.g.
// 'settings.beanieLab.testingTag') to reuse the exact pill for a "Testing" tag.
withDefaults(defineProps<{ tone?: 'silk' | 'onAccent' | 'beans'; label?: UIStringKey }>(), {
  tone: 'silk',
  label: 'common.beta',
});

const TONE_CLASS = {
  silk: 'bg-[var(--tint-silk-20)] text-[var(--color-text)] uppercase',
  onAccent: 'bg-white/25 text-white uppercase',
  beans: 'bg-[var(--tint-orange-15)] text-primary-700 dark:text-accent-lift normal-case',
} as const;

const { t } = useTranslation();
</script>

<template>
  <span
    class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide"
    :class="TONE_CLASS[tone]"
  >
    {{ t(label) }}
  </span>
</template>
