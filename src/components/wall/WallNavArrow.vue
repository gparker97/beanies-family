<script setup lang="ts">
/**
 * One step arrow. Four of these existed as inline markup before this component.
 *
 * The days view draws its own pair beside the dates they move; the lanes and
 * today views keep theirs in the page header, because they have no date row to
 * put them beside. Writing the button twice would have meant two copies of the
 * aria-label, the disabled rule and the 44px target floor — the exact set of
 * things that drift apart silently.
 *
 * ⚠️ It carries NO chrome of its own beyond the class. `.wall-nav-arrow` is
 * styled by `BeanieWallPage`'s `:deep()` rules, which already match descendants
 * of child components — so this needs no new CSS, no new entry in the wall's
 * type scale, and no new translation key. Its rem sizing, its 44px floor and its
 * dark-mode partner all come across intact.
 */
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{
  /** -1 steps back, 1 steps forward. The same sign `step` carries. */
  direction: -1 | 1;
  /**
   * False at the range boundary. The button stays mounted and visibly dead
   * rather than disappearing — a control that vanishes under your finger is
   * worse than one that plainly will not move.
   */
  enabled: boolean;
}>();

const emit = defineEmits<{ step: [-1 | 1] }>();

const { t } = useTranslation();
</script>

<template>
  <button
    type="button"
    class="font-outfit text-secondary-500 wall-nav-arrow dark:bg-surface-raised dark:text-ink rounded-xl bg-white px-2.5 py-1.5 font-bold shadow-[var(--card-shadow)]"
    :class="enabled ? '' : 'pointer-events-none opacity-40'"
    :disabled="!enabled"
    :aria-label="direction === -1 ? t('planner.prevPeriod') : t('planner.nextPeriod')"
    @click="emit('step', props.direction)"
  >
    <span aria-hidden="true">{{ direction === -1 ? '‹' : '›' }}</span>
  </button>
</template>
