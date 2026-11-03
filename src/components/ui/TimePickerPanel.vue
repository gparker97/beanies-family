<script setup lang="ts">
/**
 * The inside of the time picker: every row, chip and link, and no idea where it is shown.
 * `TimePickerHost` decides sheet or popover; `BeanieTimePicker` and `BeanieTimeRange` decide
 * which rows appear by which props they pass.
 *
 * NO MODE SWITCH. Every row renders on prop presence, top to bottom:
 *  - `backLabel` → a "‹ Start 4:15pm" link (emits `back`);
 *  - `durationsFrom` (a valid time) → Lasts: six duration chips, each "until" its end;
 *  - `recent` (non-empty) → Recent: up to four times;
 *  - hour rows Morning (6 to 11), Afternoon (12 to 5), Evening (6 to 11), plus Night (12 to 5 AM)
 *    when the shown hour is before 6 AM or "Night hours" was tapped;
 *  - minute chips :00 :15 :30 :45, or twelve 5-minute chips after "5-minute steps"; a value off
 *    the shown grid (10:52 after typing) adds one extra, selected chip;
 *  - the type box, with a live "Enter sets 4:15pm" preview;
 *  - the footer: Night hours, 5-minute steps, Clear (`clearable` and a value set), All day
 *    (`allDayAffordance`) and Done.
 * The range re-keys this component per step, so the private state below (lit hour, Night,
 * 5-minute steps, typed text, rejected hint) resets on advance and back with no reset code, and
 * the host's `v-if` resets it on every open.
 *
 * PICKS AND WRITES. Taps build a draft inside the panel; nothing reaches a v-model until a
 * write, so inline editors that save on every update are never handed half a time.
 *  - An hour tap is always panel state (it emits NOTHING).
 *  - Without `holdPicks` (a single field), a minute, recent time or Enter on a typed time
 *    FINISHES: `commit(value, via)`. The minute uses the tapped hour, else the value's hour,
 *    else a fallback (the hour after `durationsFrom`, or 9).
 *  - With `holdPicks` (the range), those taps only update the draft and the footer writes:
 *    `next(value | null)` (the `nextLabel` button) or `done(value | null)`.
 *  - Done / next carry a typed time that parses, else the draft, else `null`; a value equal to
 *    the current one is `null` (nothing to write). Clear emits `clear`, All day `all-day`.
 *  - Closing any other way (outside click, the dim, Escape) is the host's and discards the
 *    draft: dismissing cancels.
 *
 * COLORS. Heritage Orange (`picked`) means the person tapped this chip in this panel, nothing
 * else. Sky Silk (`suggested`) means "what Done would keep": the current value's hour and
 * minute on open, the minute that goes with a tapped hour, the hour and minute that follow
 * from a tapped recent time, duration or typed time, and the duration whose length matches
 * the current end. Recent chips are never suggested (they are shortcuts, not the value).
 *
 * Nothing is ever disabled. A `value` that is not `HH:mm` renders as no value.
 *
 * Telemetry (surface `time-picker`, keys `action` + `kind` only, both allowlisted):
 *  - `debug` `time_set`, kind `minute | recent | duration | typed | done | clear`, on every
 *    write: the success-path counter;
 *  - `debug` `typed_rejected` on Enter with a typed string that does not parse (never the text);
 *  - `warn` `bad_value` on mount and on each change to a malformed `value`, so the upstream bug
 *    shows in CloudWatch instead of as a blank grid (`logEvent` rate-limits per surface).
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import type { UIStringKey } from '@/services/translation/uiStrings';
import {
  addMinutesToTime,
  formatTime12,
  isWallClockTime,
  minutesOfDay,
  parseTypedTime,
  toHHmm,
} from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';

type CommitVia = 'minute' | 'recent' | 'duration' | 'typed';
type PickVia = CommitVia | 'hour';
type ChipState = 'rest' | 'suggested' | 'picked';

const SURFACE = 'time-picker';

/** The end step's "Lasts" chips, in minutes. */
const TIME_PICKER_DURATIONS = [30, 45, 60, 90, 120, 180] as const;
const DURATION_LABEL_KEYS: Record<(typeof TIME_PICKER_DURATIONS)[number], UIStringKey> = {
  30: 'time.duration.30',
  45: 'time.duration.45',
  60: 'time.duration.60',
  90: 'time.duration.90',
  120: 'time.duration.120',
  180: 'time.duration.180',
};

