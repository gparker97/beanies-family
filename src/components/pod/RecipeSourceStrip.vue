<script setup lang="ts">
/**
 * "Start from a link" — the recipe form's magic-beans offer.
 *
 * Deliberately the one magic surface that is NOT the orange gradient: warm kraft with an
 * orange hairline, quieter in structure than the fields below it but warmer in colour, so it
 * reads as an offer rather than a required step.
 *
 * It used to carry its own URL field and its own validation. Both are gone: every door now
 * opens the same sheet, which takes a link, a photo, a file or pasted text and works out what
 * it is. Keeping a second, link-only input here would have been the one door that still asked
 * the user to have the right KIND of thing before beanies had looked at it.
 */
import { useTranslation } from '@/composables/useTranslation';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

const { t } = useTranslation();

defineEmits<{ start: [] }>();
</script>

<template>
  <section
    class="dark:bg-surface-paper mb-5 rounded-[var(--sq)] border border-[rgb(230_126_34_/_18%)] bg-[#fbf3e3] p-3.5 sm:p-4 dark:border-[rgb(240_160_90_/_20%)]"
  >
    <h3
      class="font-outfit text-secondary-500 dark:text-ink flex items-center gap-2 text-sm font-extrabold"
    >
      <span aria-hidden="true">✨</span>
      <span>{{ t('recipeExtract.strip.title') }}</span>
    </h3>
    <p class="font-outfit text-secondary-500/70 dark:text-ink-soft mt-0.5 text-xs">
      {{ t('recipeExtract.strip.subtitle') }}
    </p>

    <button
      type="button"
      class="bg-primary-500 font-outfit mt-2.5 inline-flex h-11 cursor-pointer items-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white transition-colors hover:brightness-105"
      @click="$emit('start')"
    >
      <BeanieIcon name="image" size="sm" class="opacity-80" />
      <span>{{ t('recipeExtract.strip.action') }}</span>
    </button>
  </section>
</template>
