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
 * Each entry is the shared `StarGiftRow` (its words and amount colours), with this summary's tile,
 * its glyph in the leading slot and the remove button in the trailing one.
 *
 * Dark mode: the shell is `StarPopoverShell`'s (the shared `CHORE_POPOVER_*` look); entry tiles
 * `--tint-slate-5` / `surface-hover`; the row's text and amount are `StarGiftRow`'s.
 */
import { computed } from 'vue';
import StarPopoverShell from '@/components/chores/StarPopoverShell.vue';
import StarGiftRow from '@/components/chores/StarGiftRow.vue';
import type { BonusEntryLine } from '@/components/chores/starText';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreStarGift, FamilyMember } from '@/types/models';

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
      <StarGiftRow
        v-for="entry in entries"
        :key="entry.gift.id"
        :entry="entry"
        amount-testid="star-bonus-entry-amount"
        amount-hidden
        class="dark:bg-surface-hover flex items-center gap-2.5 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5"
        data-testid="star-bonus-entry"
        :data-gift-id="entry.gift.id"
        :data-kind="entry.take ? 'take' : 'bonus'"
      >
        <template #leading>
          <span class="flex-none text-base" aria-hidden="true">{{ entry.take ? '↩' : '🌟' }}</span>
        </template>
        <template v-if="removable" #trailing>
          <button
            type="button"
            class="dark:text-ink-soft dark:hover:bg-surface-overlay text-secondary-500 focus-visible:ring-sky-silk-300 -mr-1 grid h-8 w-8 flex-none place-items-center rounded-xl hover:bg-[var(--tint-slate-10)] focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="t('choreStars.report.remove.label')"
            :title="t('choreStars.report.remove.label')"
            data-testid="star-bonus-entry-remove"
            @click="emit('remove', entry.gift)"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </template>
      </StarGiftRow>
    </ul>
  </StarPopoverShell>
</template>
