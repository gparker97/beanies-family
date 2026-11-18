<script setup lang="ts">
/**
 * The category guess, shown under the field it was read from (#152, mockup direction C): the
 * guessed category as a selected chip, the word it was picked from, and Change. Presentational:
 * the form owns the guess (`useCategoryGuess`) and passes what to show.
 *
 * The chip is the real `ChipButton`, so it carries the picker's selected style and its dark
 * lift; tapping it does what Change does (the mockup drew it inert). The wrapper always renders
 * so `aria-live` announces the guess as it appears and changes; with no `label` it is empty.
 *
 * With `holdFocus` (a pending guess) a press on the chip or Change keeps the focus where it is,
 * so the field the guess was read from is not blurred by tapping its guess (see the template).
 * Without it a press behaves as any button press does.
 */
import { computed } from 'vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{
  icon?: string;
  label?: string;
  /** The keyword that named the category. The line is left out when there is none. */
  word?: string;
  /** Keep the focus in the field on a press: set while the guess is pending (`useCategoryGuess`). */
  holdFocus?: boolean;
}>();

const emit = defineEmits<{ change: [] }>();

const { t } = useTranslation();

/** `@mousedown.prevent`, applied only with `holdFocus`. */
function onPress(event: MouseEvent): void {
  if (props.holdFocus) event.preventDefault();
}

const pickedFrom = computed(() =>
  props.word ? fillTemplate(t('categoryGuess.pickedFrom'), { word: props.word }) : ''
);
</script>

<template>
  <div aria-live="polite">
    <!-- For a pending guess a press here must not move the focus. Leaving the title commits a
         pending occasion guess (the activity form's `onTitleCommit`), which takes this hint
         away before the mouseup, so the click would never land and the form would switch to
         the occasion the person was trying to change. Tab out of the title is leaving the
         field too, so for a pending occasion it commits the occasion, by design; the hint's
         controls are then gone. A written guess holds nothing: a press there blurs as usual,
         so a phone keyboard is not kept up for no reason. -->
    <div v-if="label" class="mt-2 flex flex-wrap items-center gap-2" @mousedown="onPress">
      <ChipButton :label="label" :icon="icon" selected @click="emit('change')" />
      <span
        v-if="pickedFrom"
        class="font-outfit dark:text-ink-faint text-xs font-medium text-[var(--color-text-muted)]"
      >
        {{ pickedFrom }}
      </span>
      <button
        type="button"
        class="font-outfit text-primary-500 dark:text-accent-lift p-1 text-xs font-semibold underline underline-offset-2"
        @click="emit('change')"
      >
        {{ t('action.change') }}
      </button>
    </div>
  </div>
</template>
