<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface Option {
  value: string;
  label: string;
  color?: string;
  [key: string]: unknown;
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
  /** Remove border, background and padding from trigger button */
  borderless?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  minSelection: 1,
  allSelectedLabel: 'All Selected',
  countLabel: 'selected',
  borderless: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const isOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const isAllSelected = computed(
  () => props.modelValue.length === props.options.length && props.options.length > 0
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
    emit(
      'update:modelValue',
      props.modelValue.filter((v) => v !== value)
    );
  } else {
    emit('update:modelValue', [...props.modelValue, value]);
  }
}

function selectAll() {
  emit(
    'update:modelValue',
    props.options.map((o) => o.value)
  );
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
  <div ref="dropdownRef" :class="borderless ? 'relative' : 'relative min-w-[140px]'">
    <!-- Label -->
    <label v-if="label" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
    </label>

    <!-- Trigger button -->
    <button
      type="button"
      class="flex items-center text-left transition-colors focus:outline-none"
      :class="[
        borderless
          ? 'cursor-pointer gap-1 rounded-xl py-1 hover:bg-gray-100 dark:hover:bg-slate-700'
          : [
              'w-full justify-between rounded-lg border bg-white px-3 py-2 focus:ring-2 dark:bg-slate-800',
              disabled
                ? 'cursor-not-allowed border-gray-300 bg-gray-50 opacity-50 dark:border-slate-600 dark:bg-slate-900'
                : 'cursor-pointer border-gray-300 hover:border-gray-400 focus:border-blue-500 focus:ring-blue-200 dark:border-slate-600 dark:hover:border-slate-500 dark:focus:ring-blue-900',
            ],
      ]"
      :disabled="disabled"
      @click="toggleDropdown"
    >
      <slot
        name="trigger"
        :is-all-selected="isAllSelected"
        :selected-count="modelValue.length"
        :display-text="displayText"
        :is-open="isOpen"
        :selected-values="modelValue"
      >
        <span
          class="truncate"
          :class="modelValue.length === 0 ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'"
        >
          {{ displayText }}
        </span>
      </slot>
      <svg
        class="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform"
        :class="[{ 'rotate-180': isOpen }, borderless ? '' : 'ml-2']"
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
      class="absolute z-50 mt-1 max-h-64 w-max min-w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      <!-- Select All button -->
      <button
        v-if="!isAllSelected && options.length > 1"
        type="button"
        class="w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-blue-600 transition-colors hover:bg-gray-100 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-700"
        @click="selectAll"
      >
        Select All
      </button>

      <!-- Options -->
      <div
        v-for="option in options"
        :key="option.value"
        class="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
        :class="{
          'cursor-not-allowed opacity-50': isSelected(option.value) && !canDeselect(),
        }"
        @click="toggleOption(option.value)"
      >
        <!-- Checkbox -->
        <div
          class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border"
          :class="
            isSelected(option.value)
              ? 'border-blue-600 bg-blue-600'
              : 'border-gray-300 dark:border-slate-600'
          "
        >
          <svg
            v-if="isSelected(option.value)"
            class="h-3 w-3 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="3"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <!-- Option content (slottable) -->
        <slot name="option" :option="option" :is-selected="isSelected(option.value)">
          <!-- Color indicator (optional) -->
          <div
            v-if="option.color"
            class="h-3 w-3 flex-shrink-0 rounded-full"
            :style="{ backgroundColor: option.color }"
          />

          <!-- Label -->
          <span class="truncate text-sm text-gray-700 dark:text-gray-300">
            {{ option.label }}
          </span>
        </slot>
      </div>

      <!-- Empty state -->
      <div v-if="options.length === 0" class="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
        No options available
      </div>
    </div>
  </div>
</template>
