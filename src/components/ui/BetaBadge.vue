<script setup lang="ts">
/**
 * Small "Beta" pill for features still in early release (e.g. the AI document
 * readers, launched 2026-06-07). Calm Sky Silk tint by default — informational,
 * never an alert colour — so it reads as "new, still cooking" rather than a
 * warning. Use `tone="onAccent"` on coloured surfaces (the bold orange FAB card).
 * Text is i18n so beanie-mode + zh apply.
 */
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ tone?: 'silk' | 'onAccent' }>();

const { t } = useTranslation();
</script>

<template>
  <span
    class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide uppercase"
    :class="
      tone === 'onAccent'
        ? 'bg-white/25 text-white'
        : 'bg-[var(--tint-silk-20)] text-[var(--color-text)]'
    "
  >
    {{ t('common.beta') }}
  </span>
</template>
