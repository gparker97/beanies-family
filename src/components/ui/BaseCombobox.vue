<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';

export interface ComboboxOption {
  value: string;
  label: string;
  isCustom?: boolean;
}

interface Props {
  modelValue: string | undefined;
  options: ComboboxOption[];
  label?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  otherValue?: string;
  otherLabel?: string;
  otherPlaceholder?: string;
  searchPlaceholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  required: false,
  placeholder: 'Select...',
  otherLabel: 'Other',
  otherPlaceholder: 'Enter name...',
  searchPlaceholder: 'Search...',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'custom-added': [name: string];
  'custom-removed': [name: string];
}>();

const isOpen = ref(false);
const searchQuery = ref('');
const customText = ref('');
const isOtherMode = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const customInputRef = ref<HTMLInputElement | null>(null);

// Check if the current modelValue matches any option
const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue));

const displayText = computed(() => {
  if (isOtherMode.value) {
    return customText.value || props.placeholder;
  }
  return selectedOption.value?.label || props.modelValue || props.placeholder;
});

const hasSelection = computed(() => {
  return isOtherMode.value ? !!customText.value : !!props.modelValue;
});

// Filter options by search query (excluding the "Other" sentinel)
const filteredOptions = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  const regularOptions = props.otherValue
    ? props.options.filter((o) => o.value !== props.otherValue)
    : props.options;

  if (!q) return regularOptions;

  return regularOptions.filter((o) => o.label.toLowerCase().includes(q));
});

// On mount, check backward compat: if modelValue doesn't match any option, enter other mode
function checkBackwardCompat() {
  if (
    props.modelValue &&
    props.otherValue &&
    !props.options.some((o) => o.value === props.modelValue)
  ) {
    isOtherMode.value = true;
    customText.value = props.modelValue;
  }
}

watch(
  () => props.modelValue,
  () => {
    checkBackwardCompat();
  }
);

onMounted(() => {
  checkBackwardCompat();
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
});

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeDropdown();
  }
}

function toggleDropdown() {
  if (props.disabled) return;
  if (isOpen.value) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function openDropdown() {
  isOpen.value = true;
  searchQuery.value = '';
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function closeDropdown() {
  isOpen.value = false;
  searchQuery.value = '';
}

function selectOption(option: ComboboxOption) {
  isOtherMode.value = false;
  customText.value = '';
  emit('update:modelValue', option.value);
  closeDropdown();
}

function selectOther() {
  isOtherMode.value = true;
  customText.value = '';
  emit('update:modelValue', '');
  closeDropdown();
  nextTick(() => {
    customInputRef.value?.focus();
  });
}

function confirmCustom() {
  const trimmed = customText.value.trim();
  if (trimmed) {
    emit('update:modelValue', trimmed);
    emit('custom-added', trimmed);
  }
}

function handleCustomBlur() {
  confirmCustom();
}

function handleCustomKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    confirmCustom();
    customInputRef.value?.blur();
  }
}

function removeCustomOption(option: ComboboxOption) {
  // If the currently selected value matches, clear selection
  if (props.modelValue === option.value) {
    isOtherMode.value = false;
    customText.value = '';
    emit('update:modelValue', '');
  }
  emit('custom-removed', option.value);
}

function clearSelection() {
  isOtherMode.value = false;
  customText.value = '';
  emit('update:modelValue', '');
}
</script>

<template>
  <div ref="dropdownRef" class="relative space-y-1">
    <!-- Label -->
    <label v-if="label" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
    </label>

    <!-- Trigger button -->
    <button
      type="button"
      data-testid="combobox-trigger"
      class="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors focus:ring-2 focus:outline-none"
      :class="[
        error
          ? 'border-red-500 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-900'
          : 'focus:border-primary-500 focus:ring-sky-silk-100 dark:focus:ring-primary-700 border-gray-300 dark:border-slate-600',
        disabled
          ? 'cursor-not-allowed bg-gray-50 opacity-50 dark:bg-slate-900'
          : 'cursor-pointer bg-white hover:border-gray-400 dark:bg-slate-800 dark:hover:border-slate-500',
      ]"
      :disabled="disabled"
      @click="toggleDropdown"
    >
      <span
        class="flex-1 truncate"
        :class="hasSelection ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'"
      >
        {{ displayText }}
      </span>
      <div class="ml-2 flex items-center gap-1">
        <!-- Custom badge -->
        <span
          v-if="isOtherMode && customText"
          class="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-slate-700 dark:text-gray-400"
        >
          Custom
        </span>
        <!-- Clear button -->
        <button
          v-if="hasSelection && !disabled"
          type="button"
          data-testid="combobox-clear"
          class="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          @click.stop="clearSelection"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
        <!-- Chevron -->
        <svg
          class="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform"
          :class="{ 'rotate-180': isOpen }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </button>

    <!-- Custom text input (shown when "Other" is selected) -->
    <input
      v-if="isOtherMode"
      ref="customInputRef"
      v-model="customText"
      type="text"
      data-testid="combobox-custom-input"
      class="focus:border-primary-500 focus:ring-sky-silk-100 dark:focus:ring-primary-700 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 transition-colors focus:ring-2 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
      :placeholder="otherPlaceholder"
      @blur="handleCustomBlur"
      @keydown="handleCustomKeydown"
    />

    <!-- Dropdown -->
    <div
      v-if="isOpen"
      data-testid="combobox-dropdown"
      class="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      <!-- Search input -->
      <div
        class="sticky top-0 border-b border-gray-100 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"
      >
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          data-testid="combobox-search"
          class="focus:border-primary-500 focus:ring-primary-500 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 focus:ring-1 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
          :placeholder="searchPlaceholder"
          @keydown.stop
        />
      </div>

      <!-- Options list -->
      <div class="py-1">
        <button
          v-for="option in filteredOptions"
          :key="option.value"
          type="button"
          :data-testid="`combobox-option-${option.value}`"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
          :class="
            option.value === modelValue && !isOtherMode
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
              : 'text-gray-700 dark:text-gray-300'
          "
          @click="selectOption(option)"
        >
          <span class="flex-1 truncate">{{ option.label }}</span>
          <span v-if="option.isCustom" class="flex items-center gap-1">
            <span
              class="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-slate-700 dark:text-gray-400"
            >
              Custom
            </span>
            <button
              type="button"
              :data-testid="`combobox-remove-${option.value}`"
              class="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title="Remove custom institution"
              @click.stop="removeCustomOption(option)"
            >
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </span>
          <!-- Checkmark for selected -->
          <svg
            v-if="option.value === modelValue && !isOtherMode"
            class="text-primary-600 dark:text-primary-400 h-4 w-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </button>

        <!-- Empty state -->
        <div
          v-if="filteredOptions.length === 0"
          class="px-3 py-2 text-sm text-gray-500 dark:text-gray-400"
        >
          No results found
        </div>

        <!-- "Other" option -->
        <button
          v-if="otherValue"
          type="button"
          data-testid="combobox-other"
          class="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:border-slate-700 dark:hover:bg-slate-700"
          :class="
            isOtherMode
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
              : 'text-gray-500 dark:text-gray-400'
          "
          @click="selectOther"
        >
          <span class="flex-1">{{ otherLabel }}</span>
        </button>
      </div>
    </div>

    <!-- Error/Hint -->
    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>
    <p v-else-if="hint" class="text-sm text-gray-500 dark:text-gray-400">
      {{ hint }}
    </p>
  </div>
</template>
