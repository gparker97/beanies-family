<script setup lang="ts">
/**
 * One selectable plan card on the Plan page (#95 Phase 5): a radio in a radiogroup, the price
 * with the struck list price when the family pays less, and the bullets. The full plan passes
 * its interval toggle through the slot; everything else is identical between the two plans.
 */
import type { PlanId } from '@beanies/brand/pricing';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  plan: PlanId;
  selected: boolean;
  nameKey: UIStringKey;
  forKey: UIStringKey;
  /** What the family pays, and the list price beside it (struck through when they differ). */
  price: string;
  list: string;
  perKey: UIStringKey;
  bullets: readonly UIStringKey[];
}>();

const emit = defineEmits<{ (e: 'choose', plan: PlanId): void }>();
const { t } = useTranslation();

function onKey(e: KeyboardEvent): void {
  // Only the card itself: a Space/Enter on a slotted control (the interval toggle) must keep its
  // own native activation.
  if (e.target !== e.currentTarget) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    emit('choose', props.plan);
  }
}
</script>

<template>
  <div
    role="radio"
    :aria-checked="selected"
    tabindex="0"
    :data-testid="`plan-card-${plan}`"
    class="dark:bg-surface-raised relative cursor-pointer rounded-3xl border-2 bg-white p-5 transition-colors"
    :class="selected ? 'border-primary-500' : 'dark:border-line border-secondary-100'"
    @click="emit('choose', plan)"
    @keydown="onKey"
  >
    <span
      aria-hidden="true"
      class="absolute top-5 right-5 h-5 w-5 rounded-full border-2"
      :class="
        selected
          ? 'border-primary-500 bg-primary-500 dark:ring-surface-raised ring-4 ring-white ring-inset'
          : 'dark:border-line-strong border-secondary-200'
      "
    />
    <h2 class="font-outfit text-secondary-500 dark:text-ink pr-8 text-lg font-semibold">
      {{ t(nameKey) }}
    </h2>
    <p class="text-secondary-400 dark:text-ink-soft mt-1 text-sm">{{ t(forKey) }}</p>
    <p class="mt-4 flex items-baseline gap-2">
      <span
        class="font-outfit text-secondary-500 dark:text-ink text-4xl font-extrabold"
        :data-testid="`plan-${plan}-price`"
      >
        {{ price }}
      </span>
      <span class="text-secondary-400 dark:text-ink-soft text-sm">{{ t(perKey) }}</span>
      <span
        v-if="price !== list"
        class="font-outfit text-secondary-300 dark:text-ink-faint text-base line-through"
      >
        {{ list }}
      </span>
    </p>
    <slot />
    <ul class="text-secondary-500 dark:text-ink-soft mt-4 space-y-1.5 text-sm">
      <li v-for="k in bullets" :key="k" class="flex gap-2">
        <span aria-hidden="true" class="text-primary-500 dark:text-accent-lift text-xs leading-5"
          >●</span
        >
        {{ t(k) }}
      </li>
    </ul>
  </div>
</template>