const DAY_ROWS: ReadonlyArray<{ key: UIStringKey; hours: readonly number[] }> = [
  { key: 'time.morning', hours: [6, 7, 8, 9, 10, 11] },
  { key: 'time.afternoon', hours: [12, 13, 14, 15, 16, 17] },
  { key: 'time.evening', hours: [18, 19, 20, 21, 22, 23] },
];
const NIGHT_ROW = { key: 'time.night' as UIStringKey, hours: [0, 1, 2, 3, 4, 5] };

const QUARTER_MINUTES = [0, 15, 30, 45];
const FIVE_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** The hour a minute tap uses with no lit hour and no value: the morning, as the old list did. */
const DEFAULT_HOUR = 9;

interface Props {
  value: string;
  /** Recent times (start step only). */
  recent?: string[];
  /** The start time the Lasts chips count from (end step only). */
  durationsFrom?: string;
  /** Text of the link back to the previous step (end step only). */
  backLabel?: string;
  /** Offer Clear in the footer while a value is set. */
  clearable?: boolean;
  /** Offer the All day chip in the footer. */
  allDayAffordance?: boolean;
  /** Focus the type box on mount (the desktop popover; never the phone sheet). */
  autofocusTyped?: boolean;
  /** Keep every pick in the panel until a footer button writes (the range). */
  holdPicks?: boolean;
  /** Label of a primary "next step" button (emits `next`); Done then becomes secondary. */
  nextLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  recent: () => [],
  durationsFrom: undefined,
  backLabel: undefined,
  clearable: false,
  allDayAffordance: false,
  autofocusTyped: false,
  holdPicks: false,
  nextLabel: undefined,
});

const emit = defineEmits<{
  commit: [value: string, via: CommitVia];
  done: [value: string | null];
  next: [value: string | null];
  clear: [];
  'all-day': [];
  back: [];
}>();

const { t } = useTranslation();

// The draft. `pickedHour` / `pickedMinute` are chips the person tapped; `pickedWhole` is a whole
// time from a recent, duration or typed pick (the base a later hour or minute tap edits);
// `pickedRecent` / `pickedDuration` mark which of those chips was tapped, for its orange.
const pickedHour = ref<number | null>(null);
const pickedMinute = ref<number | null>(null);
const pickedWhole = ref('');
const pickedRecent = ref<string | null>(null);
const pickedDuration = ref<number | null>(null);
const lastVia = ref<PickVia | null>(null);
const showNight = ref(false);
const showFine = ref(false);
const typed = ref('');
const rejected = ref(false);
const typedInput = ref<HTMLInputElement | null>(null);
const previewId = useId();

const current = computed(() => (isWallClockTime(props.value) ? props.value : ''));

const hourOf = (v: string) => Number(v.slice(0, 2));
const minuteOf = (v: string) => Number(v.slice(3, 5));

// With no value and no tapped hour, a minute uses a sensible hour: on the end step the hour
// after the start, else the morning default. `addMinutesToTime` caps at 23:59, so for a start
// at 11pm or later this is the start's own hour; the forms' end-before-start clamp covers that.
const fallbackHour = computed(() =>
  props.durationsFrom && isWallClockTime(props.durationsFrom)
    ? hourOf(addMinutesToTime(props.durationsFrom, 60))
    : DEFAULT_HOUR
);

