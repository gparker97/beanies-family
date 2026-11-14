<script setup lang="ts">
/**
 * "This Week" (#146), beside the Chores Done board on the grown-ups' home: one row per bean with
 * chores (the board's order) with a slim bar and "32 of 44", done out of what was due Monday
 * through today; one line for the family's perfect days; then the board's legend. A bean's row
 * opens that bean's day, as the card header does (`open-day`).
 *
 * The SEED of the rewards and reports work (tracker #148), and deliberately limited to these
 * three things: per-bean progress, perfect days, the legend. Streaks, stars' worth and fuller
 * reports belong there, not here.
 *
 * Every number comes from `choreWeekTallies` over the SAME `choreWeekRecord`s the board's cells
 * show (the page passes one `rows` to both), so the card and the cells cannot disagree. It reads
 * the store's day clock through those records, never the minute clock. Grown-ups only (the page
 * decides).
 *
 * Dark mode: the card is `surface-raised` with a `line` edge; names `ink`, counts `ink-soft`; the
 * bar is the Heritage Orange gradient on `--tint-slate-10`, which switches with the theme.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { choreWeekTallies, type ChoreWeekRecord } from '@/utils/chores';
import { firstName } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  rows: { member: FamilyMember; week: ChoreWeekRecord }[];
  todayYmd: string;
}>();

const emit = defineEmits<{ 'open-day': [memberId: string] }>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

const tallies = computed(() =>
  choreWeekTallies(
    props.rows.map((r) => r.week),
    props.todayYmd
  )
);

const beans = computed(() =>
  props.rows.map((r, i) => {
    const tally = tallies.value.beans[i]!;
    const name = firstName(r.member.name);
    const vars = { name, done: tally.done, due: tally.due };
    return {
      member: r.member,
      name,
      tally,
      pct: tally.due ? Math.round((tally.done / tally.due) * 100) : 0,
      count: tally.due
        ? fillTemplate(t('choreboard.block.count'), { done: tally.done, total: tally.due })
        : t('choreboard.weekSummary.nothingDue'),
      aria: fillTemplate(
        t(tally.due ? 'choreboard.weekSummary.rowAria' : 'choreboard.weekSummary.rowAriaNone'),
        vars
      ),
    };
  })
);

const perfectLine = computed(() => {
  const n = tallies.value.perfectDays;
  if (n === 0) return t('choreboard.weekSummary.perfectNone');
  return fillTemplate(
    t(n === 1 ? 'choreboard.weekSummary.perfect.one' : 'choreboard.weekSummary.perfect.other'),
    { count: n }
  );
});

/** A past day (or today) with nothing due somewhere on the board: the legend explains it. */
const hasFreeDay = computed(() =>
  props.rows.some((r) => r.week.days.some((d) => d.ymd <= props.todayYmd && d.total === 0))
);
</script>

<template>
  <section
    class="dark:bg-surface-raised dark:border-line flex flex-col rounded-3xl bg-white px-4 pt-3.5 pb-3 shadow-[var(--card-shadow)] dark:border"
    data-testid="chore-week-summary"
  >
    <h2 class="font-outfit dark:text-ink text-secondary-500 mb-2 text-base font-bold">
      {{ t('choreboard.week.title') }}
    </h2>

    <ul class="flex flex-col gap-0.5">
      <li v-for="b in beans" :key="b.member.id">
        <button
          type="button"
          class="dark:hover:bg-surface-hover focus-visible:ring-sky-silk-300 grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-2xl px-1.5 py-1.5 text-left hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="b.aria"
          data-testid="chore-week-summary-row"
          :data-member-id="b.member.id"
          :data-done="b.tally.done"
          :data-due="b.tally.due"
          @click="emit('open-day', b.member.id)"
        >
          <BeanieAvatar
            class="row-span-2"
            v-bind="memberAvatarBindings(b.member)"
            size="sm"
            aria-hidden="true"
          />
          <span class="flex min-w-0 items-baseline justify-between gap-2" aria-hidden="true">
            <span
              class="font-outfit dark:text-ink text-secondary-500 min-w-0 truncate text-sm font-bold"
              >{{ b.name }}</span
            >
            <span
              class="font-outfit dark:text-ink-soft text-secondary-500 text-xs font-semibold whitespace-nowrap"
              data-testid="chore-week-summary-count"
              >{{ b.count }}</span
            >
          </span>
          <span
            class="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
            aria-hidden="true"
          >
            <span
              class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r transition-[width] duration-300 motion-reduce:transition-none"
              :style="{ width: `${b.pct}%` }"
              data-testid="chore-week-summary-bar"
            />
          </span>
        </button>
      </li>
    </ul>

    <p
      class="font-outfit mt-2 mb-3 text-sm font-semibold"
      :class="
        tallies.perfectDays
          ? 'text-primary-700 dark:text-accent-lift'
          : 'dark:text-ink-faint text-secondary-400'
      "
      data-testid="chore-week-summary-perfect"
    >
      <span v-if="tallies.perfectDays" aria-hidden="true">⭐ </span>{{ perfectLine }}
    </p>

    <!-- The board's legend. The cells' own labels say all of this, so it is hidden from
         screen readers. -->
    <div
      class="dark:border-line dark:text-ink-faint text-secondary-400 mt-auto flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-[var(--color-border)] pt-3 text-xs"
      aria-hidden="true"
      data-testid="chore-week-legend"
    >
      <span class="inline-flex items-center gap-1.5"
        ><i class="h-3.5 w-3.5 rounded-[5px] bg-[var(--chore-heat-2)]" />{{
          t('choreboard.week.legend.some')
        }}</span
      >
      <span class="inline-flex items-center gap-1.5"
        ><i class="h-3.5 w-3.5 rounded-[5px] bg-[var(--chore-heat-4)]" />{{
          t('choreboard.block.allDone')
        }}
        ⭐</span
      >
      <span class="inline-flex items-center gap-1.5"
        ><i
          class="h-3.5 w-3.5 rounded-[5px] border-[1.5px] border-dashed border-[var(--color-border)]"
        />{{ t('choreboard.week.legend.none') }}</span
      >
      <span class="inline-flex items-center gap-1.5"
        ><i class="h-3.5 w-3.5 rounded-[5px] border-[1.5px] border-[var(--color-border)]" />{{
          t('choreboard.week.legend.future')
        }}</span
      >
      <!-- Only when the board shows such a day, so the legend stays short. -->
      <span v-if="hasFreeDay" class="inline-flex items-center gap-1.5"
        ><i class="h-3.5 w-3.5 rounded-[5px] bg-[var(--tint-slate-5)]" />{{
          t('choreboard.week.legend.free')
        }}</span
      >
    </div>
  </section>
</template>
