<script setup lang="ts">
/**
 * Stars and rewards (#148): what made up one child's week, opened from that week's bar in the Star
 * Report's "Stars by Week". The same shell and convention as the bonus summary
 * (`StarPopoverShell`): a bottom sheet on a phone, a card anchored to the bar from 768px; Escape,
 * the dim, an outside click and ✕ close it; focus returns to the bar. Read only: removing a
 * bonus entry stays in the Bonus column's summary.
 *
 * It draws the lines the report hands it (built from `weekBreakdown`, `utils/choreStars.ts`, so
 * they add up to the bar): a row per day in the week's own order (the day, chores done of due
 * when known, the stars from chores), then the week's bonus and take-away entries (each with who
 * and the note), or one net line when only the frozen net is known, then the total, and, when a
 * take-away would have taken the week below zero, one plain line saying a week never does.
 * Presentational: it knows nothing of the store.
 *
 * Dark mode: the shell is `StarPopoverShell`'s; day rows and entry tiles `--tint-slate-5` /
 * `surface-hover`; text `secondary-*` / `ink*`; a bonus amount green-700 / `success-lift`, a
 * take-away amount neutral ink (never red); the total's rule `--color-border` / `line`.
 */
import { computed } from 'vue';
import StarPopoverShell from '@/components/chores/StarPopoverShell.vue';
import type { BonusEntryLine } from '@/components/chores/StarBonusPopover.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { FamilyMember } from '@/types/models';

/** The week's lines, as the report builds them from `weekBreakdown`. */
export interface WeekBreakdownLines {
  days: { ymd: string; label: string; chores: string; stars: string }[];
  /** Each bonus and take-away entry, or `null` when only the net is known. */
  entries: BonusEntryLine[] | null;
  /** The net bonus, signed ("+2", "-1"); '' with no bonus at all. */
  net: string;
  /** The net was a take-away (drawn in neutral ink). */
  netTake: boolean;
  total: string;
  floored: boolean;
}

const props = defineProps<{
  open: boolean;
  member: FamilyMember | null;
  /** The child's first name. */
  name: string;
  /** The week's first day, as shown ("Nov 16"). */
  weekLabel: string;
  lines: WeekBreakdownLines | null;
  /** The bar it hangs from; focus returns here on close. */
  anchor: HTMLElement | null;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();

const title = computed(() =>
  fillTemplate(t('choreStars.report.weekPop.title'), { name: props.name })
);
const subtitle = computed(() =>
  fillTemplate(t('choreStars.report.bonusPop.week'), { date: props.weekLabel })
);
const tile =
  'dark:bg-surface-hover flex items-center gap-2.5 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2';
</script>

<template>
  <StarPopoverShell
    :open="open && !!lines"
    :member="member"
    :title="title"
    :subtitle="subtitle"
    :anchor="anchor"
    testid="star-week-popover"
    :foot="t('choreboard.pop.readOnly')"
    @close="emit('close')"
  >
    <template v-if="lines">
      <ul class="mt-3 flex flex-col gap-1.5" data-testid="star-week-days">
        <li
          v-for="day in lines.days"
          :key="day.ymd"
          :class="tile"
          class="text-sm"
          data-testid="star-week-day"
          :data-ymd="day.ymd"
        >
          <span class="font-outfit text-secondary-500 dark:text-ink w-10 flex-none font-semibold">{{
            day.label
          }}</span>
          <span
            class="text-secondary-500 dark:text-ink-soft min-w-0 flex-1 text-xs"
            data-testid="star-week-day-chores"
            >{{ day.chores }}</span
          >
          <b
            class="font-outfit text-secondary-500 dark:text-ink flex-none font-bold tabular-nums"
            data-testid="star-week-day-stars"
            >{{ day.stars }}</b
          >
        </li>
      </ul>

      <template v-if="lines.net">
        <p
          class="font-outfit text-secondary-500 dark:text-ink-soft mt-3 mb-1.5 text-xs font-semibold tracking-[0.08em] uppercase"
        >
          {{ t('choreStars.report.weekPop.bonusTitle') }}
        </p>
        <ul v-if="lines.entries" class="flex flex-col gap-1.5" data-testid="star-week-entries">
          <li
            v-for="entry in lines.entries"
            :key="entry.gift.id"
            :class="tile"
            data-testid="star-week-entry"
            :data-kind="entry.take ? 'take' : 'bonus'"
          >
            <span class="min-w-0 flex-1">
              <span
                class="font-outfit text-secondary-500 dark:text-ink block text-sm font-semibold"
                >{{ entry.title }}</span
              >
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
              data-testid="star-week-entry-amount"
              >{{ entry.amount }}</b
            >
          </li>
        </ul>
        <div v-else :class="tile" class="text-sm" data-testid="star-week-net">
          <span class="text-secondary-500 dark:text-ink min-w-0 flex-1">{{
            t('choreStars.report.weekPop.bonusNet')
          }}</span>
          <b
            class="font-outfit flex-none font-extrabold tabular-nums"
            :class="
              lines.netTake
                ? 'text-secondary-500 dark:text-ink'
                : 'dark:text-success-lift text-green-700'
            "
            >{{ lines.net }}</b
          >
        </div>
      </template>

      <div
        class="dark:border-line mt-3 flex items-baseline gap-2 border-t border-[var(--color-border)] pt-2.5"
        data-testid="star-week-total"
      >
        <span class="font-outfit text-secondary-500 dark:text-ink flex-1 text-sm font-bold">{{
          t('choreStars.report.weekPop.total')
        }}</span>
        <b
          class="font-outfit text-primary-700 dark:text-accent-lift text-base font-extrabold tabular-nums"
          data-testid="star-week-total-value"
          >{{ lines.total }}</b
        >
      </div>
      <p
        v-if="lines.floored"
        class="text-secondary-500 dark:text-ink-soft mt-1 text-xs"
        data-testid="star-week-floor"
      >
        {{ t('choreStars.report.weekPop.floor') }}
      </p>
    </template>
  </StarPopoverShell>
</template>
