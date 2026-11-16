<script setup lang="ts">
/**
 * "Chores Done" (#146): the week as squarish day cells (`ChoreDayCell`), Monday to Sunday (the
 * family's week start), with each bean's week total (the legend lives in the "This Week" card, `ChoreWeekSummary`). Tapping a past day or
 * today opens that day's read-only summary (`ChoreDayPopover`); days still to come do nothing.
 *
 * Every number is a `choreDayRecord` from `choreStore.weekFor` (rows), and the popover is handed
 * the very record its cell counted, so a cell and its summary always agree.
 *
 * Two shapes, one component:
 *  - the grown-ups' board, days ACROSS (beans down), below the cards at every width. The day
 *    columns grow with the card up to a cap (6.5rem), the grid centred past it; under 30rem of board (`container-name: chore-board`)
 *    the names fold to avatars and the cells turn square;
 *  - one bean's own week (`single`): seven across, the total in the header, the hint under it,
 *    no legend. It replaces the old "This week" row on a bean's day.
 * The board itself is grown-ups only (the page decides); a child sees only their own week.
 *
 * Two optional extensions, both unused (and the board unchanged) unless passed:
 *  - `weeks` + `v-model:week`: the week stepper (`ChoreWeekStepper`) in the header, over the
 *    weeks the page offers, newest first. The page feeds `rows` for the week chosen; stepped back,
 *    the board says it is looking back (the stepper's middle button reads "Back to This Week").
 *    A past week is read-only like every week here: a cell only opens its summary, and the
 *    summary's "Open {Name}'s Day" is offered on today alone.
 *  - `extras`: trailing facts per bean, keyed by member id (the Star Report's stars, bonus and
 *    weekly reward), with a head per column. Columns on a wide board; under 48rem of board the
 *    heads go and each bean's facts stack under its row, each with its own label. A bean can
 *    instead have one note across them all ("No record for this week"). The panel knows nothing
 *    of what the facts mean: it draws text in one of a few tones. A fact with an `action` is a
 *    button (the same tap-a-number convention as a day cell): the panel emits `fact-action` with
 *    the bean, the action's id and the button as the anchor, and the page opens whatever it
 *    means (the Star Report's bonus summary). `expanded` mirrors the page's open state.
 *
 * Telemetry: `day-popover-opened` (info, surface `choreboard`) with `kind` (today | past),
 * `count` (chores done that day) and `detail` (home | day), so how often the summary is used,
 * and on what, reads from the firehose. Nothing here writes.
 *
 * Dark mode: the panel is `surface-raised` with a `line` edge; heads are `ink-faint`, today's
 * head and the totals `accent-lift`.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ChoreDayCell from '@/components/chores/ChoreDayCell.vue';
import ChoreDayPopover from '@/components/chores/ChoreDayPopover.vue';
import ChoreWeekStepper from '@/components/chores/ChoreWeekStepper.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';
import {
  choreDayOfWeek,
  choreWeekPercent,
  choreWeekTallies,
  type ChoreDayRecord,
  type ChoreWeekRecord,
} from '@/utils/chores';
import { firstName } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiDate } from '@/utils/uiLocale';
import type { FamilyMember } from '@/types/models';

/** One trailing fact on a bean's row (see `extras`). */
export interface WeekPanelFact {
  text: string;
  /** strong: the headline number; good: a gain; done: an achieved tag; quiet: nothing to say. */
  tone?: 'strong' | 'good' | 'done' | 'quiet';
  /** A quieter word beside it ("33 of 32"). */
  sub?: string;
  testid?: string;
  /** Makes the fact a button: tapping it emits `fact-action` with this id. */
  action?: WeekPanelFactAction;
}
/** A fact's tap: its id, the button's accessible name, and whether what it opens is open. */
export interface WeekPanelFactAction {
  id: string;
  label: string;
  expanded?: boolean;
}
/** A bean with no facts to show: one note across every trailing column. */
export interface WeekPanelNote {
  note: string;
  hint?: string;
}
export interface WeekPanelExtras {
  /** The trailing columns' heads, left to right. */
  heads: string[];
  /** By member id: one fact per head, or a note. */
  rows: Record<string, WeekPanelFact[] | WeekPanelNote>;
}

