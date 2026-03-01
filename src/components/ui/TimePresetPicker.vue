<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  modelValue: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();

const isOpen = ref(false);
const showCustomInput = ref(false);
const customValue = ref('');
const dropdownRef = ref<HTMLElement | null>(null);
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

function toggleDropdown() {
  isOpen.value = !isOpen.value;
  showCustomInput.value = false;
}

function selectPreset(time: string) {
  emit('update:modelValue', time);
  isOpen.value = false;
  showCustomInput.value = false;
}

function openCustom() {
  showCustomInput.value = true;
  customValue.value = props.modelValue || '';
  nextTick(() => customInputRef.value?.focus());
}

function applyCustom() {
  if (/^\d{2}:\d{2}$/.test(customValue.value)) {
    const [h, m] = customValue.value.split(':').map(Number);
    if (h! >= 0 && h! <= 23 && m! >= 0 && m! <= 59) {
      emit('update:modelValue', customValue.value);
      isOpen.value = false;
      showCustomInput.value = false;
    }
  }
}

function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false;
    showCustomInput.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', handleClickOutside));
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <!-- Trigger button -->
    <button
      type="button"
      class="font-outfit flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
      :class="
        modelValue
          ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
      "
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

    <!-- Dropdown -->
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
        class="absolute left-0 z-50 mt-1.5 w-44 overflow-hidden rounded-2xl border border-[var(--tint-slate-10)] bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"
      >
        <!-- Custom time option (pinned at top) -->
        <div class="border-b border-[var(--tint-slate-10)] px-2 py-1.5 dark:border-slate-600">
          <button
            v-if="!showCustomInput"
            type="button"
            class="font-outfit text-primary-500 hover:bg-primary-500/5 w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors"
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
              class="font-outfit border-primary-500 flex-1 rounded-lg border-2 bg-white px-2 py-1 text-xs outline-none dark:bg-slate-700 dark:text-gray-200"
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
            class="font-outfit flex w-full items-center px-4 py-1.5 text-xs font-semibold transition-colors"
            :class="
              modelValue === time
                ? 'text-primary-500 dark:bg-primary-500/15 bg-[var(--tint-orange-8)]'
                : 'text-[var(--color-text)] hover:bg-[var(--tint-slate-5)] dark:text-gray-300 dark:hover:bg-slate-700'
            "
            @click="selectPreset(time)"
          >
            {{ to12h(time) }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
