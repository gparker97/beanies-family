<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToday } from '@/composables/useToday';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import {
  parseLocalDate,
  toDateInputValue,
  addMonths,
  addDays,
  formatMonthYearShort,
} from '@/utils/date';

interface Props {
  modelValue: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  required?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  min: '',
  max: '',
  disabled: false,
  placeholder: '',
  label: '',
  required: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

const dropdownRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const dropUp = ref(false);

// Viewport-relative coords for the teleported popover. Recalculated on
// open, scroll, and resize so the popover tracks its trigger even when
// it lives inside a clipping ancestor (e.g. VacationSegmentCard).
const popoverStyle = ref<Record<string, string>>({});
const POPOVER_WIDTH = 260;
const POPOVER_HEIGHT_ESTIMATE = 340; // month + quick chips + grid + footer

// Month currently shown in the calendar grid
const viewMonth = ref<Date>(new Date());

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAY_INITIALS_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const weekStart = computed(() => settingsStore.weekStartDay);

const weekdayInitials = computed(() =>
  Array.from({ length: 7 }, (_, i) => WEEKDAY_INITIALS_SUN[(i + weekStart.value) % 7]!)
);

const { today: todayStr, startOfToday: today } = useToday();
const tomorrowStr = computed(() => toDateInputValue(addDays(today.value, 1)));

// ── Trigger label ─────────────────────────────────────────────────────────
const displayLabel = computed(() => {
  if (!props.modelValue) {
    return props.placeholder || t('date.pick');
  }
  const date = parseLocalDate(props.modelValue);
  if (props.modelValue === todayStr.value) return t('date.today');
  if (props.modelValue === tomorrowStr.value) return t('date.tomorrow');
  const dow = DAYS_SHORT[date.getDay()];
  const day = date.getDate();
  const mon = MONTHS_SHORT[date.getMonth()];
  return `${dow}, ${day} ${mon}`;
});

// ── Calendar grid ─────────────────────────────────────────────────────────
interface Cell {
  date: Date;
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isWeekend: boolean;
  disabled: boolean;
}

const calendarCells = computed<Cell[]>(() => {
  const year = viewMonth.value.getFullYear();
  const month = viewMonth.value.getMonth();
  const firstDay = new Date(year, month, 1);
  // Offset the grid so the first column is the user's preferred week-start day
  const startOffset = (firstDay.getDay() - weekStart.value + 7) % 7;
  const gridStart = addDays(firstDay, -startOffset);
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const iso = toDateInputValue(d);
    const disabled = (!!props.min && iso < props.min) || (!!props.max && iso > props.max);
    cells.push({
      date: d,
      iso,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: iso === todayStr.value,
      isSelected: iso === props.modelValue,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      disabled,
    });
  }
  return cells;
});

// ── Interaction ───────────────────────────────────────────────────────────
function openPopover() {
  if (props.disabled) return;
  isOpen.value = true;
  // Seed the calendar view to the selected date, or today
  if (props.modelValue) {
    viewMonth.value = parseLocalDate(props.modelValue);
  } else {
    viewMonth.value = new Date();
  }
  nextTick(() => positionPopover());
}

function closePopover() {
  isOpen.value = false;
}

function toggle() {
  if (isOpen.value) closePopover();
  else openPopover();
}

function positionPopover() {
  if (!dropdownRef.value) return;
  const rect = dropdownRef.value.getBoundingClientRect();
  const popoverHeight = popoverRef.value?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;
  const popoverWidth = popoverRef.value?.offsetWidth ?? POPOVER_WIDTH;
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const spaceBelow = viewportHeight - rect.bottom;
  const MARGIN = 8;

  dropUp.value = spaceBelow < popoverHeight + 16 && rect.top > popoverHeight + 16;

  const top = dropUp.value ? rect.top - popoverHeight - 6 : rect.bottom + 6;
  let left = rect.left;
  // Clamp horizontally so the popover stays on-screen even when the
  // trigger sits near the right edge of a narrow viewport.
  if (left + popoverWidth > viewportWidth - MARGIN) {
    left = viewportWidth - popoverWidth - MARGIN;
  }
  if (left < MARGIN) left = MARGIN;

  popoverStyle.value = {
    position: 'fixed',
    top: `${Math.max(MARGIN, top)}px`,
    left: `${left}px`,
  };
}

