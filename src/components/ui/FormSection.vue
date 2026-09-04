<script setup lang="ts">
import { useId } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useTranslation } from '@/composables/useTranslation';

/**
 * A named group of fields inside a long form — a heading, a hairline running to the edge, and
 * the fields beneath it.
 *
 * Built for the recipe form, which had grown to eleven `FormFieldGroup`s in one flat scroll,
 * but deliberately generic: it knows nothing about recipes, and the next long form can use it.
 *
 * ⚠️ TYPE SCALE, and it is the whole reason this is a component rather than a `<h3>` inline.
 * `FormFieldGroup`'s own label is already `text-xs` uppercase with `0.1em` tracking. A section
 * heading styled the same way — the obvious first instinct, and what the CIG's own field
 * labels would suggest — reads as a PEER of the field labels and the hierarchy inverts: you
 * get twelve equal-weight small-caps labels instead of four groups of three. So this is
 * `text-sm`, sentence case, no tracking: clearly one tier ABOVE, and the only place in the
 * form using that combination.
 *
 * Renders a real `<section>` with `aria-labelledby`, so the grouping reaches a screen reader
 * as grouping rather than as decoration — which is most of the point of adding it.
 */
withDefaults(
  defineProps<{
    labelKey: UIStringKey;
    /** Decorative only — always `aria-hidden`, never the sole carrier of meaning. */
    emoji?: string;
    /** Omits the top margin on the first section, where a rule above would float. */
    first?: boolean;
  }>(),
  { emoji: '', first: false }
);

const { t } = useTranslation();
const headingId = useId();
</script>

<template>
  <section :aria-labelledby="headingId" :class="first ? 'mb-6' : 'mt-7 mb-6'">
    <div class="mb-3 flex items-center gap-2">
      <span v-if="emoji" class="text-sm" aria-hidden="true">{{ emoji }}</span>
      <h3
        :id="headingId"
        class="font-outfit text-secondary-500 dark:text-ink text-sm font-bold whitespace-nowrap"
      >
        {{ t(labelKey) }}
      </h3>
      <span class="dark:bg-line h-px flex-1 bg-[var(--tint-slate-10)]" aria-hidden="true"></span>
    </div>
    <slot />
  </section>
</template>
