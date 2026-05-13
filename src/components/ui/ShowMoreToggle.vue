<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

/**
 * The standard "show first N, then expand / collapse" affordance.
 * Pair with `useExpandableList` for the windowing state. See ADR-025.
 *
 * Renders a full-width centred button for whichever of more / less is
 * currently available — in incremental mode both can show at once (they
 * stack); in all-or-nothing mode exactly one is ever true so it reads as
 * a single toggle. The chevron points down for "more", up for "less".
 */
interface Props {
  canShowMore: boolean;
  canShowLess?: boolean;
  /** Caller-supplied label for the "more" button — e.g. "Show all 9", "View more". */
  moreLabel: string;
  /** Defaults to `t('action.showLess')`. */
  lessLabel?: string;
  /**
   * Which surface this sits on:
   * - `on-light`        → light/white card, Heritage Orange text (default)
   * - `on-light-purple` → light/white card in a to-do context, purple text
   * - `on-accent`       → the Heritage Orange briefing card, white text
   */
  tone?: 'on-light' | 'on-light-purple' | 'on-accent';
}
const props = withDefaults(defineProps<Props>(), { canShowLess: false, tone: 'on-light' });
defineEmits<{ 'show-more': []; 'show-less': [] }>();

const { t } = useTranslation();

const TONE_CLASSES: Record<NonNullable<Props['tone']>, string> = {
  'on-light': 'py-2 text-primary-500 hover:bg-primary-500/5',
  'on-light-purple': 'py-2 text-[#9B59B6] hover:bg-[#9B59B6]/5',
  'on-accent':
    'border border-white/[0.12] bg-white/[0.07] py-1.5 text-white/[0.78] hover:bg-white/[0.13] hover:text-white',
};
const buttonClass = computed(() => TONE_CLASSES[props.tone]);
</script>

<template>
  <div v-if="canShowMore || canShowLess" class="mt-2 flex flex-col gap-1">
    <button
      v-if="canShowMore"
      type="button"
      class="font-outfit flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors"
      :class="buttonClass"
      @click="$emit('show-more')"
    >
      <span>{{ moreLabel }}</span>
      <BeanieIcon
        name="chevron-down"
        size="xs"
        class="transition-transform duration-200 motion-reduce:transition-none"
      />
    </button>
    <button
      v-if="canShowLess"
      type="button"
      class="font-outfit flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors"
      :class="buttonClass"
      @click="$emit('show-less')"
    >
      <span>{{ lessLabel ?? t('action.showLess') }}</span>
      <BeanieIcon
        name="chevron-down"
        size="xs"
        class="rotate-180 transition-transform duration-200 motion-reduce:transition-none"
      />
    </button>
  </div>
</template>