/** The time the panel would write now, or `null` when nothing was picked. */
const draft = computed<string | null>(() => {
  if (pickedHour.value === null && pickedMinute.value === null) return pickedWhole.value || null;
  const base = pickedWhole.value || current.value;
  return toHHmm(
    pickedHour.value ?? (base ? hourOf(base) : fallbackHour.value),
    pickedMinute.value ?? (base ? minuteOf(base) : 0)
  );
});
/** What Done would leave in place: the draft, else the current value (`''` for none). */
const effective = computed(() => draft.value ?? current.value);
const shownHour = computed(
  () => pickedHour.value ?? (effective.value ? hourOf(effective.value) : null)
);

const nightShown = computed(
  () => showNight.value || (shownHour.value !== null && shownHour.value < 6)
);
const hourRows = computed(() => (nightShown.value ? [NIGHT_ROW, ...DAY_ROWS] : DAY_ROWS));

const minuteChips = computed(() => {
  const grid = showFine.value ? FIVE_MINUTES : QUARTER_MINUTES;
  const m = pickedMinute.value ?? (effective.value ? minuteOf(effective.value) : null);
  return m !== null && !grid.includes(m) ? [...grid, m] : grid;
});

const durations = computed(() => {
  const from = props.durationsFrom;
  if (!from || !isWallClockTime(from)) return [];
  const fromMinutes = minutesOfDay(from)!;
  return TIME_PICKER_DURATIONS.map((minutes) => {
    const end = addMinutesToTime(from, minutes);
    return {
      minutes,
      end,
      label: t(DURATION_LABEL_KEYS[minutes]),
      until: fillTemplate(t('time.until'), { time: formatTime12(end) }),
      // Only the exact length lights: past 10:59pm several chips cap to the same 11:59pm.
      state: (pickedDuration.value === minutes
        ? 'picked'
        : pickedDuration.value === null &&
            effective.value === end &&
            minutesOfDay(end)! - fromMinutes === minutes
          ? 'suggested'
          : 'rest') as ChipState,
    };
  });
});

const typedTime = computed(() => parseTypedTime(typed.value));
const previewText = computed(() => {
  if (rejected.value) return t('time.typeHint');
  return typedTime.value
    ? fillTemplate(t('time.enterSets'), { time: formatTime12(typedTime.value) })
    : '';
});

watch(typed, () => {
  rejected.value = false;
});

watch(
  () => props.value,
  (v) => {
    if (v && !isWallClockTime(v)) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'time picker got a malformed value',
        context: { action: 'bad_value' },
      });
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (props.autofocusTyped) nextTick(() => typedInput.value?.focus({ preventScroll: true }));
});

function chipClass(state: ChipState): string {
  const base =
    'font-outfit min-h-10 md:min-h-9 rounded-xl border-2 px-1.5 text-sm font-semibold tabular-nums transition-colors motion-reduce:transition-none';
  if (state === 'picked') {
    return `${base} from-primary-500 to-terracotta-400 border-transparent bg-gradient-to-r text-white`;
  }
  if (state === 'suggested') {
    // A clear Sky Silk tint and border: visible on its own, never mistaken for a pick.
    return `${base} border-sky-silk-300 bg-sky-silk-300/45 text-[var(--color-text)] dark:border-sky-silk-300 dark:bg-sky-silk-300/20 dark:text-ink`;
  }
  return `${base} dark:bg-surface-overlay dark:text-ink dark:hover:bg-surface-hover border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text)] hover:bg-[var(--tint-slate-10)]`;
}

function hourState(h: number): ChipState {
  if (pickedHour.value === h) return 'picked';
  return pickedHour.value === null && h === shownHour.value ? 'suggested' : 'rest';
}

function minuteState(m: number): ChipState {
  if (pickedMinute.value === m) return 'picked';
  return pickedMinute.value === null && effective.value && m === minuteOf(effective.value)
    ? 'suggested'
    : 'rest';
}

function hourLabel(h: number): string {
  return String(h % 12 || 12);
}

function minuteLabel(m: number): string {
  return `:${String(m).padStart(2, '0')}`;
}

function logTimeSet(kind: PickVia | 'done' | 'clear'): void {
  logEvent({
    level: 'debug',
    surface: SURFACE,
    message: 'time set',
    context: { action: 'time_set', kind },
  });
}

