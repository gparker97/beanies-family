<script setup lang="ts">
/**
 * Who Owns What (#109): what a family sees before the first deal (Requirement 17, mockup
 * section 9). The hugging beanies, "Let's deal the deck", three steps, then Start Dealing
 * (grown-ups) and Browse the Deck First. Emits only: the page opens the deal pile.
 */
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { HELP_PATHS, openHelpArticle } from '@/utils/helpLinks';
import BaseButton from '@/components/ui/BaseButton.vue';
import type { UIStringKey } from '@/services/translation/uiStrings';

withDefaults(defineProps<{ total: number; canDeal?: boolean }>(), { canDeal: false });
const emit = defineEmits<{ start: []; browse: [] }>();

const { t } = useTranslation();

const STEPS: { title: UIStringKey; hint: UIStringKey }[] = [
  { title: 'whoOwnsWhat.first.step1', hint: 'whoOwnsWhat.first.step1Hint' },
  { title: 'whoOwnsWhat.first.step2', hint: 'whoOwnsWhat.first.step2Hint' },
  { title: 'whoOwnsWhat.first.step3', hint: 'whoOwnsWhat.first.step3Hint' },
];

function openHelp(): void {
  openHelpArticle(HELP_PATHS.whoOwnsWhat, 'who-owns-what-first-deal');
}
</script>

<template>
  <section
    class="grid items-center gap-6 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-8"
    data-testid="first-deal-empty"
  >
    <img
      src="/brand/beanies_family_hugging_transparent_512x512.png"
      :alt="t('whoOwnsWhat.first.imageAlt')"
      class="mx-auto w-full max-w-[12.5rem] md:max-w-[18rem]"
    />
    <div class="space-y-5">
      <div class="space-y-2">
        <h2 class="font-outfit dark:text-ink text-3xl font-extrabold text-[var(--color-text)]">
          {{ t('whoOwnsWhat.first.title') }}
        </h2>
        <p class="dark:text-ink-soft max-w-prose text-sm text-[var(--color-text-muted)]">
          {{ fillTemplate(t('whoOwnsWhat.first.body'), { count: total }) }}
        </p>
      </div>

      <ol class="space-y-2.5">
        <li
          v-for="(step, i) in STEPS"
          :key="step.title"
          class="dark:border-line dark:bg-surface-raised flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-white px-3 py-2.5"
        >
          <span
            class="font-outfit from-primary-500 to-terracotta-400 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-extrabold text-white"
            aria-hidden="true"
            >{{ i + 1 }}</span
          >
          <span class="min-w-0">
            <span
              class="font-outfit dark:text-ink block text-sm font-semibold text-[var(--color-text)]"
            >
              {{ t(step.title) }}
            </span>
            <span class="dark:text-ink-faint block text-xs text-[var(--color-text-muted)]">
              {{ t(step.hint) }}
            </span>
          </span>
        </li>
      </ol>

      <p v-if="!canDeal" class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
        {{ t('whoOwnsWhat.first.childNote') }}
      </p>

      <div class="flex flex-wrap items-center gap-3">
        <BaseButton v-if="canDeal" data-testid="first-deal-start" @click="emit('start')">
          {{ t('whoOwnsWhat.first.start') }}
        </BaseButton>
        <BaseButton variant="outline" data-testid="first-deal-browse" @click="emit('browse')">
          {{ t('whoOwnsWhat.first.browse') }}
        </BaseButton>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span v-if="canDeal" class="dark:text-ink-faint text-[var(--color-text-muted)]">
          {{ t('whoOwnsWhat.first.anyTime') }}
        </span>
        <button
          type="button"
          class="font-outfit text-primary-500 dark:text-accent-lift font-semibold underline-offset-2 hover:underline"
          @click="openHelp"
        >
          {{ t('whoOwnsWhat.first.help') }}
        </button>
      </div>
    </div>
  </section>
</template>