const props = withDefaults(
  defineProps<{
    rows: { member: FamilyMember; week: ChoreWeekRecord }[];
    todayYmd: string;
    /** One bean's own week (their day page). */
    single?: boolean;
    /** Offer "Open {Name}'s Day" on today's summary (home only). */
    openDayAction?: boolean;
    /** The weeks the header's stepper offers, newest first; no stepper without two or more. */
    weeks?: readonly string[];
    /** The week start showing (`v-model:week`), with `weeks`. */
    week?: string;
    /** Trailing facts per bean (the board only, never `single`). */
    extras?: WeekPanelExtras;
  }>(),
  { single: false, openDayAction: false, weeks: undefined, week: undefined, extras: undefined }
);

const emit = defineEmits<{
  'open-day': [memberId: string];
  'update:week': [weekStart: string];
  /** A fact with an `action` was tapped; `anchor` is its button. */
  'fact-action': [payload: { memberId: string; id: string; anchor: HTMLElement }];
}>();

const { t, currentLanguage } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

/** The week's seven dates, from the first row (every row shares the family's week). */
const days = computed(() =>
  (props.rows[0]?.week.days ?? []).map((d) => ({
    ymd: d.ymd,
    short: t(CHORE_DAY_LABEL_KEYS[choreDayOfWeek(d.ymd)] ?? 'planner.day.mon'),
    long: formatUiDate(d.ymd, currentLanguage.value, { weekday: 'long' }),
    isToday: d.ymd === props.todayYmd,
  }))
);
const weekdayOf = (ymd: string) => days.value.find((d) => d.ymd === ymd)?.long ?? '';

const cellShape = computed(() => (props.single ? 'square' : 'wide'));

/** The header's stepper: only with somewhere to step to. */
const showStepper = computed(() => !!props.weeks && props.weeks.length > 1);
/** Showing a week other than the newest offered. */
const lookingBack = computed(
  () => showStepper.value && !!props.week && props.weeks!.indexOf(props.week) > 0
);

/** The trailing columns' heads (none on one bean's own week). */
const extraHeads = computed(() => (props.single ? [] : (props.extras?.heads ?? [])));

/**
 * A bean's week total: done out of what was DUE so far, with the percentage beside it.
 *
 * It was a bare count of stars, which is unfair between beans with different numbers of
 * chores: 9 of 10 read as more than 8 of 8. The numbers are `choreWeekTallies`, the same tally
 * the "This Week" card shows, so the two cannot disagree.
 */
interface WeekTotal {
  done: number;
  due: number;
  /** "8 of 8". */
  count: string;
  /** "100%". */
  percent: string;
  aria: string;
}
const totals = computed<WeekTotal[]>(() =>
  choreWeekTallies(
    props.rows.map((r) => r.week),
    props.todayYmd
  ).beans.map((tally, i) => {
    const vars = { done: tally.done, due: tally.due, pct: choreWeekPercent(tally) };
    const member = props.rows[i]?.member;
    return {
      done: tally.done,
      due: tally.due,
      count: fillTemplate(t('choreboard.block.count'), { done: tally.done, total: tally.due }),
      percent: fillTemplate(t('choreboard.week.percent'), vars),
      aria:
        props.single || !member
          ? fillTemplate(t('choreboard.week.totalAria'), vars)
          : fillTemplate(t('choreboard.week.totalAriaFor'), {
              ...vars,
              name: firstName(member.name),
            }),
    };
  })
);

type DayHead = (typeof days.value)[number];
/**
 * The board's grid as ONE flat list, so both layouts draw their cells, heads and totals with the
 * same markup: `single` is seven heads then seven cells; the board is the days across the top,
 * then a row per bean ending in its total.
 */
