<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue';
import FrequencyChips, { type ChipOption } from '@/components/ui/FrequencyChips.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import { useTranslation } from '@/composables/useTranslation';
import { describeRule, WEEKDAY_SHORT } from '@/services/recurrence/describe';
import { fillTemplate } from '@/utils/fillTemplate';
import { getOrdinalSuffix } from '@/utils/format';
import {
  extractDatePart,
  parseLocalDate,
  getWeekdayOrdinalInMonth,
  formatDayLong,
  toDateInputValue,
} from '@/utils/date';
import type { RecurrenceRule, RecurrenceUnit, RecurrenceEnd } from '@/types/recurrence';

/**
 * The one recurrence control (#70) — direction B (Simple | Custom, custom
 * first-class). Context-sensitive: sub-controls appear ONLY where they apply and
 * the zone is hidden entirely otherwise (no empty box). Composes the shared
 * `FrequencyChips` + `DayOfWeekSelector`; every token from the CIG.
 *
 * `mode="reset"` (lists) relabels Repeats→Resets, hides the "ends" control, and
 * emits a rule whose end is always `never` (the list layer keeps only the
 * cadence). See the plan.
 */
const props = withDefaults(
  defineProps<{
    modelValue: RecurrenceRule | null;
    /** The entity's start date (YYYY-MM-DD or ISO) — the anchor everything derives from. */
    startDate: string;
    mode?: 'repeat' | 'reset';
    accent?: 'orange' | 'purple';
  }>(),
  { mode: 'repeat', accent: 'orange' }
);
const emit = defineEmits<{ 'update:modelValue': [value: RecurrenceRule] }>();

const { t } = useTranslation();

type SimpleCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
type CustomUnit = 'days' | 'weeks' | 'months' | 'years';
const UNIT_OF: Record<CustomUnit, RecurrenceUnit> = {
  days: 'day',
  weeks: 'week',
  months: 'month',
  years: 'year',
};

