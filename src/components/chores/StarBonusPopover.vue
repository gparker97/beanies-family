<script setup lang="ts">
/**
 * Stars and rewards (#148): one child's bonus stars for one week, opened from that child's Bonus
 * number on the Star Report's Chores Done board. The same "tap a number to see it" convention as
 * a day's summary (`ChoreDayPopover`): the shell is `StarPopoverShell` (shared with the week's
 * breakdown, `StarWeekPopover`), a bottom sheet over a dim on a phone, a card anchored to the
 * number from 768px; Escape, the dim, an outside click and ✕ close it; focus starts on ✕ and
 * returns to the number.
 *
 * It lists the entries the report hands it, newest first: who gave or took away, the signed
 * amount, the day and the note. In the open week each entry has a remove button (`remove`, the
 * report confirms and writes); a closed week's entries are read only. Presentational: the report
 * builds every line from `starStore`, so this knows nothing of the store.
 *
 * Dark mode: the shell is `StarPopoverShell`'s (the shared `CHORE_POPOVER_*` look); entry tiles `--tint-slate-5` / `surface-hover`; text `secondary-*` / `ink*`; a bonus
 * amount green-700 / `success-lift`, a take-away amount neutral ink (never red).
 */
import { computed } from 'vue';
import StarPopoverShell from '@/components/chores/StarPopoverShell.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreStarGift, FamilyMember } from '@/types/models';

/** One line of the summary, built by the report. */
export interface BonusEntryLine {
  gift: ChoreStarGift;
  /** A take-away (the gift's stars are below zero). */
  take: boolean;
  /** "Mom gave 2 bonus stars", "Dad took away 1 star". */
  title: string;
  /** "+2", "-1". */
  amount: string;
  /** The day and the note: `Tue. "Helped with the dishes"`. */
  sub: string;
}

const props = defineProps<{
  open: boolean;
  member: FamilyMember | null;
  /** The child's first name. */
  name: string;
  /** The week's first day, as shown ("Nov 16"). */
  weekLabel: string;
  entries: BonusEntryLine[];
  /** The open week: entries can be removed. */
  removable: boolean;
  /** The number it hangs from; focus returns here on close. */
  anchor: HTMLElement | null;
}>();

const emit = defineEmits<{ close: []; remove: [gift: ChoreStarGift] }>();

const { t } = useTranslation();

const isOpen = computed(() => props.open && !!props.member && props.entries.length > 0);
const title = computed(() =>
  fillTemplate(t('choreStars.report.bonusPop.title'), { name: props.name })
);
const subtitle = computed(() =>
  fillTemplate(t('choreStars.report.bonusPop.week'), { date: props.weekLabel })
);
</script>

<template>
  <StarPopoverShell
    :open="isOpen"
    :member="member"
    :title="title"
    :subtitle="subtitle"
    :anchor="anchor"
    testid="star-bonus-popover"
    :foot="t(removable ? 'choreStars.report.bonusPop.footOpen' : 'choreboard.pop.readOnly')"
    @close="emit('close')"
  >
    <ul class="mt-3 flex flex-col gap-2">
      <li
        v-for="entry in entries"
        :key="entry.gift.id"
        class="dark:bg-surface-hover flex items-center gap-2.5 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5"
        data-testid="star-bonus-entry"
        :data-gift-id="entry.gift.id"
        :data-kind="entry.take ? 'take' : 'bonus'"
      >
        <span class="flex-none text-base" aria-hidden="true">{{ entry.take ? '↩' : '🌟' }}</span>
        <span class="min-w-0 flex-1">
          <span class="font-outfit text-secondary-500 dark:text-ink block text-sm font-semibold">{{
            entry.title
          }}</span>
          <span
            v-if="entry.sub"
            class="text-secondary-500 dark:text-ink-soft block text-xs break-words"
            >{{ entry.sub }}</span
          >
        </span>
        <b
          class="font-outfit flex-none text-sm font-extrabold tabular-nums"
          :class="
            entry.take
              ? 'text-secondary-500 dark:text-ink'
              : 'dark:text-success-lift text-green-700'
          "
          aria-hidden="true"
          data-testid="star-bonus-entry-amount"
          >{{ entry.amount }}</b
        >
        <button
          v-if="removable"
          type="button"
          class="dark:text-ink-soft dark:hover:bg-surface-overlay text-secondary-500 focus-visible:ring-sky-silk-300 -mr-1 grid h-8 w-8 flex-none place-items-center rounded-xl hover:bg-[var(--tint-slate-10)] focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="t('choreStars.report.remove.label')"
          :title="t('choreStars.report.remove.label')"
          data-testid="star-bonus-entry-remove"
          @click="emit('remove', entry.gift)"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </li>
    </ul>
  </StarPopoverShell>
</template>