type GridItem =
  | { kind: 'blank'; key: string }
  | { kind: 'day'; key: string; day: DayHead }
  | { kind: 'star'; key: string }
  | { kind: 'bean'; key: string; member: FamilyMember }
  | { kind: 'cell'; key: string; member: FamilyMember; record: ChoreDayRecord }
  | { kind: 'total'; key: string; member: FamilyMember; total: WeekTotal | undefined }
  | { kind: 'extraHead'; key: string; text: string }
  | {
      kind: 'extras';
      key: string;
      member: FamilyMember;
      facts: WeekPanelFact[];
      note: WeekPanelNote | null;
    };

const cellItem = (member: FamilyMember, record: ChoreDayRecord): GridItem => ({
  kind: 'cell',
  key: `${member.id}-${record.ymd}`,
  member,
  record,
});
const totalItem = (member: FamilyMember, total: WeekTotal | undefined): GridItem => ({
  kind: 'total',
  key: `t-${member.id}`,
  member,
  total,
});

const gridItems = computed<GridItem[]>(() => {
  const heads = days.value.map((day): GridItem => ({ kind: 'day', key: `h-${day.ymd}`, day }));
  if (props.single) {
    const row = props.rows[0];
    return row ? [...heads, ...row.week.days.map((r) => cellItem(row.member, r))] : [];
  }
  const extra = extraHeads.value.length > 0;
  return [
    { kind: 'blank', key: 'corner' },
    ...heads,
    { kind: 'star', key: 'star' },
    ...extraHeads.value.map((text, i): GridItem => ({ kind: 'extraHead', key: `x-${i}`, text })),
    ...props.rows.flatMap((r, i): GridItem[] => [
      { kind: 'bean', key: `b-${r.member.id}`, member: r.member },
      ...r.week.days.map((rec) => cellItem(r.member, rec)),
      totalItem(r.member, totals.value[i]),
      ...(extra ? [extrasItem(r.member)] : []),
    ]),
  ];
});

function extrasItem(member: FamilyMember): GridItem {
  const entry = props.extras?.rows[member.id];
  return {
    kind: 'extras',
    key: `x-${member.id}`,
    member,
    facts: Array.isArray(entry) ? entry : [],
    note: entry && !Array.isArray(entry) ? entry : null,
  };
}

const FACT_TONE: Record<NonNullable<WeekPanelFact['tone']> | 'plain', string> = {
  strong: 'font-outfit text-secondary-500 dark:text-ink text-base font-extrabold tabular-nums',
  good: 'dark:text-success-lift text-sm font-semibold text-green-700',
  done: 'dark:text-success-lift inline-flex items-center gap-1 rounded-full bg-[var(--tint-success-10)] px-2 py-0.5 text-xs font-bold text-green-700',
  quiet: 'dark:text-ink-faint text-secondary-400 text-sm',
  plain: 'dark:text-ink text-secondary-500 text-sm',
};

// ── The day summary ─────────────────────────────────────────────────────────

/** Which cell's summary is open. The record is looked up live, so a tick while open shows. */
const openCell = ref<{ memberId: string; ymd: string; anchor: HTMLElement } | null>(null);

const openRow = computed(() =>
  openCell.value ? props.rows.find((r) => r.member.id === openCell.value!.memberId) : undefined
);
const openRecord = computed<ChoreDayRecord | null>(
  () => openRow.value?.week.days.find((d) => d.ymd === openCell.value?.ymd) ?? null
);

const isExpanded = (memberId: string, ymd: string) =>
  openCell.value?.memberId === memberId && openCell.value.ymd === ymd;

