<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface Option {
  value: string;
  label: string;
  color?: string;
}

interface Props {
  modelValue: string[];
  options: Option[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  minSelection?: number;
  allSelectedLabel?: string;
  countLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  minSelection: 1,
  allSelectedLabel: 'All Selected',
  countLabel: 'selected',
});

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const isOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const isAllSelected = computed(() =>
  props.modelValue.length === props.options.length && props.options.length > 0
);

const displayText = computed(() => {
  if (props.modelValue.length === 0) {
    return props.placeholder || 'Select...';
  }
  if (isAllSelected.value) {
    return props.allSelectedLabel;
  }
  return `${props.modelValue.length} ${props.countLabel}`;
});

function toggleDropdown() {
  if (!props.disabled) {
    isOpen.value = !isOpen.value;
  }
}

function closeDropdown() {
  isOpen.value = false;
}

function isSelected(value: string): boolean {
  return props.modelValue.includes(value);
}

function canDeselect(): boolean {
  return props.modelValue.length > props.minSelection;
}

function toggleOption(value: string) {
  const currentlySelected = isSelected(value);

  if (currentlySelected) {
    // Check if we can deselect (minimum selection constraint)
    if (!canDeselect()) {
      return;
    }
    emit('update:modelValue', props.modelValue.filter(v => v !== value));
  } else {
    emit('update:modelValue', [...props.modelValue, value]);
  }
}

function selectAll() {
  emit('update:modelValue', props.options.map(o => o.value));
}

// Click outside handler
function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown();
  }
}

// Keyboard handler
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeDropdown();
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div ref="dropdownRef" class="relative min-w-[140px]">
    <!-- Label -->
    <label
      v-if="label"
      class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
    >
      {{ label }}
    </label>

    <!-- Trigger button -->
    <button
      type="button"
      class="flex items-center justify-between w-full rounded-lg border px-3 py-2 text-left bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 transition-colors"
      :class="[
        disabled
          ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-slate-900 border-gray-300 dark:border-slate-600'
          : 'cursor-pointer border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500 focus:border-blue-500 focus:ring-blue-200 dark:focus:ring-blue-900',
      ]"
      :disabled="disabled"
      @click="toggleDropdown"
    >
      <span
        class="truncate"
        :class="modelValue.length === 0 ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'"
      >
        {{ displayText }}
      </span>
      <svg
        class="w-4 h-4 text-gray-400 flex-shrink-0 ml-2 transition-transform"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-if="isOpen"
      class="absolute z-50 mt-1 min-w-full w-max bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 max-h-64 overflow-y-auto"
    >
      <!-- Select All button -->
      <button
        v-if="!isAllSelected && options.length > 1"
        type="button"
        class="w-full px-3 py-2 text-left text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors border-b border-gray-100 dark:border-slate-700"
        @click="selectAll"
      >
        Select All
      </button>

      <!-- Options -->
      <div
        v-for="option in options"
        :key="option.value"
        class="flex items-center gap-3 px-3 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer transition-colors"
        :class="{
          'opacity-50 cursor-not-allowed': isSelected(option.value) && !canDeselect(),
        }"
        @click="toggleOption(option.value)"
      >
        <!-- Checkbox -->
        <div
          class="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
          :class="
            isSelected(option.value)
              ? 'bg-blue-600 border-blue-600'
              : 'border-gray-300 dark:border-slate-600'
          "
        >
          <svg
            v-if="isSelected(option.value)"
            class="w-3 h-3 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <!-- Color indicator (optional) -->
        <div
          v-if="option.color"
          class="w-3 h-3 rounded-full flex-shrink-0"
          :style="{ backgroundColor: option.color }"
        />

        <!-- Label -->
        <span class="text-sm text-gray-700 dark:text-gray-300 truncate">
          {{ option.label }}
        </span>
      </div>

      <!-- Empty state -->
      <div
        v-if="options.length === 0"
        class="px-3 py-2 text-sm text-gray-500 dark:text-gray-400"
      >
        No options available
      </div>
    </div>
  </div>
</template>
