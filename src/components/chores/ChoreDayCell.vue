<script setup lang="ts">
/**
 * One day of one bean on the Chores Done board (#146), shared by the grown-ups' board and a
 * bean's own week. Its number is the day record's (`choreDayRecord`), the same record the day
 * summary behind it lists, so the two always agree:
 *
 *  - done:    the count large, "of 11" under it, on a Heritage Orange fill that strengthens in
 *             four steps with the share done (`--chore-heat-1..4`);
 *  - perfect: every chore done, the strongest fill and a star badge;
 *  - empty:   a past day (or today) with nothing done, a dashed cell with a soft dot, never "0";
 *  - future:  a blank outline, not interactive (a span, labelled for screen readers).
 * Today carries the Heritage Orange ring. Every past day and today is a real button that asks
 * the board to open the day summary (`open`, with the cell as the anchor).
 *
 * Size follows the board (`container-name: chore-board`): under 30rem the cell turns square,
 * the number steps down and "of 11" goes, so seven days fit a phone. `shape` sets the aspect
 * ratio for where it sits: `wide` (days across), `tall` (days down, the rail), `square` (a
 * bean's own week).
 *
 * Dark mode: the fills and lines are tokens that switch with the theme; the number is `ink`
 * (6.1:1 on the strongest dark step over surface-raised).
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreDayRecord } from '@/utils/chores';

const props = withDefaults(
  defineProps<{
    record: ChoreDayRecord;
    /** The bean's name and the full weekday, for the cell's label. */
    name: string;
    weekday: string;
    todayYmd: string;
    shape?: 'wide' | 'tall' | 'square';
    /** This cell's day summary is open. */
    expanded?: boolean;
  }>(),
  { shape: 'wide', expanded: false }
);

const emit = defineEmits<{ open: [anchor: HTMLElement] }>();

const { t } = useTranslation();

const isToday = computed(() => props.record.ymd === props.todayYmd);
const isFuture = computed(() => props.record.ymd > props.todayYmd);
const isPerfect = computed(
  () => props.record.total > 0 && props.record.done === props.record.total
);

type CellState = 'future' | 'empty' | 'done' | 'perfect';
const state = computed<CellState>(() => {
  if (isFuture.value) return 'future';
  if (props.record.done === 0) return 'empty';
  return isPerfect.value ? 'perfect' : 'done';
});

/** The fill step: 4 for a perfect day, else by the share done (thirds). */
const heatClass = computed(() => {
  const { done, total } = props.record;
  if (state.value === 'perfect') return 'bg-[var(--chore-heat-4)]';
  const share = total ? done / total : 0;
  if (share >= 2 / 3) return 'bg-[var(--chore-heat-3)]';
  if (share >= 1 / 3) return 'bg-[var(--chore-heat-2)]';
  return 'bg-[var(--chore-heat-1)]';
});

const label = computed(() => {
  const base = { name: props.name, day: props.weekday };
  if (state.value === 'future') return fillTemplate(t('choreboard.cell.future'), base);
  if (state.value === 'empty') {
    return fillTemplate(
      t(isToday.value ? 'choreboard.cell.noneYet' : 'choreboard.cell.none'),
      base
    );
  }
  return fillTemplate(t('choreboard.cell.done'), {
    ...base,
    done: props.record.done,
    total: props.record.total,
  });
});

function onClick(event: MouseEvent): void {
  emit('open', event.currentTarget as HTMLElement);
}
</script>

<template>
  <span
    v-if="state === 'future'"
    role="img"
    :aria-label="label"
    class="day-cell border-[1.5px] border-[var(--color-border)]"
    :class="isToday ? 'ring-primary-500 ring-2' : ''"
    data-testid="chore-day-cell"
    :data-ymd="record.ymd"
    data-state="future"
    :data-shape="shape"
  />
  <button
    v-else
    type="button"
    class="day-cell font-outfit dark:text-ink text-secondary-500 focus-visible:outline-sky-silk-300 transition-[filter] duration-150 hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none dark:hover:brightness-[1.12]"
    :class="[
      state === 'empty' ? 'border-[1.5px] border-dashed border-[var(--color-border)]' : heatClass,
      expanded ? 'ring-sky-silk-300 ring-[3px]' : isToday ? 'ring-primary-500 ring-2' : '',
    ]"
    :aria-label="label"
    aria-haspopup="dialog"
    :aria-expanded="expanded ? 'true' : 'false'"
    :aria-current="isToday ? 'date' : undefined"
    data-testid="chore-day-cell"
    :data-ymd="record.ymd"
    :data-state="state"
    :data-today="isToday ? 'true' : undefined"
    :data-shape="shape"
    @click="onClick"
  >
    <span
      v-if="state === 'empty'"
      class="block h-[7px] w-[7px] rounded-full bg-[var(--color-border-strong)]"
      aria-hidden="true"
    />
    <template v-else>
      <b class="day-cell-num text-xl leading-none font-extrabold" aria-hidden="true">{{
        record.done
      }}</b>
      <small class="day-cell-of font-inter mt-[3px] text-xs leading-none" aria-hidden="true">{{
        fillTemplate(t('choreboard.cell.of'), { total: record.total })
      }}</small>
      <span
        v-if="state === 'perfect'"
        class="day-cell-badge absolute -top-1.5 -right-1 text-sm leading-none drop-shadow-sm"
        aria-hidden="true"
        >⭐</span
      >
    </template>
  </button>
</template>

<style scoped>
.day-cell {
  align-items: center;
  aspect-ratio: 1.2 / 1;
  border-radius: 0.875rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 2rem;
  min-width: 0;
  position: relative;
  text-align: center;
}

.day-cell[data-shape='tall'] {
  aspect-ratio: 1.55 / 1;
}

.day-cell[data-shape='square'] {
  aspect-ratio: 1 / 1;
}

/* A narrow board (a phone, the rail): square-ish, a smaller number, no "of 11". */
@container chore-board (max-width: 30rem) {
  .day-cell {
    border-radius: 0.625rem;
  }

  .day-cell[data-shape='wide'] {
    aspect-ratio: 1 / 1;
  }

  .day-cell-num {
    font-size: 0.875rem;
  }

  .day-cell-of {
    display: none;
  }

  .day-cell-badge {
    font-size: 0.75rem;
    right: -0.2rem;
    top: -0.3rem;
  }
}
</style>