async function onOpen(memberId: string, record: ChoreDayRecord, anchor: HTMLElement) {
  if (record.ymd > props.todayYmd) return;
  if (isExpanded(memberId, record.ymd)) {
    openCell.value = null;
    return;
  }
  // Switching cells: let the first close (and hand focus back) before the next one opens, so
  // focus returns to the cell that opened the summary now showing.
  if (openCell.value) {
    openCell.value = null;
    await nextTick();
  }
  anchor.focus({ preventScroll: true });
  openCell.value = { memberId, ymd: record.ymd, anchor };
  logEvent({
    level: 'info',
    surface: 'choreboard',
    message: 'day-popover-opened',
    context: {
      kind: record.ymd === props.todayYmd ? 'today' : 'past',
      count: record.done,
      detail: props.single ? 'day' : 'home',
    },
  });
}

function closePopover(): void {
  openCell.value = null;
}
// Another week's cells: the summary open on this one has nothing to point at.
watch(() => props.week, closePopover);

function onFactAction(memberId: string, id: string, event: MouseEvent): void {
  emit('fact-action', { memberId, id, anchor: event.currentTarget as HTMLElement });
}

function onOpenDay(): void {
  const id = openCell.value?.memberId;
  openCell.value = null;
  if (id) emit('open-day', id);
}
</script>

