<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { useAnchoredPopover } from '@/composables/useAnchoredPopover';
import { useTranslation } from '@/composables/useTranslation';
import { isWallClockTime } from '@/utils/date';

interface Props {
  modelValue: string;
  /**
   * Show a clear (✕) beside the pill while a time is set, emitting `''`. A SIBLING of the
   * trigger, never nested in it (a button inside a button is invalid and steals its clicks).
   */
  clearable?: boolean;
}

const props = withDefaults(defineProps<Props>(), { clearable: false });

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();

const showCustomInput = ref(false);
const customValue = ref('');
const dropdownRef = ref<HTMLElement | undefined>();
const triggerRef = ref<HTMLElement | undefined>();
const popoverRef = ref<HTMLElement | null>(null);
const customInputRef = ref<HTMLInputElement | null>(null);

// 30-min intervals from 07:00 to 22:00
const presets = [
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
  '22:00',
];

function to12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const period = h! >= 12 ? 'PM' : 'AM';
  const hour12 = h! === 0 ? 12 : h! > 12 ? h! - 12 : h!;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

const displayLabel = computed(() => {
  if (!props.modelValue) return t('modal.selectTime');
  return to12h(props.modelValue);
});

const isCustomTime = computed(() => {
  return props.modelValue && !presets.includes(props.modelValue);
});

// The list is teleported + fixed-positioned (useAnchoredPopover) so a clipping host can't cut it
// off: an inline `absolute` list inside a `ConditionalSection` (overflow-hidden), as in the card
// reminder box (#123), opened invisibly below the section's edge. The composable also sets the
// z tier, so the list shows above the onboarding overlay and every modal layer. Focusing the
// active preset on open also scrolls the list to it; with no matching preset (a custom or empty
// time) focus lands on the Custom row, which is the first menu item, so Enter does not pick 7 AM.
const {
  show: isOpen,
  popoverStyle,
  close,
  toggle: toggleDropdown,
  onMenuKeydown,
} = useAnchoredPopover({
  anchorRef: dropdownRef,
  triggerRef,
  popoverRef,
  itemSelector: '[data-time-custom], [data-time-preset]',
  // Item 0 is the Custom row, so a preset's item index is its list index + 1, and no match
  // (indexOf -1) lands on 0, the Custom row.
  initialFocusIndex: () => presets.indexOf(props.modelValue) + 1,
  align: 'start',
  widthEstimate: 176,
  heightEstimate: 240,
});

// Every close (select, outside click, Escape) reopens on the preset list, not the custom input.
watch(isOpen, (open) => {
  if (!open) showCustomInput.value = false;
});

function clearTime() {
  emit('update:modelValue', '');
  close();
}

function selectPreset(time: string) {
  emit('update:modelValue', time);
  close(true);
}

function openCustom() {
  showCustomInput.value = true;
  customValue.value = props.modelValue || '';
  nextTick(() => customInputRef.value?.focus());
}

function applyCustom() {
  if (isWallClockTime(customValue.value)) {
    emit('update:modelValue', customValue.value);
    close(true);
  }
}
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <div class="flex items-center gap-1">
      <!-- Trigger button -->
      <button
        ref="triggerRef"
        type="button"
        class="font-outfit flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
        :class="
          modelValue
            ? 'border-primary-500 text-primary-500 dark:text-accent-lift dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
            : 'dark:bg-surface-overlay dark:text-ink-soft border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
        "
        data-testid="time-preset-picker-trigger"
        @click="toggleDropdown"
      >
        <span>{{ displayLabel }}</span>
        <svg
          class="h-3 w-3 transition-transform"
          :class="{ 'rotate-180': isOpen }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="2.5"
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <button
        v-if="clearable && modelValue"
        type="button"
        data-testid="time-preset-picker-clear"
        :aria-label="t('time.clearAriaLabel')"
        class="dark:text-ink-soft dark:hover:bg-surface-hover flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-10)]"
        @click="clearTime"
      >
        <svg
          class="h-3 w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="2.5"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Dropdown (teleported: see useAnchoredPopover above) -->
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
          data-testid="time-preset-picker-list"
          class="dark:border-line-strong dark:bg-surface-raised w-44 overflow-hidden rounded-2xl border border-[var(--tint-slate-10)] bg-white shadow-lg"
          @keydown="onMenuKeydown"
        >
          <!-- Custom time option (pinned at top) -->
          <div class="dark:border-line-strong border-b border-[var(--tint-slate-10)] px-2 py-1.5">
            <button
              v-if="!showCustomInput"
              type="button"
              data-time-custom
              class="font-outfit text-primary-500 dark:text-accent-lift hover:bg-primary-500/5 w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors"
              :class="isCustomTime ? 'dark:bg-primary-500/15 bg-[var(--tint-orange-8)]' : ''"
              @click="openCustom"
            >
              {{
                isCustomTime
                  ? `${t('modal.customTime')}: ${to12h(modelValue)}`
                  : `+ ${t('modal.customTime')}`
              }}
            </button>
            <div v-else class="flex items-center gap-1.5">
              <input
                ref="customInputRef"
                v-model="customValue"
                type="time"
                class="font-outfit border-primary-500 dark:bg-surface-overlay dark:text-ink flex-1 rounded-lg border-2 bg-white px-2 py-1 text-base outline-none"
                @keydown.enter="applyCustom"
              />
              <button
                type="button"
                class="font-outfit bg-primary-500 rounded-lg px-2.5 py-1 text-xs font-semibold text-white"
                @click="applyCustom"
              >
                OK
              </button>
            </div>
          </div>

          <!-- Scrollable time list -->
          <div class="max-h-48 overflow-y-auto py-1">
            <button
              v-for="time in presets"
              :key="time"
              type="button"
              data-time-preset
              class="font-outfit flex w-full items-center px-4 py-1.5 text-xs font-semibold transition-colors"
              :class="
                modelValue === time
                  ? 'text-primary-500 dark:text-accent-lift dark:bg-primary-500/15 bg-[var(--tint-orange-8)]'
                  : 'dark:text-ink-soft dark:hover:bg-surface-hover text-[var(--color-text)] hover:bg-[var(--tint-slate-5)]'
              "
              @click="selectPreset(time)"
            >
              {{ to12h(time) }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
