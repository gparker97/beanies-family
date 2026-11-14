<script setup lang="ts">
/**
 * "Chores Done" (#146): the week as squarish day cells (`ChoreDayCell`), Monday to Sunday (the
 * family's week start), with each bean's week total and a small legend. Tapping a past day or
 * today opens that day's read-only summary (`ChoreDayPopover`); days still to come do nothing.
 *
 * Every number is a `choreDayRecord` from `choreStore.weekFor` (rows), and the popover is handed
 * the very record its cell counted, so a cell and its summary always agree.
 *
 * Three shapes, one component:
 *  - the grown-ups' board, days ACROSS (beans down): the stacked layout and the phone. Under
 *    30rem of board (`container-name: chore-board`) the names fold to avatars and the cells
 *    turn square;
 *  - the grown-ups' board, days DOWN (beans across): the desktop right rail (`orientation`);
 *  - one bean's own week (`single`): seven across, the total in the header, the hint under it,
 *    no legend. It replaces the old "This week" row on a bean's day.
 * The board itself is grown-ups only (the page decides); a child sees only their own week.
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
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';
import { choreDayOfWeek, type ChoreDayRecord, type ChoreWeekRecord } from '@/utils/chores';
import { firstName } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiDate } from '@/utils/uiLocale';
import type { FamilyMember } from '@/types/models';

const props = withDefaults(
  defineProps<{
    rows: { member: FamilyMember; week: ChoreWeekRecord }[];
    todayYmd: string;
    /** One bean's own week (their day page). */
    single?: boolean;
    /** The grown-ups' board: days across (default) or days down (the desktop rail). */
    orientation?: 'across' | 'down';
    /** Offer "Open {Name}'s Day" on today's summary (home only). */
    openDayAction?: boolean;
  }>(),
  { single: false, orientation: 'across', openDayAction: false }
);

const emit = defineEmits<{ 'open-day': [memberId: string] }>();

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

const isDown = computed(() => !props.single && props.orientation === 'down');
const cellShape = computed(() => (props.single ? 'square' : isDown.value ? 'tall' : 'wide'));

const totalAria = (n: number) =>
  fillTemplate(t(n === 1 ? 'choreboard.week.totalAria.one' : 'choreboard.week.totalAria.other'), {
    count: n,
  });
const totalAriaFor = (m: FamilyMember, n: number) =>
  fillTemplate(
    t(n === 1 ? 'choreboard.week.totalAriaFor.one' : 'choreboard.week.totalAriaFor.other'),
    { name: firstName(m.name), count: n }
  );

type DayHead = (typeof days.value)[number];
/**
 * The board's grid as ONE flat list, so every layout draws its cells, heads and totals with the
 * same markup: `single` is seven heads then seven cells; days DOWN is the beans across the top,
 * a row per day, then the totals; days ACROSS is the days across the top, then a row per bean
 * ending in its total.
 */
type GridItem =
  | { kind: 'blank'; key: string }
  | { kind: 'day'; key: string; day: DayHead; left: boolean }
  | { kind: 'star'; key: string; left: boolean }
  | { kind: 'bean'; key: string; member: FamilyMember; column: boolean }
  | { kind: 'cell'; key: string; member: FamilyMember; record: ChoreDayRecord }
  | { kind: 'total'; key: string; member: FamilyMember; total: number };

const cellItem = (member: FamilyMember, record: ChoreDayRecord): GridItem => ({
  kind: 'cell',
  key: `${member.id}-${record.ymd}`,
  member,
  record,
});
const totalItem = (member: FamilyMember, total: number): GridItem => ({
  kind: 'total',
  key: `t-${member.id}`,
  member,
  total,
});

const gridItems = computed<GridItem[]>(() => {
  const heads = (left: boolean): GridItem[] =>
    days.value.map((day) => ({ kind: 'day', key: `h-${day.ymd}`, day, left }));
  if (props.single) {
    const row = props.rows[0];
    return row ? [...heads(false), ...row.week.days.map((r) => cellItem(row.member, r))] : [];
  }
  if (isDown.value) {
    return [
      { kind: 'blank', key: 'corner' },
      ...props.rows.map((r): GridItem => ({
        kind: 'bean',
        key: `b-${r.member.id}`,
        member: r.member,
        column: true,
      })),
      ...days.value.flatMap((day, di): GridItem[] => [
        { kind: 'day', key: `h-${day.ymd}`, day, left: true },
        ...props.rows.map((r) => cellItem(r.member, r.week.days[di]!)),
      ]),
      { kind: 'star', key: 'star', left: true },
      ...props.rows.map((r) => totalItem(r.member, r.week.total)),
    ];
  }
  return [
    { kind: 'blank', key: 'corner' },
    ...heads(false),
    { kind: 'star', key: 'star', left: false },
    ...props.rows.flatMap((r): GridItem[] => [
      { kind: 'bean', key: `b-${r.member.id}`, member: r.member, column: false },
      ...r.week.days.map((rec) => cellItem(r.member, rec)),
      totalItem(r.member, r.week.total),
    ]),
  ];
});