<template>
  <section
    class="chore-board dark:bg-surface-raised dark:border-line rounded-3xl bg-white px-4 pt-3.5 pb-3 shadow-[var(--card-shadow)] dark:border"
    :data-testid="single ? 'chore-week-row' : 'chore-week-panel'"
    :data-week="weeks ? week : undefined"
    :data-looking-back="lookingBack ? 'true' : undefined"
  >
    <div class="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h2 class="font-outfit dark:text-ink text-secondary-500 text-base font-bold">
        {{ t('choreboard.week.panelTitle') }}
      </h2>
      <!-- On home the "This Week" card sits beside the board, so the sub-label is a bean's
           own week only. -->
      <span v-if="single" class="dark:text-ink-faint text-secondary-400 text-xs">{{
        t('choreboard.week.title')
      }}</span>
      <span class="flex-1" />
      <template v-if="single">
        <span
          v-if="totals[0] && totals[0].done > 0"
          class="font-outfit text-primary-700 dark:text-accent-lift flex items-baseline gap-1.5 text-sm font-extrabold"
          :aria-label="totals[0].aria"
          data-testid="chore-week-total"
        >
          <span aria-hidden="true"> ⭐ {{ totals[0].count }} </span>
          <span
            class="font-inter dark:text-ink-soft text-secondary-400 text-xs font-medium"
            aria-hidden="true"
            >{{ totals[0].percent }}</span
          >
        </span>
        <span
          v-else
          class="dark:text-ink-faint text-secondary-400 text-xs"
          data-testid="chore-week-total"
          >{{ t('choreboard.week.noneYet') }}</span
        >
      </template>
      <span v-else class="dark:text-ink-faint text-secondary-400 text-xs">{{
        t('choreboard.week.panelHint')
      }}</span>
      <ChoreWeekStepper
        v-if="showStepper"
        class="self-center"
        :weeks="weeks!"
        :model-value="week ?? ''"
        :today-ymd="todayYmd"
        @update:model-value="emit('update:week', $event)"
      />
    </div>
    <p
      v-if="lookingBack"
      class="text-secondary-500 dark:text-silk-lift mb-2.5 flex items-center gap-2 rounded-2xl bg-[var(--tint-silk-20)] px-3 py-2 text-sm font-semibold"
      data-testid="chore-lookback-notice"
    >
      <span aria-hidden="true">👀</span>{{ t('choreStars.lookback.notice') }}
    </p>

    <!-- ONE grid for both layouts (see `gridItems`). -->
    <div
      class="board-grid grid items-center gap-[5px]"
      :class="[
        single ? 'grid-cols-7' : 'board-grid-across',
        extraHeads.length ? 'board-grid-extras' : '',
      ]"
      :style="extraHeads.length ? { '--board-extras': extraHeads.length } : undefined"
    >
      <template v-for="item in gridItems" :key="item.key">
        <span v-if="item.kind === 'blank'" />
        <span
          v-else-if="item.kind === 'day'"
          class="font-outfit text-center text-xs font-semibold"
          :class="[
            item.day.isToday
              ? 'text-primary-700 dark:text-accent-lift font-bold'
              : 'dark:text-ink-faint text-secondary-400',
          ]"
          aria-hidden="true"
          >{{ item.day.short }}</span
        >
        <span
          v-else-if="item.kind === 'star'"
          class="dark:text-ink-faint text-secondary-400 text-center text-xs font-semibold"
          aria-hidden="true"
          >⭐</span
        >
        <div
          v-else-if="item.kind === 'bean'"
          class="font-outfit dark:text-ink text-secondary-500 flex min-w-0 items-center gap-1.5 pr-1 text-sm font-semibold"
          aria-hidden="true"
        >
          <BeanieAvatar class="flex-none" v-bind="memberAvatarBindings(item.member)" size="xs" />
          <span class="board-name min-w-0 truncate">{{ firstName(item.member.name) }}</span>
        </div>
        <ChoreDayCell
          v-else-if="item.kind === 'cell'"
          :record="item.record"
          :name="firstName(item.member.name)"
          :weekday="weekdayOf(item.record.ymd)"
          :today-ymd="todayYmd"
          :shape="cellShape"
          :expanded="isExpanded(item.member.id, item.record.ymd)"
          :data-member-id="item.member.id"
          @open="onOpen(item.member.id, item.record, $event)"
        />
        <span
          v-else-if="item.kind === 'extraHead'"
          class="board-extra-head font-outfit dark:text-ink-faint text-secondary-400 px-1 text-center text-xs font-semibold whitespace-nowrap"
          aria-hidden="true"
          >{{ item.text }}</span
        >
        <div
          v-else-if="item.kind === 'extras'"
          class="board-extras"
          data-testid="chore-week-panel-extras"
          :data-member-id="item.member.id"
        >
          <span
            v-if="item.note"
            class="board-extra board-extra-note"
            data-testid="chore-week-panel-note"
          >
            <span class="sr-only">{{ firstName(item.member.name) }}: </span>
            <span class="font-outfit dark:text-ink-soft text-secondary-500 text-sm font-semibold">{{
              item.note.note
            }}</span>
            <span
              v-if="item.note.hint"
              class="dark:text-ink-faint text-secondary-400 block text-xs leading-snug"
              >{{ item.note.hint }}</span
            >
          </span>
          <span
            v-for="(fact, i) in item.facts"
            :key="i"
            class="board-extra"
            :data-testid="fact.testid"
          >
            <span class="board-extra-label dark:text-ink-faint text-secondary-400 text-xs"
              ><span v-if="i === 0" class="sr-only">{{ firstName(item.member.name) }}: </span
              >{{ extraHeads[i] }}</span
            >
            <button
              v-if="fact.action"
              type="button"
              class="focus-visible:outline-sky-silk-300 dark:bg-surface-overlay dark:hover:bg-surface-hover -my-1 rounded-xl bg-[var(--tint-slate-5)] px-2.5 py-1 hover:bg-[var(--tint-slate-10)] focus-visible:outline-2 focus-visible:outline-offset-2"
              :class="[
                FACT_TONE[fact.tone ?? 'plain'],
                fact.action.expanded ? 'ring-sky-silk-300 ring-[3px]' : '',
              ]"
              :aria-label="fact.action.label"
              aria-haspopup="dialog"
              :aria-expanded="fact.action.expanded ? 'true' : 'false'"
              data-testid="chore-week-panel-fact-action"
              @click="onFactAction(item.member.id, fact.action.id, $event)"
            >
              {{ fact.text }}
            </button>
            <span v-else :class="FACT_TONE[fact.tone ?? 'plain']">{{ fact.text }}</span>
            <span v-if="fact.sub" class="dark:text-ink-soft text-secondary-400 text-xs">{{
              fact.sub
            }}</span>
          </span>
        </div>
        <span
          v-else
          class="board-total font-outfit text-primary-700 dark:text-accent-lift flex items-baseline justify-center gap-x-1.5 text-sm font-extrabold whitespace-nowrap"
          :aria-label="item.total?.aria"
          data-testid="chore-week-panel-total"
          :data-member-id="item.member.id"
        >
          <template v-if="item.total && item.total.done > 0">
            <span aria-hidden="true"> ⭐ {{ item.total.count }} </span>
            <span
              class="font-inter dark:text-ink-soft text-secondary-400 text-xs font-medium"
              aria-hidden="true"
              >{{ item.total.percent }}</span
            >
          </template>
          <span
            v-else
            class="block h-[7px] w-[7px] rounded-full bg-[var(--color-border-strong)]"
            aria-hidden="true"
          />
        </span>
      </template>
    </div>
    <p v-if="single" class="dark:text-ink-faint text-secondary-400 mt-2 text-xs">
      {{ t('choreboard.week.panelHint') }}
    </p>

    <ChoreDayPopover
      :open="!!openCell"
      :member="openRow?.member ?? null"
      :record="openRecord"
      :name="openRow ? firstName(openRow.member.name) : ''"
      :weekday="openCell ? weekdayOf(openCell.ymd) : ''"
      :is-today="openCell?.ymd === todayYmd"
      :anchor="openCell?.anchor ?? null"
      :open-day-action="openDayAction"
      @close="closePopover"
      @open-day="onOpenDay"
    />
  </section>
