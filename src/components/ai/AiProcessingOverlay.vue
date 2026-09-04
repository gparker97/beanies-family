<script setup lang="ts">
/**
 * "counting beans..." — the blocking overlay shown while a document is being read.
 *
 * Extracted because this markup existed FOUR times (the planner, travel, the cookbook and
 * `RecipeFormModal`), and a fifth was needed for the share target. A share is the case that
 * most needs it: the app has just been launched by another app, so there is no page to look
 * at and no obvious sign anything is happening — it simply sat there for four or five
 * seconds and then a form appeared.
 *
 * Deliberately the same z-layer and treatment everywhere, so the reader looks identical
 * whichever door the document came through.
 */
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ open: boolean }>();

const { t } = useTranslation();
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
  >
    <div
      class="dark:bg-surface-raised flex flex-col items-center gap-3 rounded-3xl bg-white px-8 py-6 shadow-[var(--soft-shadow)]"
    >
      <BeanieSpinner size="lg" :halo="true" />
      <p class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]">
        {{ t('ai.processing') }}
      </p>
    </div>
  </div>
</template>
