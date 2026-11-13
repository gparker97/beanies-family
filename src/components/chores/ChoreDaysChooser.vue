<script setup lang="ts">
/**
 * Which days a chore repeats (#146), compact: Every Day, School Days, Weekends, or Pick Days with
 * the weekday toggles. The ONE days control, opened from a row in the Add Chores sheet and in a
 * bean's chore list alike (`ChoreEditRow`). Purely an intent: it emits `pick` and owns only
 * whether the toggles are showing.
 *
 *  - A shortcut emits its days at once (`[]` is every day) with `preset: true`, so the row can
 *    close the chooser.
 *  - Pick Days shows the toggles and emits nothing by itself; every toggle emits the new days
 *    with `preset: false`. Every day reads as all seven toggles on, so turning one off is the way
 *    to "every day but Sunday". The last day can never be turned off (a chore with no day would
 *    never show); that tap is ignored and the toggle stays on.
 *
 * Classification is the ONE rule, `choreDaysKind`; the shortcuts are `SCHOOL_DAYS` and
 * `WEEKEND_DAYS`.
 *
 * Dark mode: the panel is a `line` edge on whatever it sits on; `ChipButton` and
 * `DayOfWeekSelector` (orange accent) carry their own dark partners.
 */
import { computed, ref, watch } from 'vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import { useTranslation } from '@/composables/useTranslation';
import { SCHOOL_DAYS, WEEKEND_DAYS, choreDaysKind } from '@/utils/chores';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  /** Weekdays 0-6; empty or absent = every day. */
  days?: readonly number[];
  /** The group's accessible name ("Days for Make bed: School Days"). */
  label: string;
}>();

const emit = defineEmits<{ pick: [days: number[], preset: boolean] }>();

const { t } = useTranslation();

type Mode = 'every' | 'school' | 'weekends' | 'pick';
const MODES: readonly { value: Mode; labelKey: UIStringKey }[] = [
  { value: 'every', labelKey: 'choreboard.form.days.every' },
  { value: 'school', labelKey: 'choreboard.form.days.school' },
  { value: 'weekends', labelKey: 'choreboard.form.days.weekends' },
  { value: 'pick', labelKey: 'choreboard.form.days.pick' },
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const kind = computed(() => choreDaysKind(props.days));
/** The toggles are showing: Pick Days was tapped, or the days are no shortcut. */
const picking = ref(kind.value === 'some');
watch(kind, (k) => {
  if (k === 'some') picking.value = true;
});

const mode = computed<Mode>(() =>
  picking.value || kind.value === 'some' ? 'pick' : (kind.value as Mode)
);
const toggles = computed(() => (kind.value === 'every' ? ALL_DAYS : [...(props.days ?? [])]));

function choose(m: Mode): void {
  if (m === 'pick') {
    picking.value = true;
    return;
  }
  picking.value = false;
  emit('pick', m === 'school' ? [...SCHOOL_DAYS] : m === 'weekends' ? [...WEEKEND_DAYS] : [], true);
}

function onToggles(next: number[]): void {
  if (next.length === 0) return;
  emit(
    'pick',
    [...next].sort((a, b) => a - b),
    false
  );
}
</script>

<template>
  <div
    class="dark:border-line flex flex-col gap-2.5 rounded-xl border border-[var(--tint-slate-10)] p-2.5"
    role="group"
    :aria-label="label"
    data-testid="chore-draft-days-choices"
  >
    <div class="flex flex-wrap gap-1.5">
      <ChipButton
        v-for="m in MODES"
        :key="m.value"
        :label="t(m.labelKey)"
        :selected="mode === m.value"
        :pressed="mode === m.value"
        :data-mode="m.value"
        @click="choose(m.value)"
      />
    </div>
    <div v-if="mode === 'pick'" data-testid="chore-draft-days-toggles">
      <DayOfWeekSelector :model-value="toggles" accent="orange" @update:model-value="onToggles" />
    </div>
  </div>
</template>