// A cleared/absent start date must NOT reach the label helpers:
// `getWeekdayOrdinalInMonth` THROWS on an invalid Date, which would tear down
// the whole modal mid-render (reachable in two taps — clear the start date on a
// recurring activity). Fall back to today, which keeps the control rendering a
// sensible default until a real date is chosen. The old
// `formatActivityRecurrence` had an equivalent `dateValid` guard.
const anchorYmd = computed(() => {
  const ymd = extractDatePart(props.startDate ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(parseLocalDate(ymd).getTime())
    ? ymd
    : toDateInputValue(new Date());
});
const anchorDate = computed(() => parseLocalDate(anchorYmd.value));
const isReset = computed(() => props.mode === 'reset');

// ── Local editable state ────────────────────────────────────────────────────
const s = reactive({
  uiMode: 'simple' as 'simple' | 'custom',
  simple: 'monthly' as SimpleCadence,
  customN: 2,
  customUnit: 'weeks' as CustomUnit,
  weekdays: [] as number[],
  monthlyMode: 'date' as 'date' | 'weekday',
  // Preserved from a loaded rule (so editing a legacy item on the 15th doesn't
  // silently reschedule to the start-date day); re-derived only when the user
  // changes the start date. New selections take the start date's day verbatim
  // (1–31) — a day the month lacks CLAMPS to its last day (#70), so there is no
  // need to cap. `'last'` still arrives here from an already-stored rule.
  monthlyDay: 1 as number | 'last',
  endKind: 'never' as RecurrenceEnd['kind'],
  endDate: '',
  endCount: 12,
});

/**
 * Start-date-derived monthly day for a NEW/re-derived selection. Verbatim 1–31:
 * a month lacking the day clamps to its last day (#70), and the hint below says
 * so, so there is nothing to cap.
 */
function deriveMonthlyDay(): number {
  return anchorDate.value.getDate();
}

/** Which simple cadence, if any, a rule matches — else null → custom mode. */
function matchSimple(rule: RecurrenceRule): SimpleCadence | null {
  if (rule.unit === 'week' && rule.interval === 2) return 'biweekly';
  if (rule.interval === 1) {
    if (rule.unit === 'day') return 'daily';
    if (rule.unit === 'week') return 'weekly';
    if (rule.unit === 'month') return 'monthly';
    if (rule.unit === 'year') return 'yearly';
  }
  return null;
}

// ── Derived: unit + interval + which contextual sub-control applies ──────────
const activeUnit = computed<RecurrenceUnit>(() => {
  if (s.uiMode === 'custom') return UNIT_OF[s.customUnit];
  return s.simple === 'daily'
    ? 'day'
    : s.simple === 'weekly' || s.simple === 'biweekly'
      ? 'week'
      : s.simple === 'monthly'
        ? 'month'
        : 'year';
});
const activeInterval = computed(() => {
  if (s.uiMode === 'custom') return Math.max(1, Math.floor(s.customN));
  return s.simple === 'biweekly' ? 2 : 1;
});
const ctx = computed<'weekdays-multi' | 'weekday-single' | 'monthly' | null>(() => {
  if (activeUnit.value === 'week')
    return activeInterval.value === 1 ? 'weekdays-multi' : 'weekday-single';
  if (activeUnit.value === 'month') return 'monthly';
  return null; // day, year
});

// ── Build the canonical rule ────────────────────────────────────────────────
const builtRule = computed<RecurrenceRule>(() => {
  const unit = activeUnit.value;
  const interval = activeInterval.value;
  const end: RecurrenceEnd = isReset.value
    ? { kind: 'never' }
    : s.endKind === 'onDate'
      ? // An "on a date" end with no date chosen must NOT collapse to the start
        // date (that would end the series on its first occurrence) — treat as never.
        s.endDate
        ? { kind: 'onDate', date: s.endDate }
        : { kind: 'never' }
      : s.endKind === 'afterCount'
        ? { kind: 'afterCount', count: Math.max(1, Math.floor(s.endCount)) }
        : { kind: 'never' };

  const rule: RecurrenceRule = { unit, interval, end };
  if (unit === 'week') {
    const days = s.weekdays.length ? s.weekdays : [anchorDate.value.getDay()];
    rule.weekdays = interval >= 2 ? [days[0]!] : [...new Set(days)].sort((a, b) => a - b);
  } else if (unit === 'month') {
    if (s.monthlyMode === 'weekday') {
      rule.monthlyAnchor = 'weekday';
    } else {
      rule.monthlyAnchor = 'date';
      rule.monthlyDay = s.monthlyDay;
    }
  }
  return rule;
});

// ── Model <-> state sync (echo-guarded to prevent an infinite v-model loop) ──
// `watch(builtRule)` flushes async, so a synchronous flag can't suppress the
// emit's echo — instead we compare against the JSON we last emitted/applied and
// skip both the re-emit and the re-sync when they match.
let lastJson = '';
function syncFromModel(rule: RecurrenceRule | null): void {
  const anchorDow = anchorDate.value.getDay();
  if (!rule) {
    s.uiMode = 'simple';
    s.simple = 'monthly';
    s.customN = 2;
    s.customUnit = 'weeks';
    s.weekdays = [anchorDow];
    s.monthlyMode = 'date';
    s.monthlyDay = deriveMonthlyDay();
    s.endKind = 'never';
  } else {
    s.weekdays = rule.weekdays?.length ? [...rule.weekdays] : [anchorDow];
    s.monthlyMode = rule.monthlyAnchor === 'weekday' ? 'weekday' : 'date';
    s.monthlyDay =
      rule.unit === 'month' && rule.monthlyAnchor !== 'weekday' && rule.monthlyDay !== undefined
        ? rule.monthlyDay
        : deriveMonthlyDay();
    s.endKind = rule.end.kind;
    if (rule.end.kind === 'onDate') s.endDate = rule.end.date;
    if (rule.end.kind === 'afterCount') s.endCount = rule.end.count;
    const simple = matchSimple(rule);
    if (simple) {
      s.uiMode = 'simple';
      s.simple = simple;
    } else {
      s.uiMode = 'custom';
      s.customN = rule.interval;
      s.customUnit = (Object.keys(UNIT_OF) as CustomUnit[]).find((k) => UNIT_OF[k] === rule.unit)!;
    }
  }
  lastJson = JSON.stringify(builtRule.value);
}
syncFromModel(props.modelValue);

// #70: publish the default when we start from nothing. The control SHOWS a
// concrete schedule ("repeats monthly on the 23rd"), so a parent that saves
// without the user ever touching it must receive that rule — otherwise the form
// silently persists "does not repeat" while displaying a schedule. `watch` is
// not `immediate`, so nothing was emitted and each consumer had to reconstruct
// the default itself (the two copies had already drifted).
//
// On MOUNTED, not during setup: emitting mid-setup runs the parent's handler
// before the parent has finished initializing.
onMounted(() => {
  if (props.modelValue) return;
  lastJson = JSON.stringify(builtRule.value);
  emit('update:modelValue', builtRule.value);
});

watch(
  () => props.modelValue,
  (v) => {
    if (JSON.stringify(v) === lastJson) return; // our own echo — ignore
    syncFromModel(v);
  }
);

// Every anchor the rule derives follows the start date (greg's steer) — but only
// on a genuine start-date change, so a loaded rule's stored values survive
// opening the form.
watch(anchorYmd, (newYmd, oldYmd) => {
  // NOT gated on the active unit: a start-date change made while Weekly is
  // selected must still move the monthly anchor, or switching to Monthly
  // afterwards emits a rule anchored on a day the series never starts on.
  if (s.monthlyMode === 'date') s.monthlyDay = deriveMonthlyDay();
  // Weekdays re-anchor too, but ONLY while untouched — i.e. still exactly the
  // previous start date's weekday. A user-chosen set is never rewritten. Without
  // this a series moved from a Monday to a Tuesday keeps repeating on Mondays.
  // (Same "untouched" heuristic ActivityModal used before it adopted this
  // control, so the modal no longer needs its own date watcher.)
  if (!oldYmd || oldYmd === newYmd) return;
  const prevDow = parseLocalDate(oldYmd).getDay();
  if (s.weekdays.length === 1 && s.weekdays[0] === prevDow) {
    s.weekdays = [parseLocalDate(newYmd).getDay()];
  }
});

watch(
  builtRule,
  (rule) => {
    const json = JSON.stringify(rule);
    if (json === lastJson) return; // no real change (or an apply we already recorded)
    lastJson = json;
    emit('update:modelValue', rule);
  },
  { deep: true }
);

// ── Labels ──────────────────────────────────────────────────────────────────
const simpleOptions = computed<ChipOption[]>(() => [
  { value: 'daily', label: t('recurrence.cadence.daily') },
  { value: 'weekly', label: t('recurrence.cadence.weekly') },
  { value: 'biweekly', label: t('recurrence.cadence.biweekly') },
  { value: 'monthly', label: t('recurrence.cadence.monthly') },
  { value: 'yearly', label: t('recurrence.cadence.yearly') },
]);
const unitOptions: CustomUnit[] = ['days', 'weeks', 'months', 'years'];

const monthlyDateLabel = computed(() =>
  s.monthlyDay === 'last'
    ? t('recurrence.monthly.lastDay')
    : fillTemplate(t('recurrence.monthly.onDate'), { date: getOrdinalSuffix(s.monthlyDay) })
);
const monthlyDayLabel = computed(() =>
  fillTemplate(t('recurrence.monthly.onDay'), {
    ordinal: getOrdinalSuffix(getWeekdayOrdinalInMonth(anchorDate.value)),
    day: t(WEEKDAY_SHORT[anchorDate.value.getDay()]!),
  })
);
const monthlyHint = computed(() => {
  const base = fillTemplate(t('recurrence.startHint'), { date: formatDayLong(anchorYmd.value) });
  // A 29th/30th/31st anchor is "missable" — say plainly what happens in the
  // months that lack it, rather than letting the user discover it (#70).
  return s.monthlyMode === 'date' && typeof s.monthlyDay === 'number' && s.monthlyDay > 28
    ? `${base} ${fillTemplate(t('recurrence.monthly.clampHint'), { date: getOrdinalSuffix(s.monthlyDay) })}`
    : base;
});
const summary = computed(() => describeRule(builtRule.value, anchorYmd.value, t));

// ── Handlers ────────────────────────────────────────────────────────────────
function setMode(m: 'simple' | 'custom') {
  s.uiMode = m;
}
function onWeekdays(next: number[]) {
  // interval >= 2 → single weekday (keep the newly added one); else >= 1 day.
  if (activeInterval.value >= 2) {
    const added = next.find((d) => !s.weekdays.includes(d));
    s.weekdays =
      added !== undefined ? [added] : next.length ? [next[next.length - 1]!] : s.weekdays;
  } else {
    s.weekdays = next.length ? next : s.weekdays; // never empty
  }
}
function stepCount(delta: number) {
  s.endCount = Math.min(999, Math.max(1, s.endCount + delta));
}
function stepN(delta: number) {
  s.customN = Math.min(99, Math.max(1, s.customN + delta));
}
</script>

<template>
  <div class="space-y-4">
    <!-- Simple | Custom, first-class -->
    <div class="flex gap-1 rounded-2xl bg-[var(--tint-slate-5)] p-1">
      <button
        v-for="m in ['simple', 'custom'] as const"
        :key="m"
        type="button"
        class="font-outfit flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-150"
        :class="
          s.uiMode === m
            ? 'bg-white text-[var(--color-text)] shadow-sm dark:bg-slate-700'
            : 'text-[var(--color-text-muted)]'
        "
        @click="setMode(m)"
      >
        {{ t(`recurrence.mode.${m}`) }}
      </button>
    </div>

    <!-- Simple: cadence chips -->
    <FrequencyChips
      v-if="s.uiMode === 'simple'"
      :model-value="s.simple"
      :options="simpleOptions"
      :accent="accent"
      @update:model-value="(v) => (s.simple = v as SimpleCadence)"
    />

    <!-- Custom: repeat every N [unit] -->
    <div v-else class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-[var(--color-text-muted)]">{{
        isReset ? t('recurrence.resetEvery') : t('recurrence.customEvery')
      }}</span>
      <div
        class="inline-flex items-center overflow-hidden rounded-xl border-2 border-[var(--tint-slate-10)]"
      >
        <button
          type="button"
          class="font-outfit h-10 w-9 text-lg font-semibold text-[var(--color-primary)]"
          :aria-label="t('recurrence.a11y.decrease')"
          @click="stepN(-1)"
        >
          −
        </button>
        <span class="font-outfit min-w-[2.5rem] text-center text-base font-bold tabular-nums">{{
          s.customN
        }}</span>
        <button
          type="button"
          class="font-outfit h-10 w-9 text-lg font-semibold text-[var(--color-primary)]"
          :aria-label="t('recurrence.a11y.increase')"
          @click="stepN(1)"
        >
          +
        </button>
      </div>
      <select
        :value="s.customUnit"
        class="font-outfit rounded-xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 py-2 text-base font-semibold"
        :aria-label="t('recurrence.a11y.unit')"
        @change="(e) => (s.customUnit = (e.target as HTMLSelectElement).value as CustomUnit)"
      >
        <option v-for="u in unitOptions" :key="u" :value="u">
          {{ t(`recurrence.unit.${u}`) }}
        </option>
      </select>
    </div>

    <!-- Contextual sub-control zone — rendered ONLY when something applies -->
    <div
      v-if="ctx"
      class="rounded-2xl bg-[var(--tint-orange-8)] p-4"
      :class="{ 'bg-[var(--tint-purple-12)]': accent === 'purple' }"
    >
      <!-- weekly / every-N-weeks → weekday selection -->
      <div v-if="ctx === 'weekdays-multi' || ctx === 'weekday-single'">
        <p class="mb-2 text-sm font-medium text-[var(--color-text)]">
          {{ ctx === 'weekdays-multi' ? t('recurrence.ctx.days') : t('recurrence.ctx.day') }}
        </p>
        <DayOfWeekSelector
          :model-value="s.weekdays"
          :accent="accent"
          @update:model-value="onWeekdays"
        />
        <p v-if="ctx === 'weekdays-multi'" class="mt-2 text-xs text-[var(--color-text-muted)]">
          {{ t('recurrence.weekdayHint') }}
        </p>
      </div>

      <!-- monthly / every-N-months → on the date vs the nth weekday -->
      <div v-else-if="ctx === 'monthly'">
        <p class="mb-2 text-sm font-medium text-[var(--color-text)]">
          {{ t('recurrence.ctx.monthly') }}
        </p>
        <div class="flex flex-col gap-2" role="radiogroup">
          <button
            v-for="opt in [
              { key: 'date', label: monthlyDateLabel, sub: t('recurrence.monthly.dateSub') },
              { key: 'weekday', label: monthlyDayLabel, sub: t('recurrence.monthly.daySub') },
            ]"
            :key="opt.key"
            type="button"
            role="radio"
            :aria-checked="s.monthlyMode === opt.key"
            class="flex items-center gap-3 rounded-xl border-2 bg-white px-4 py-3 text-left dark:bg-slate-700"
            :class="
              s.monthlyMode === opt.key
                ? accent === 'purple'
                  ? 'border-purple-500'
                  : 'border-primary-500'
                : 'border-[var(--tint-slate-10)]'
            "
            @click="s.monthlyMode = opt.key as 'date' | 'weekday'"
          >
            <span
              class="h-4 w-4 flex-none rounded-full border-2"
              :class="
                s.monthlyMode === opt.key
                  ? accent === 'purple'
                    ? 'border-purple-500 bg-purple-500'
                    : 'border-primary-500 bg-[var(--color-primary)]'
                  : 'border-[var(--tint-slate-10)]'
              "
            />
            <span class="font-outfit min-w-0">
              <span class="block text-sm font-semibold text-[var(--color-text)]">{{
                opt.label
              }}</span>
              <span class="font-inter block text-xs font-normal text-[var(--color-text-muted)]">{{
                opt.sub
              }}</span>
            </span>
          </button>
        </div>
        <p class="mt-2 text-xs text-[var(--color-text-muted)]">{{ monthlyHint }}</p>
      </div>
    </div>

    <!-- Ends (repeat mode only) -->
    <div
      v-if="!isReset"
      class="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]"
    >
      {{ t('recurrence.ends') }}
      <select
        :value="s.endKind"
        class="font-outfit rounded-xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 py-2 text-base font-semibold text-[var(--color-text)]"
        :aria-label="t('recurrence.ends')"
        @change="
          (e) => (s.endKind = (e.target as HTMLSelectElement).value as RecurrenceEnd['kind'])
        "
      >
        <option value="never">{{ t('recurrence.ends.never') }}</option>
        <option value="onDate">{{ t('recurrence.ends.onDate') }}</option>
        <option value="afterCount">{{ t('recurrence.ends.after') }}</option>
      </select>
      <input
        v-if="s.endKind === 'onDate'"
        type="date"
        :value="s.endDate"
        :min="anchorYmd"
        class="font-outfit rounded-xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 py-2 text-base font-semibold text-[var(--color-text)]"
        :aria-label="t('recurrence.ends.onDate')"
        @change="(e) => (s.endDate = (e.target as HTMLInputElement).value)"
      />
      <span v-else-if="s.endKind === 'afterCount'" class="inline-flex items-center gap-2">
        <span
          class="inline-flex items-center overflow-hidden rounded-xl border-2 border-[var(--tint-slate-10)]"
        >
          <button
            type="button"
            class="font-outfit h-9 w-8 font-semibold text-[var(--color-primary)]"
            :aria-label="t('recurrence.a11y.decrease')"
            @click="stepCount(-1)"
          >
            −
          </button>
          <span class="font-outfit min-w-[2.25rem] text-center text-base font-bold tabular-nums">{{
            s.endCount
          }}</span>
          <button
            type="button"
            class="font-outfit h-9 w-8 font-semibold text-[var(--color-primary)]"
            :aria-label="t('recurrence.a11y.increase')"
            @click="stepCount(1)"
          >
            +
          </button>
        </span>
        {{ t('recurrence.ends.times') }}
      </span>
    </div>

    <!-- Live plain-language summary -->
    <div
      class="flex items-center gap-2 rounded-xl bg-[var(--tint-slate-5)] px-3 py-2 text-sm text-[var(--color-text)]"
    >
      <span class="h-2 w-2 flex-none rounded-full bg-[var(--color-success)]" />
      <span
        >{{ isReset ? t('recurrence.resets') : t('recurrence.repeats') }}
        <b class="font-semibold">{{ summary }}</b></span
      >
    </div>
  </div>
</template>