function finish(value: string, via: CommitVia): void {
  logTimeSet(via);
  emit('commit', value, via);
}

function clearMarkers(): void {
  pickedRecent.value = null;
  pickedDuration.value = null;
}

function onHour(h: number): void {
  pickedHour.value = h;
  clearMarkers();
  lastVia.value = 'hour';
}

function onMinute(m: number): void {
  if (!props.holdPicks) {
    const base = pickedWhole.value || current.value;
    finish(toHHmm(pickedHour.value ?? (base ? hourOf(base) : fallbackHour.value), m), 'minute');
    return;
  }
  pickedMinute.value = m;
  clearMarkers();
  lastVia.value = 'minute';
}

/** A recent, duration or typed pick: a whole time. */
function pickWhole(value: string, via: 'recent' | 'duration' | 'typed'): void {
  if (!props.holdPicks) {
    finish(value, via);
    return;
  }
  pickedWhole.value = value;
  pickedHour.value = null;
  pickedMinute.value = null;
  clearMarkers();
  lastVia.value = via;
}

function onRecent(r: string): void {
  pickWhole(r, 'recent');
  if (props.holdPicks) pickedRecent.value = r;
}

function onDuration(minutes: number, end: string): void {
  pickWhole(end, 'duration');
  if (props.holdPicks) pickedDuration.value = minutes;
}

function onTypedEnter(): void {
  if (!typed.value.trim()) return;
  if (typedTime.value) {
    pickWhole(typedTime.value, 'typed');
    if (props.holdPicks) typed.value = '';
    return;
  }
  rejected.value = true;
  logEvent({
    level: 'debug',
    surface: SURFACE,
    message: 'typed time rejected',
    context: { action: 'typed_rejected' },
  });
}

/** What a footer button writes: a typed time that parses, else the draft; never the current value. */
function footerValue(): string | null {
  const value = typedTime.value ?? draft.value;
  if (!value || value === current.value) return null;
  logTimeSet(typedTime.value ? 'typed' : (lastVia.value ?? 'done'));
  return value;
}

function onDone(): void {
  emit('done', footerValue());
}

function onNext(): void {
  emit('next', footerValue());
}

function onClear(): void {
  logTimeSet('clear');
  emit('clear');
}

const captionClass = 'dark:text-ink-faint text-xs text-[var(--color-text-muted)]';
const primaryButtonClass =
  'font-outfit from-primary-500 to-terracotta-400 rounded-full bg-gradient-to-r px-4 py-1.5 text-xs font-bold text-white';
const secondaryButtonClass =
  'font-outfit dark:bg-surface-overlay dark:text-ink dark:hover:bg-surface-hover rounded-full bg-[var(--tint-slate-5)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--tint-slate-10)]';
const linkClass =
  'dark:text-ink-soft text-xs font-medium text-[var(--color-text-muted)] underline underline-offset-2';
</script>