/** A past day (or today) with nothing due somewhere on the board: the legend explains it. */
const hasFreeDay = computed(() =>
  props.rows.some((r) => r.week.days.some((d) => d.ymd <= props.todayYmd && d.total === 0))
);

/** Days down: each bean column is capped (5.5rem) and the grid centred, so one or two beans
 *  read as a deliberate column rather than stretched slabs. */
const downColumns = computed(() => `2.5rem repeat(${props.rows.length}, minmax(0, 5.5rem))`);

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

// The board re-renders its cells when it flips orientation (the 1280px rail): the open summary's
// anchor is gone with them, so close it rather than leave it hanging from a detached cell.
watch(
  () => props.orientation,
  () => closePopover()
);

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
    :data-orientation="single ? 'single' : orientation"
  >
    <div class="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h2 class="font-outfit dark:text-ink text-secondary-500 text-base font-bold">
        {{ t('choreboard.week.panelTitle') }}
      </h2>
      <span class="dark:text-ink-faint text-secondary-400 text-xs">{{
        t('choreboard.week.title')
      }}</span>
      <span class="flex-1" />
      <template v-if="single">
        <span
          v-if="rows[0] && rows[0].week.total > 0"
          class="font-outfit text-primary-700 dark:text-accent-lift text-sm font-extrabold"
          :aria-label="totalAria(rows[0].week.total)"
          data-testid="chore-week-total"
          ><span aria-hidden="true">⭐ {{ rows[0].week.total }}</span></span
        >
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
    </div>

    <!-- ONE grid for all three layouts (see `gridItems`). -->
    <div
      class="board-grid grid items-center gap-[5px]"
      :class="single ? 'grid-cols-7' : isDown ? 'justify-center' : 'board-grid-across'"
      :style="isDown ? { gridTemplateColumns: downColumns } : undefined"
    >
      <template v-for="item in gridItems" :key="item.key">
        <span v-if="item.kind === 'blank'" />
        <span
          v-else-if="item.kind === 'day'"
          class="font-outfit text-xs font-semibold"
          :class="[
            item.left ? 'text-left' : 'text-center',
            item.day.isToday
              ? 'text-primary-700 dark:text-accent-lift font-bold'
              : 'dark:text-ink-faint text-secondary-400',
          ]"
          aria-hidden="true"
          >{{ item.day.short }}</span
        >
        <span
          v-else-if="item.kind === 'star'"
          class="dark:text-ink-faint text-secondary-400 text-xs font-semibold"
          :class="item.left ? 'text-left' : 'text-center'"
          aria-hidden="true"
          >⭐</span
        >
        <div
          v-else-if="item.kind === 'bean'"
          class="font-outfit dark:text-ink text-secondary-500 flex min-w-0 font-semibold"
          :class="
            item.column
              ? 'flex-col items-center gap-0.5 text-xs'
              : 'items-center gap-1.5 pr-1 text-sm'
          "
          aria-hidden="true"
        >
          <BeanieAvatar
            class="flex-none"
            v-bind="memberAvatarBindings(item.member)"
            :size="item.column ? 'sm' : 'xs'"
          />
          <span class="min-w-0 truncate" :class="item.column ? 'max-w-full' : 'board-name'">{{
            firstName(item.member.name)
          }}</span>
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
          v-else
          class="board-total font-outfit text-primary-700 dark:text-accent-lift flex justify-center text-sm font-extrabold whitespace-nowrap"
          :aria-label="totalAriaFor(item.member, item.total)"
          data-testid="chore-week-panel-total"
          :data-member-id="item.member.id"
        >
          <span v-if="item.total > 0" aria-hidden="true">⭐ {{ item.total }}</span>
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

    <!-- The legend: the grown-ups' board only. The cells' own labels say all of this. -->
    <div
      v-if="!single"
      class="dark:text-ink-faint text-secondary-400 mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs"
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

    <ChoreDayPopover
      :open="!!openCell"
      :member="openRow?.member ?? null"
      :record="openRecord"
      :name="openRow ? firstName(openRow.member.name) : ''"
      :weekday="openCell ? weekdayOf(openCell.ymd) : ''"
      :is-today="openCell?.ymd === todayYmd"
      :anchor="openCell?.anchor ?? null"
      :side="isDown ? 'start' : 'below'"
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

.board-grid-across {
  grid-template-columns: minmax(2rem, max-content) repeat(7, minmax(0, 1fr)) minmax(
      2.25rem,
      max-content
    );
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

  .board-total {
    font-size: 0.75rem;
  }
}
</style>
