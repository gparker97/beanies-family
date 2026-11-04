<script setup lang="ts">
/**
 * The way back, named after where you came from.
 *
 * ⚠️ Written out twice, byte for byte — in the today view and on the jobs board
 * — inside the very change that extracted `WallNavArrow` to stop exactly that.
 * The two copies shared a class list, a translation key, a `fillTemplate` call
 * and a chevron, which is four things to keep in step by memory.
 *
 * It carries NO chrome of its own beyond `.wall-back`, which `BeanieWallPage`
 * styles through `:deep()`, so its rem sizing and dark-mode partner come across
 * intact. ⚠️ `.wall-back` sets font-size only — the 44px target comes from the
 * `px-4 py-2.5` here, not from the class, and an earlier version of this comment
 * credited the class with a floor it does not provide.
 *
 * Existing at all is greg's call, over my recommendation that the
 * always-visible view switcher made a back control unnecessary.
 *
 * `compact` gives the header form: the Today view's back control moved there (greg,
 * 2026-11-04) to give its own row back to the calendar, and the header row has no width for
 * "Back to each bean". It shows "‹ Each bean", or "‹ 👥" (the view's switcher glyph) on a wall
 * the page calls narrow; the page owns that breakpoint and toggles `.wall-back-name` /
 * `.wall-back-glyph`. The full sentence stays the accessible name in both.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{
  /** The view this returns to, already lowercased by the page. */
  backLabel: string;
  /** The header form: the view's name and its switcher glyph instead of the sentence. */
  compact?: { name: string; glyph: string };
}>();

const emit = defineEmits<{ back: [] }>();

const { t } = useTranslation();
const sentence = computed(() => fillTemplate(t('wall.jobsBoard.back'), { view: props.backLabel }));
</script>

<template>
  <button
    type="button"
    class="font-outfit text-secondary-500 wall-back dark:bg-surface-raised dark:text-ink shrink-0 rounded-2xl bg-white font-bold whitespace-nowrap shadow-[var(--card-shadow)]"
    :class="compact ? 'inline-flex items-center gap-1 px-2.5 py-2' : 'px-4 py-2.5'"
    :aria-label="compact ? sentence : undefined"
    @click="emit('back')"
  >
    <span aria-hidden="true">‹</span>
    <template v-if="compact">
      <span class="wall-back-name">{{ compact.name }}</span>
      <span class="wall-back-glyph" aria-hidden="true">{{ compact.glyph }}</span>
    </template>
    <template v-else>{{ sentence }}</template>
  </button>
</template>
