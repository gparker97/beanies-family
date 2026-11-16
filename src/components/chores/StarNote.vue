<script setup lang="ts">
/**
 * Stars and rewards (#148): the child-facing note for one bonus or take-away. Drawn on a kid's own
 * day (today's and yesterday's notes, newest first, under the greeting) and as the gift modal's
 * "{name} will see" preview, so the grown-up reads the exact words the child will read.
 *
 * Wording (the mockup's section 4 rules):
 *  - a bonus: "Mom gave you 2 bonus stars!" and the grown-up's note in quotes, when there is one;
 *  - a take-away: who took how many away, the grown-up's own reason in quotes, and the way
 *    forward ("Dad took away 1 star. "Bike left out in the rain." Your next chore wins it right
 *    back."). Never "lost", "penalty" or "minus", never red, never a tally of what is gone.
 *
 * Presentational: the gift and the giver's first name arrive from the page (or the modal).
 *
 * Dark mode (plan, Dark Mode Coverage): a bonus sits on `--tint-orange-8`, a take-back on
 * `--tint-silk-20` (both custom properties carry dark values in `style.css`, so the slab dims with
 * the theme); text `text-secondary-500` / `ink`. No scoped rule, no inline background.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreStarGift } from '@/types/models';

const props = defineProps<{
  gift: Pick<ChoreStarGift, 'stars' | 'note'>;
  /** The grown-up who gave it (first name), or '' when they are no longer in the family. */
  byName: string;
}>();

const { t } = useTranslation();

const isTake = computed(() => props.gift.stars < 0);
const count = computed(() => Math.abs(Math.round(props.gift.stars)));
const by = computed(() => props.byName || t('choreStars.note.someone'));
const note = computed(() => props.gift.note?.trim() ?? '');

const head = computed(() => {
  const one = count.value === 1;
  const key = isTake.value
    ? one
      ? 'choreStars.takeBack.note.title.one'
      : 'choreStars.takeBack.note.title.other'
    : one
      ? 'choreStars.bonus.note.title.one'
      : 'choreStars.bonus.note.title.other';
  return fillTemplate(t(key), { by: by.value, count: count.value });
});

const body = computed(() => {
  if (isTake.value) {
    const parts: string[] = [];
    if (note.value) {
      parts.push(
        // A reason with no closing punctuation gets its period inside the quote, so the next
        // sentence does not run on.
        fillTemplate(
          t(
            /[.!?。！？]$/.test(note.value)
              ? 'choreStars.bonus.note.quote'
              : 'choreStars.takeBack.note.quotePeriod'
          ),
          { note: note.value }
        )
      );
    }
    parts.push(
      t(
        count.value === 1
          ? 'choreStars.takeBack.note.forward.one'
          : 'choreStars.takeBack.note.forward.other'
      )
    );
    return parts.join(' ');
  }
  return note.value ? fillTemplate(t('choreStars.bonus.note.quote'), { note: note.value }) : '';
});
</script>

<template>
  <div
    class="flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm leading-snug"
    :class="isTake ? 'bg-[var(--tint-silk-20)]' : 'bg-[var(--tint-orange-8)]'"
    data-testid="star-note"
    :data-kind="isTake ? 'take' : 'bonus'"
  >
    <span class="flex-none text-base leading-snug" aria-hidden="true">{{
      isTake ? '↩' : '🌟'
    }}</span>
    <p class="text-secondary-500 dark:text-ink min-w-0">
      <b class="font-outfit font-bold">{{ head }}</b>
      <template v-if="body">{{ ` ${body}` }}</template>
    </p>
  </div>
</template>