<template>
  <div class="grid gap-3 p-3.5" data-testid="time-picker-panel">
    <button
      v-if="backLabel"
      type="button"
      class="font-outfit text-primary-500 dark:text-accent-lift justify-self-start text-xs font-semibold"
      data-testid="time-picker-back"
      @click="emit('back')"
    >
      <span aria-hidden="true">‹</span>
      {{ backLabel }}
    </button>

    <div v-if="durations.length" class="grid gap-1.5" data-testid="time-picker-durations">
      <span :class="captionClass">{{ t('planner.field.lasts') }}</span>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="d in durations"
          :key="d.minutes"
          type="button"
          :class="[chipClass(d.state), 'grid py-1.5 leading-tight']"
          :aria-pressed="d.state === 'picked'"
          :data-duration="d.minutes"
          :data-state="d.state"
          @click="onDuration(d.minutes, d.end)"
        >
          <span>{{ d.label }}</span>
          <span
            class="font-inter text-xs font-medium"
            :class="
              d.state === 'picked'
                ? 'text-white'
                : 'dark:text-ink-soft text-[var(--color-text-muted)]'
            "
          >
            {{ d.until }}
          </span>
        </button>
      </div>
    </div>

    <div v-if="recent.length" class="grid gap-1.5" data-testid="time-picker-recent">
      <span :class="captionClass">{{ t('time.recent') }}</span>
      <div class="flex flex-wrap gap-1.5">
        <ChipButton
          v-for="r in recent"
          :key="r"
          :label="formatTime12(r)"
          :selected="r === pickedRecent"
          :pressed="r === pickedRecent"
          :data-recent="r"
          @click="onRecent(r)"
        />
      </div>
    </div>

    <div class="grid gap-1.5">
      <div
        v-for="row in hourRows"
        :key="row.key"
        class="grid grid-cols-[4rem_repeat(6,minmax(0,1fr))] items-center gap-1.5"
      >
        <span :class="captionClass">{{ t(row.key) }}</span>
        <button
          v-for="h in row.hours"
          :key="h"
          type="button"
          :class="chipClass(hourState(h))"
          :aria-pressed="hourState(h) === 'picked'"
          :aria-label="formatTime12(toHHmm(h, 0))"
          :data-hour="h"
          :data-state="hourState(h)"
          @click="onHour(h)"
        >
          {{ hourLabel(h) }}
        </button>
      </div>
    </div>

    <div class="grid gap-1.5" :class="showFine ? 'grid-cols-6' : 'grid-cols-4'">
      <button
        v-for="m in minuteChips"
        :key="m"
        type="button"
        :class="chipClass(minuteState(m))"
        :aria-pressed="minuteState(m) === 'picked'"
        :data-minute="m"
        :data-state="minuteState(m)"
        @click="onMinute(m)"
      >
        {{ minuteLabel(m) }}
      </button>
    </div>

    <div class="flex items-center gap-2">
      <input
        ref="typedInput"
        v-model="typed"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="done"
        :placeholder="t('time.typePlaceholder')"
        :aria-label="t('time.typeAriaLabel')"
        :aria-describedby="previewId"
        data-testid="time-picker-typed"
        class="focus:border-primary-500 dark:border-line dark:bg-surface-overlay dark:text-ink dark:placeholder:text-ink-faint min-w-0 flex-1 rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-2.5 py-1.5 text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
        @keydown.enter.prevent="onTypedEnter"
      />
      <span
        v-show="previewText"
        :id="previewId"
        aria-live="polite"
        data-testid="time-picker-preview"
        class="min-w-0 text-xs"
        :class="
          rejected
            ? 'dark:text-ink-faint text-[var(--color-text-muted)]'
            : 'font-outfit text-primary-500 dark:text-accent-lift font-semibold whitespace-nowrap'
        "
      >
        {{ previewText }}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button v-if="!nightShown" type="button" :class="linkClass" @click="showNight = true">
        {{ t('time.nightHours') }}
      </button>
      <button v-if="!showFine" type="button" :class="linkClass" @click="showFine = true">
        {{ t('time.fiveMinuteSteps') }}
      </button>
      <button
        v-if="clearable && value"
        type="button"
        :class="linkClass"
        data-testid="time-picker-panel-clear"
        @click="onClear"
      >
        {{ t('time.clear') }}
      </button>
      <div class="ml-auto flex items-center gap-2">
        <button
          v-if="allDayAffordance"
          type="button"
          :class="secondaryButtonClass"
          data-testid="time-picker-all-day"
          @click="emit('all-day')"
        >
          {{ t('planner.allDay') }}
        </button>
        <button
          type="button"
          :class="nextLabel ? secondaryButtonClass : primaryButtonClass"
          data-testid="time-picker-done"
          @click="onDone"
        >
          {{ t('time.done') }}
        </button>
        <button
          v-if="nextLabel"
          type="button"
          :class="primaryButtonClass"
          data-testid="time-picker-next"
          @click="onNext"
        >
          {{ nextLabel }}
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  </div>
</template>