function selectDay(cell: Cell) {
  if (cell.disabled) return;
  emit('update:modelValue', cell.iso);
  closePopover();
}

function selectQuick(iso: string) {
  if (props.min && iso < props.min) return;
  if (props.max && iso > props.max) return;
  emit('update:modelValue', iso);
  closePopover();
}

function prevMonth() {
  viewMonth.value = addMonths(viewMonth.value, -1);
}

function nextMonth() {
  viewMonth.value = addMonths(viewMonth.value, 1);
}

function goToToday() {
  viewMonth.value = new Date();
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  const inTrigger = dropdownRef.value?.contains(target);
  // Popover is teleported to <body>, so it's no longer a descendant of
  // the trigger — check it separately to avoid closing on in-popover clicks.
  const inPopover = popoverRef.value?.contains(target);
  if (!inTrigger && !inPopover) closePopover();
}

function handleKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return;
  if (e.key === 'Escape') closePopover();
}

function handleViewportChange() {
  if (isOpen.value) positionPopover();
}

watch(
  () => props.modelValue,
  (val) => {
    if (val && isOpen.value) {
      viewMonth.value = parseLocalDate(val);
    }
  }
);

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
});

const isTodayDisabled = computed(() => {
  if (props.min && todayStr.value < props.min) return true;
  if (props.max && todayStr.value > props.max) return true;
  return false;
});

