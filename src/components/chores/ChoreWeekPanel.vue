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
import { computed, nextTick, ref } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ChoreDayCell from '@/components/chores/ChoreDayCell.vue';
import ChoreDayPopover from '@/components/chores/ChoreDayPopover.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';
import { choreDayOfWeek, type ChoreDayRecord, type ChoreWeekRecord } from '@/utils/chores';
import { firstName as firstWord } from '@/utils/assignees';
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

const firstName = (m: FamilyMember) => firstWord(m.name) || m.name;

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

    <!-- ═══ One bean's own week: seven across ═══ -->
    <template v-if="single && rows[0]">
      <div class="grid grid-cols-7 items-center gap-[5px]">
        <span
          v-for="d in days"
          :key="`h-${d.ymd}`"
          class="font-outfit text-center text-xs font-semibold"
          :class="
            d.isToday
              ? 'text-primary-700 dark:text-accent-lift font-bold'
              : 'dark:text-ink-faint text-secondary-400'
          "
          aria-hidden="true"
          >{{ d.short }}</span
        >
        <ChoreDayCell
          v-for="rec in rows[0].week.days"
          :key="rec.ymd"
          :record="rec"
          :name="firstName(rows[0].member)"
          :weekday="weekdayOf(rec.ymd)"
          :today-ymd="todayYmd"
          :shape="cellShape"
          :expanded="isExpanded(rows[0].member.id, rec.ymd)"
          :data-member-id="rows[0].member.id"
          @open="onOpen(rows[0].member.id, rec, $event)"
        />
      </div>
      <p class="dark:text-ink-faint text-secondary-400 mt-2 text-xs">
        {{ t('choreboard.week.panelHint') }}
      </p>
    </template>

    <!-- ═══ Days down, beans across (the desktop rail) ═══ -->
    <div
      v-else-if="isDown"
      class="board-grid grid items-center gap-[5px]"
      :style="{ gridTemplateColumns: `2.5rem repeat(${rows.length}, minmax(0, 1fr))` }"
    >
      <span />
      <div
        v-for="row in rows"
        :key="`c-${row.member.id}`"
        class="font-outfit dark:text-ink text-secondary-500 flex min-w-0 flex-col items-center gap-0.5 text-xs font-semibold"
        aria-hidden="true"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(row.member)" size="sm" />
        <span class="max-w-full truncate">{{ firstName(row.member) }}</span>
      </div>
      <template v-for="(d, di) in days" :key="d.ymd">
        <span
          class="font-outfit text-left text-xs font-semibold"
          :class="
            d.isToday
              ? 'text-primary-700 dark:text-accent-lift font-bold'
              : 'dark:text-ink-faint text-secondary-400'
          "
          aria-hidden="true"
          >{{ d.short }}</span
        >
        <ChoreDayCell
          v-for="row in rows"
          :key="`${row.member.id}-${d.ymd}`"
          :record="row.week.days[di]!"
          :name="firstName(row.member)"
          :weekday="d.long"
          :today-ymd="todayYmd"
          :shape="cellShape"
          :expanded="isExpanded(row.member.id, d.ymd)"
          :data-member-id="row.member.id"
          @open="onOpen(row.member.id, row.week.days[di]!, $event)"
        />
      </template>
      <span
        class="dark:text-ink-faint text-secondary-400 text-left text-xs font-semibold"
        aria-hidden="true"
        >⭐</span
      >
      <span
        v-for="row in rows"
        :key="`t-${row.member.id}`"
        class="font-outfit text-primary-700 dark:text-accent-lift flex justify-center text-sm font-extrabold whitespace-nowrap"
        :aria-label="`${firstName(row.member)}: ${totalAria(row.week.total)}`"
        data-testid="chore-week-panel-total"
        :data-member-id="row.member.id"
      >
        <span v-if="row.week.total > 0" aria-hidden="true">⭐ {{ row.week.total }}</span>
        <span
          v-else
          class="block h-[7px] w-[7px] rounded-full bg-[var(--color-border-strong)]"
          aria-hidden="true"
        />
      </span>
    </div>

    <!-- ═══ Days across, beans down (stacked, phone) ═══ -->
    <div v-else class="board-grid board-grid-across grid items-center gap-[5px]">
      <span />
      <span
        v-for="d in days"
        :key="`h-${d.ymd}`"
        class="font-outfit text-center text-xs font-semibold"
        :class="
          d.isToday
            ? 'text-primary-700 dark:text-accent-lift font-bold'
            : 'dark:text-ink-faint text-secondary-400'
        "
        aria-hidden="true"
        >{{ d.short }}</span
      >
      <span class="dark:text-ink-faint text-secondary-400 text-center text-xs" aria-hidden="true"
        >⭐</span
      >
      <template v-for="row in rows" :key="row.member.id">
        <div
          class="font-outfit dark:text-ink text-secondary-500 flex min-w-0 items-center gap-1.5 pr-1 text-sm font-semibold"
          aria-hidden="true"
        >
          <BeanieAvatar class="flex-none" v-bind="memberAvatarBindings(row.member)" size="xs" />
          <span class="board-name min-w-0 truncate">{{ firstName(row.member) }}</span>
        </div>
        <ChoreDayCell
          v-for="rec in row.week.days"
          :key="rec.ymd"
          :record="rec"
          :name="firstName(row.member)"
          :weekday="weekdayOf(rec.ymd)"
          :today-ymd="todayYmd"
          :shape="cellShape"
          :expanded="isExpanded(row.member.id, rec.ymd)"
          :data-member-id="row.member.id"
          @open="onOpen(row.member.id, rec, $event)"
        />
        <span
          class="board-total font-outfit text-primary-700 dark:text-accent-lift flex justify-center text-sm font-extrabold whitespace-nowrap"
          :aria-label="`${firstName(row.member)}: ${totalAria(row.week.total)}`"
          data-testid="chore-week-panel-total"
          :data-member-id="row.member.id"
        >
          <span v-if="row.week.total > 0" aria-hidden="true">⭐ {{ row.week.total }}</span>
          <span
            v-else
            class="block h-[7px] w-[7px] rounded-full bg-[var(--color-border-strong)]"
            aria-hidden="true"
          />
        </span>
      </template>
    </div>

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
    </div>

    <ChoreDayPopover
      :open="!!openCell"
      :member="openRow?.member ?? null"
      :record="openRecord"
      :name="openRow ? firstName(openRow.member) : ''"
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
