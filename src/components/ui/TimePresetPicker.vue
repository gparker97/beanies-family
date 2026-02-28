<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  modelValue: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();

const showCustom = ref(false);
const customValue = ref('');

const presets = [
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
];

function to12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const period = h! >= 12 ? 'PM' : 'AM';
  const hour12 = h! === 0 ? 12 : h! > 12 ? h! - 12 : h!;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

const isCustomTime = computed(() => {
  return props.modelValue && !presets.includes(props.modelValue);
});

function selectPreset(time: string) {
  showCustom.value = false;
  emit('update:modelValue', time);
}

function openCustom() {
  showCustom.value = true;
  customValue.value = props.modelValue || '';
}

function applyCustom() {
  if (/^\d{2}:\d{2}$/.test(customValue.value)) {
    const [h, m] = customValue.value.split(':').map(Number);
    if (h! >= 0 && h! <= 23 && m! >= 0 && m! <= 59) {
      emit('update:modelValue', customValue.value);
      showCustom.value = false;
    }
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="time in presets"
      :key="time"
      type="button"
      class="font-outfit rounded-full px-2.5 py-1 text-[0.6rem] font-semibold transition-all duration-150"
      :class="
        modelValue === time
          ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
      "
      @click="selectPreset(time)"
    >
      {{ to12h(time) }}
    </button>

    <!-- Custom time button / input -->
    <button
      v-if="!showCustom"
      type="button"
      class="font-outfit rounded-full px-2.5 py-1 text-[0.6rem] font-semibold transition-all duration-150"
      :class="
        isCustomTime
          ? 'border-primary-500 text-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'hover:border-primary-400 border-2 border-dashed border-gray-300 text-[var(--color-text-muted)] dark:border-slate-600 dark:text-gray-400'
      "
      @click="openCustom"
    >
      {{ isCustomTime ? to12h(modelValue) : `+ ${t('modal.customTime')}` }}
    </button>

    <div v-if="showCustom" class="flex items-center gap-1.5">
      <input
        v-model="customValue"
        type="time"
        class="font-outfit border-primary-500 rounded-lg border-2 bg-white px-2 py-0.5 text-[0.7rem] outline-none dark:bg-slate-800 dark:text-gray-200"
        @keydown.enter="applyCustom"
      />
      <button
        type="button"
        class="font-outfit bg-primary-500 rounded-lg px-2 py-0.5 text-[0.6rem] font-semibold text-white"
        @click="applyCustom"
      >
        OK
      </button>
    </div>
  </div>
</template>