const isTomorrowDisabled = computed(() => {
  if (props.min && tomorrowStr.value < props.min) return true;
  if (props.max && tomorrowStr.value > props.max) return true;
  return false;
});
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block w-full space-y-1">
    <label
      v-if="label"
      class="font-outfit block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
    </label>

    <!-- Trigger: bean-pill, mirrors TimePresetPicker -->
    <button
      type="button"
      :disabled="disabled"
      data-testid="beanie-date-picker-trigger"
      class="font-outfit flex w-full items-center justify-between gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
      :class="[
        modelValue
          ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400',
        disabled && 'cursor-not-allowed opacity-50',
      ]"
      @click="toggle"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0 text-[0.85rem] leading-none">📅</span>
        <span class="truncate">{{ displayLabel }}</span>
      </span>
      <svg
        class="h-3 w-3 shrink-0 transition-transform"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2.5"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Calendar popover — teleported so clipping ancestors (e.g. a card
         with overflow-hidden) don't cut it off. -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition ease-out duration-150"
        enter-from-class="opacity-0 -translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition ease-in duration-100"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-1"
      >
        <div
          v-if="isOpen"
          ref="popoverRef"
          :style="popoverStyle"
          class="z-50 w-[260px] overflow-hidden rounded-2xl border border-[var(--tint-slate-10)] bg-white shadow-[0_8px_24px_rgba(44,62,80,0.12)] dark:border-slate-600 dark:bg-slate-800"
        >
          <!-- Month navigator -->
          <div
            class="flex items-center justify-between border-b border-[var(--tint-slate-10)] px-3 py-2 dark:border-slate-700"
          >
            <button
              type="button"
              aria-label="Previous month"
              class="rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-5)] dark:hover:bg-slate-700"
              @click="prevMonth"
            >
              <BeanieIcon name="chevron-left" size="sm" />
            </button>
            <span class="font-outfit text-sm font-bold text-[var(--color-text)] dark:text-gray-100">
              {{ formatMonthYearShort(viewMonth) }}
            </span>
            <button
              type="button"
              aria-label="Next month"
              class="rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-5)] dark:hover:bg-slate-700"
              @click="nextMonth"
            >
              <BeanieIcon name="chevron-right" size="sm" />
            </button>
          </div>

          <!-- Quick chips -->
          <div
            class="flex gap-1.5 border-b border-[var(--tint-slate-10)] px-3 py-2 dark:border-slate-700"
          >
            <button
              type="button"
              :disabled="isTodayDisabled"
              class="font-outfit flex-1 rounded-full border-2 px-2 py-1 text-xs font-semibold transition-all"
              :class="[
                modelValue === todayStr
                  ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 bg-[var(--tint-orange-8)]'
                  : 'border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-200',
                isTodayDisabled && 'cursor-not-allowed opacity-40',
              ]"
              @click="selectQuick(todayStr)"
            >
              {{ t('date.today') }}
            </button>
            <button
              type="button"
              :disabled="isTomorrowDisabled"
              class="font-outfit flex-1 rounded-full border-2 px-2 py-1 text-xs font-semibold transition-all"
              :class="[
                modelValue === tomorrowStr
                  ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 bg-[var(--tint-orange-8)]'
                  : 'border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-200',
                isTomorrowDisabled && 'cursor-not-allowed opacity-40',
              ]"
              @click="selectQuick(tomorrowStr)"
            >
              {{ t('date.tomorrow') }}
            </button>
          </div>

          <!-- Weekday header -->
          <div class="grid grid-cols-7 gap-0.5 px-2 pt-2">
            <div
              v-for="(d, i) in weekdayInitials"
              :key="i"
              class="font-outfit text-center text-[0.625rem] font-bold tracking-wider text-[var(--color-text-muted)] uppercase opacity-60"
              :class="
                ((i + weekStart) % 7 === 0 || (i + weekStart) % 7 === 6) &&
                'text-primary-500 opacity-70'
              "
            >
              {{ d }}
            </div>
          </div>

          <!-- Day grid -->
          <div class="grid grid-cols-7 gap-0.5 px-2 pt-1 pb-2">
            <button
              v-for="cell in calendarCells"
              :key="cell.iso"
              type="button"
              :disabled="cell.disabled"
              :aria-label="cell.iso"
              :aria-current="cell.isToday ? 'date' : undefined"
              class="font-outfit relative flex h-8 items-center justify-center rounded-[10px] text-xs font-semibold transition-all"
              :class="[
                // Selected → filled orange bean
                cell.isSelected &&
                  'bg-gradient-to-br from-[#F15D22] to-[#E67E22] text-white shadow-sm',
                // Today (unselected) → orange ring
                !cell.isSelected && cell.isToday && 'ring-2 ring-[#F15D22] ring-inset',
                // In-month, not selected, not today → default
                !cell.isSelected &&
                  !cell.isToday &&
                  cell.inMonth &&
                  !cell.disabled &&
                  'dark:hover:bg-primary-500/10 text-[var(--color-text)] hover:bg-[var(--tint-orange-8)] dark:text-gray-100',
                // Out-of-month → faded
                !cell.isSelected &&
                  !cell.inMonth &&
                  !cell.disabled &&
                  'text-[var(--color-text-muted)] opacity-35 hover:bg-[var(--tint-slate-5)] hover:opacity-60 dark:text-gray-500 dark:hover:bg-slate-700',
                // Weekend subtle accent (only when in-month and not selected/today)
                !cell.isSelected &&
                  !cell.isToday &&
                  cell.inMonth &&
                  !cell.disabled &&
                  cell.isWeekend &&
                  'text-primary-600 dark:text-primary-400',
                cell.disabled && 'cursor-not-allowed opacity-25',
              ]"
              @click="selectDay(cell)"
            >
              {{ cell.day }}
            </button>
          </div>

          <!-- Footer: jump to today -->
          <div
            v-if="formatMonthYearShort(viewMonth) !== formatMonthYearShort(today)"
            class="flex justify-center border-t border-[var(--tint-slate-10)] px-3 py-1.5 dark:border-slate-700"
          >
            <button
              type="button"
              class="font-outfit text-primary-500 hover:text-primary-600 text-xs font-semibold transition-colors"
              @click="goToToday"
            >
              {{ t('date.jumpToToday') }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
