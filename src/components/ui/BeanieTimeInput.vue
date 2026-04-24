<script setup lang="ts">
/**
 * Beanie-themed time picker for free-form time entry (flights, trains,
 * cruise embarkation, etc.) where the TimePresetPicker 30-min dropdown
 * isn't precise enough. Opens a themed 3-column popover (Hour · Minute
 * · AM/PM) instead of the browser's native time picker — so every
 * date/time control in the app shares the same visual language.
 *
 * Value format: HH:mm (24-hour), matching <input type="time">.
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatTime12, toTimeInputValue } from '@/utils/date';

interface Props {
  modelValue: string;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  required?: boolean;
  min?: string;
  max?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  placeholder: '',
  label: '',
  required: false,
  min: '',
  max: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();

const dropdownRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const hourColRef = ref<HTMLElement | null>(null);
const minuteColRef = ref<HTMLElement | null>(null);

const isOpen = ref(false);
const dropUp = ref(false);

// Viewport-relative coords for the teleported popover.
const popoverStyle = ref<Record<string, string>>({});
const POPOVER_WIDTH = 248;
const POPOVER_HEIGHT_ESTIMATE = 300;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59

// ── Parse the HH:mm value into hour12 + minute + period ────────────────────
interface Parsed {
  hour12: number; // 1..12
  minute: number; // 0..59
  period: 'AM' | 'PM';
}

function parse(value: string): Parsed | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h24 = Number(m[1]);
  const minute = Number(m[2]);
  if (h24 < 0 || h24 > 23 || minute < 0 || minute > 59) return null;
  const period: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minute, period };
}

function toHHmm(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  let h24 = hour12 % 12;
  if (period === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ── Draft state (what the user is pointing at in the popover) ──────────────
const draftHour = ref<number>(12);
const draftMinute = ref<number>(0);
const draftPeriod = ref<'AM' | 'PM'>('AM');

function seedDraft() {
  const now = new Date();
  const parsed = parse(props.modelValue) ?? {
    hour12: now.getHours() % 12 || 12,
    minute: now.getMinutes(),
    period: (now.getHours() < 12 ? 'AM' : 'PM') as 'AM' | 'PM',
  };
  draftHour.value = parsed.hour12;
  draftMinute.value = parsed.minute;
  draftPeriod.value = parsed.period;
}

// ── Validation: honour min/max when passed ─────────────────────────────────
function isDisabled(h12: number, minute: number, period: 'AM' | 'PM'): boolean {
  const value = toHHmm(h12, minute, period);
  if (props.min && value < props.min) return true;
  if (props.max && value > props.max) return true;
  return false;
}

const disabledHour = (h12: number) => {
  // Only disable an hour if every (minute, period) combo is out of range —
  // otherwise the user should still be able to pick it.
  for (const m of MINUTES) {
    if (!isDisabled(h12, m, 'AM') || !isDisabled(h12, m, 'PM')) return false;
  }
  return true;
};

const disabledMinute = (m: number) => {
  if (!isDisabled(draftHour.value, m, draftPeriod.value)) return false;
  return true;
};

const disabledPeriod = (p: 'AM' | 'PM') => {
  if (!isDisabled(draftHour.value, draftMinute.value, p)) return false;
  return true;
};

// ── Trigger label ──────────────────────────────────────────────────────────
const displayLabel = computed(() => {
  if (!props.modelValue) return props.placeholder || t('modal.selectTime');
  return formatTime12(props.modelValue);
});

// ── Interaction ────────────────────────────────────────────────────────────
function openPopover() {
  if (props.disabled) return;
  seedDraft();
  isOpen.value = true;
  nextTick(() => {
    positionPopover();
    scrollColumnsToSelected();
  });
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

function scrollColumnsToSelected() {
  for (const col of [hourColRef.value, minuteColRef.value]) {
    const active = col?.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) active.scrollIntoView({ block: 'center' });
  }
}

function commit(next: Partial<Parsed>) {
  const h = next.hour12 ?? draftHour.value;
  const m = next.minute ?? draftMinute.value;
  const p = next.period ?? draftPeriod.value;
  if (isDisabled(h, m, p)) return;
  draftHour.value = h;
  draftMinute.value = m;
  draftPeriod.value = p;
  emit('update:modelValue', toHHmm(h, m, p));
}

function selectHour(h: number) {
  if (disabledHour(h)) return;
  commit({ hour12: h });
}

function selectMinute(m: number) {
  if (disabledMinute(m)) return;
  commit({ minute: m });
}

function selectPeriod(p: 'AM' | 'PM') {
  if (disabledPeriod(p)) return;
  commit({ period: p });
}

function selectNow() {
  const now = new Date();
  const v = toTimeInputValue(now);
  const parsed = parse(v);
  if (!parsed) return;
  if (isDisabled(parsed.hour12, parsed.minute, parsed.period)) return;
  draftHour.value = parsed.hour12;
  draftMinute.value = parsed.minute;
  draftPeriod.value = parsed.period;
  emit('update:modelValue', v);
  closePopover();
}

function clearValue() {
  emit('update:modelValue', '');
  closePopover();
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  const inTrigger = dropdownRef.value?.contains(target);
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
  (v) => {
    if (isOpen.value) {
      const p = parse(v);
      if (p) {
        draftHour.value = p.hour12;
        draftMinute.value = p.minute;
        draftPeriod.value = p.period;
      }
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
</script>

<template>
  <div class="space-y-1">
    <label
      v-if="label"
      class="font-outfit block text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
    </label>

    <div ref="dropdownRef" class="relative inline-block w-full">
      <!-- Trigger: bean-pill -->
      <button
        type="button"
        :disabled="disabled"
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
          <span class="shrink-0 text-[0.85rem] leading-none">🕐</span>
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

      <!-- Popover — teleported so clipping ancestors (e.g. a card with
           overflow-hidden) don't cut it off. -->
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
            class="z-50 w-[248px] overflow-hidden rounded-2xl border border-[var(--tint-slate-10)] bg-white shadow-[0_8px_24px_rgba(44,62,80,0.12)] dark:border-slate-600 dark:bg-slate-800"
          >
            <!-- Column headers -->
            <div
              class="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-[var(--tint-slate-10)] px-3 pt-2 pb-1.5 dark:border-slate-700"
            >
              <div
                class="font-outfit text-center text-[0.625rem] font-bold tracking-wider text-[var(--color-text-muted)] uppercase opacity-60"
              >
                {{ t('time.hour') }}
              </div>
              <div
                class="font-outfit text-center text-[0.625rem] font-bold tracking-wider text-[var(--color-text-muted)] uppercase opacity-60"
              >
                {{ t('time.minute') }}
              </div>
              <div
                class="font-outfit w-14 text-center text-[0.625rem] font-bold tracking-wider text-[var(--color-text-muted)] uppercase opacity-60"
              >
                {{ t('time.period') }}
              </div>
            </div>

            <!-- Columns -->
            <div class="grid grid-cols-[1fr_1fr_auto] gap-2 px-2 py-2">
              <!-- Hour column -->
              <div
                ref="hourColRef"
                class="time-col h-44 snap-y snap-mandatory overflow-y-auto py-1"
              >
                <button
                  v-for="h in HOURS"
                  :key="h"
                  type="button"
                  :data-active="(draftHour === h && !!modelValue) || undefined"
                  :disabled="disabledHour(h)"
                  class="font-outfit block h-9 w-full snap-center rounded-[10px] text-sm font-semibold transition-colors"
                  :class="[
                    draftHour === h && !!modelValue
                      ? 'bg-gradient-to-br from-[#F15D22] to-[#E67E22] text-white shadow-sm'
                      : 'dark:hover:bg-primary-500/10 text-[var(--color-text)] hover:bg-[var(--tint-orange-8)] dark:text-gray-100',
                    disabledHour(h) && 'cursor-not-allowed opacity-25',
                  ]"
                  @click="selectHour(h)"
                >
                  {{ h }}
                </button>
              </div>

              <!-- Minute column -->
              <div
                ref="minuteColRef"
                class="time-col h-44 snap-y snap-mandatory overflow-y-auto py-1"
              >
                <button
                  v-for="m in MINUTES"
                  :key="m"
                  type="button"
                  :data-active="(draftMinute === m && !!modelValue) || undefined"
                  :disabled="disabledMinute(m)"
                  class="font-outfit block h-9 w-full snap-center rounded-[10px] text-sm font-semibold transition-colors"
                  :class="[
                    draftMinute === m && !!modelValue
                      ? 'bg-gradient-to-br from-[#F15D22] to-[#E67E22] text-white shadow-sm'
                      : m % 5 === 0
                        ? 'dark:hover:bg-primary-500/10 text-[var(--color-text)] hover:bg-[var(--tint-orange-8)] dark:text-gray-100'
                        : 'text-[var(--color-text-muted)] opacity-60 hover:bg-[var(--tint-orange-8)] hover:opacity-100 dark:text-gray-400',
                    disabledMinute(m) && 'cursor-not-allowed opacity-25',
                  ]"
                  @click="selectMinute(m)"
                >
                  {{ String(m).padStart(2, '0') }}
                </button>
              </div>

              <!-- AM/PM column — pills stacked, not a long list -->
              <div class="flex w-14 flex-col justify-center gap-1.5">
                <button
                  v-for="p in ['AM', 'PM'] as const"
                  :key="p"
                  type="button"
                  :disabled="disabledPeriod(p)"
                  class="font-outfit rounded-[12px] border-2 py-2 text-xs font-bold transition-all"
                  :class="[
                    draftPeriod === p && !!modelValue
                      ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 bg-[var(--tint-orange-8)]'
                      : 'border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-200',
                    disabledPeriod(p) && 'cursor-not-allowed opacity-40',
                  ]"
                  @click="selectPeriod(p)"
                >
                  {{ p }}
                </button>
              </div>
            </div>

            <!-- Footer: Now + Clear -->
            <div
              class="flex items-center justify-between border-t border-[var(--tint-slate-10)] px-3 py-1.5 dark:border-slate-700"
            >
              <button
                type="button"
                class="font-outfit text-primary-500 hover:text-primary-600 text-xs font-semibold transition-colors"
                @click="selectNow"
              >
                {{ t('time.now') }}
              </button>
              <button
                v-if="modelValue"
                type="button"
                class="font-outfit text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                @click="clearValue"
              >
                {{ t('time.clear') }}
              </button>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
/* Slim, themed scrollbar inside the hour/minute columns. */
.time-col {
  scrollbar-color: var(--tint-slate-10) transparent;
  scrollbar-width: thin;
}

.time-col::-webkit-scrollbar {
  width: 4px;
}

.time-col::-webkit-scrollbar-track {
  background: transparent;
}

.time-col::-webkit-scrollbar-thumb {
  background-color: var(--tint-slate-10);
  border-radius: 4px;
}

.time-col::-webkit-scrollbar-thumb:hover {
  background-color: rgb(44 62 80 / 15%);
}
</style>