</template>

<style scoped>
.chore-board {
  container: chore-board / inline-size;
}

/* Each day column grows with the card up to a cap (6.5rem), so the board fills its two grid
   columns on home without the cells turning into slabs; past the cap the grid is centred. */
.board-grid-across {
  --chore-cell-max: 6.5rem;

  grid-template-columns: minmax(2rem, max-content) repeat(7, minmax(0, 6.5rem)) minmax(
      2.25rem,
      max-content
    );
  justify-content: center;
}

/* The optional trailing facts (`extras`): one more column each after the total. Each bean's
   facts are one wrapper that is invisible to the grid here (`display: contents`); the labels
   are for screen readers only, the heads say it. */
.board-grid-extras {
  grid-template-columns:
    minmax(2rem, max-content) repeat(7, minmax(0, 6.5rem)) minmax(2.25rem, max-content)
    repeat(var(--board-extras), max-content);
}

.board-extras {
  display: contents;
}

.board-extra {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.375rem;
  justify-content: center;
  padding-inline: 0.375rem;
  white-space: nowrap;
}

/* A note spans every fact column without widening them (`width: 0` + `min-width: 100%`). */
.board-extra-note {
  display: block;
  grid-column: span var(--board-extras);
  min-width: 100%;
  white-space: normal;
  width: 0;
}

.board-extra-label {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

/* Under 48rem of board the facts leave the columns: a labelled line under the bean's cells. */
@container chore-board (max-width: 48rem) {
  .board-grid-extras {
    grid-template-columns: minmax(2rem, max-content) repeat(7, minmax(0, 6.5rem)) minmax(
        2.25rem,
        max-content
      );
  }

  .board-extra-head {
    display: none;
  }

  .board-extras {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    grid-column: 2 / -1;
    padding-bottom: 0.375rem;
  }

  .board-extra {
    justify-content: flex-start;
    padding-inline: 0;
  }

  .board-extra-note {
    width: auto;
  }

  .board-extra-label {
    clip-path: none;
    height: auto;
    overflow: visible;
    position: static;
    width: auto;
  }
}

/* A narrow board (a phone): the names fold to avatars (each cell's label still names the bean). */
@container chore-board (max-width: 30rem) {
  .board-grid-across {
    gap: 4px;
    grid-template-columns: 1.75rem repeat(7, minmax(0, 1fr)) minmax(1.75rem, max-content);
  }

  .board-name {
    display: none;
  }

  /* The count over its percentage: side by side they squeeze the seven day cells. */
  .board-total {
    align-items: center;
    flex-direction: column;
    font-size: 0.75rem;
  }
}
</style>
