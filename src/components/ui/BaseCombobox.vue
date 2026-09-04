<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

export interface ComboboxOption {
  value: string;
  /**
   * Single-line full label. Used as the search target, the trigger-button
   * display after selection, and the dropdown rendering when `rich` is
   * not provided. Keep this long enough that searching by any meaningful
   * substring (e.g. airport name) still matches.
   */
  label: string;
  /**
   * Optional structured rendering for the dropdown item. When present, the
   * dropdown shows a two-line item — primary text large, secondary text
   * smaller below, with an optional right-aligned monospace badge (e.g. an
   * IATA airport code). Trigger button + search behaviour are unchanged.
   * Use this for long disambiguation strings like
   *   "Singapore - Singapore Changi (SIN)" → primary "Singapore",
   *    secondary "Singapore Changi", badge "SIN".
   */
  rich?: {
    primary: string;
    secondary?: string;
    badge?: string;
  };
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
  /**
   * Max number of options actually rendered in the dropdown after filtering.
   * The filter still considers the full options list — this only caps DOM
   * node creation, which is the bottleneck on older / cheaper Android
   * devices when a callsite passes thousands of options (e.g. airports).
   * If the filtered count exceeds this cap, a "Showing N of M — keep typing"
   * footer hint is rendered. Set to a large number (or Infinity) for the
   * legacy "render everything" behaviour. Default 50.
   */
  maxVisibleResults?: number;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  required: false,
  placeholder: 'Select...',
  otherLabel: 'Other',
  otherPlaceholder: 'Enter name...',
  searchPlaceholder: 'Search...',
  maxVisibleResults: 50,
});

const { t } = useTranslation();

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
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const customInputRef = ref<HTMLInputElement | null>(null);

/**
 * Fixed-position style for the teleported dropdown popover. Computed from
 * the trigger's bounding rect — keeps the popover anchored to the trigger
 * regardless of where it lives in the DOM.
 *
 * Why teleport: when the combobox sits inside a modal/container with
 * `overflow: hidden` (rounded corners, etc.), an absolutely-positioned
 * dropdown gets clipped at the container's edge. Teleporting to `body`
 * + fixed positioning lets the popover float over the entire page.
 */
const popoverStyle = ref<Record<string, string>>({});

function updatePopoverPosition() {
  const trigger = triggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  // Default: open below the trigger. If there's not enough room (within 280px
  // of viewport bottom), flip upward so the dropdown stays fully visible.
  const dropdownMaxHeight = 280;
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < dropdownMaxHeight && rect.top > spaceBelow;
  popoverStyle.value = openUp
    ? {
        position: 'fixed',
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + 4}px`,
        width: `${rect.width}px`,
        maxHeight: `${Math.min(dropdownMaxHeight, rect.top - 16)}px`,
      }
    : {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.bottom + 4}px`,
        width: `${rect.width}px`,
        maxHeight: `${Math.min(dropdownMaxHeight, spaceBelow - 16)}px`,
      };
}

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

// Pre-built search index — caches lowercased label and uppercased rich.badge
// per option, rebuilt only when props.options reference changes. For static
// lists (e.g. AIRPORTS, 4046 entries) this is a one-shot cost on mount; per
// keystroke we then reuse the cached strings instead of re-lowercasing
// 4046 labels on every key event.
interface IndexedOption {
  option: ComboboxOption;
  searchKey: string;
  badgeUpper: string | null;
}
const searchIndex = computed<IndexedOption[]>(() => {
  const source = props.otherValue
    ? props.options.filter((o) => o.value !== props.otherValue)
    : props.options;
  return source.map((o) => ({
    option: o,
    searchKey: o.label.toLowerCase(),
    badgeUpper: o.rich?.badge?.toUpperCase() ?? null,
  }));
});

/**
 * Filter result: the full filtered set + the capped slice actually rendered.
 *
 * - Substring match on the pre-lowercased searchKey (cheap).
 * - Exact-`rich.badge` promotion (case-insensitive): if the trimmed,
 *   uppercased query exactly equals any indexed option's badgeUpper, that
 *   option is moved to position 0. So `SIN` and `sin` both surface
 *   Singapore Changi as the top match, even when many other labels contain
 *   the substring "sin" (Singen, Sincelejo, etc.).
 * - Cap: only `maxVisibleResults` items are returned in `items` (the v-for
 *   target). `totalCount` is the full match count, used by the hint footer.
 */
const filteredOptions = computed<{ items: ComboboxOption[]; totalCount: number }>(() => {
  const q = searchQuery.value.toLowerCase().trim();
  const upperQ = searchQuery.value.toUpperCase().trim();

  const matches = q
    ? searchIndex.value.filter((idx) => idx.searchKey.includes(q))
    : searchIndex.value.slice();

  if (upperQ) {
    const exactIdx = matches.findIndex((m) => m.badgeUpper === upperQ);
    if (exactIdx > 0) {
      matches.unshift(matches.splice(exactIdx, 1)[0]);
    }
  }

  const capped = matches.slice(0, props.maxVisibleResults).map((m) => m.option);
  return { items: capped, totalCount: matches.length };
});

const hintText = computed(() => {
  const { items, totalCount } = filteredOptions.value;
  if (totalCount <= items.length) return '';
  return t('combobox.showingHint')
    .replace('{visible}', String(items.length))
    .replace('{total}', String(totalCount));
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
  // Reposition popover when the trigger moves (window resize) or the page
  // scrolls. Listeners are passive — no perf cost when popover is closed
  // because `updatePopoverPosition` early-returns if the trigger isn't there.
  window.addEventListener('resize', updatePopoverPosition);
  window.addEventListener('scroll', updatePopoverPosition, true);
});

onUnmounted(() => {
  // happy-dom (test env) tears down `document` / `window` before async unmount
  // hooks fire when a Vue test wrapper is unmounted via teleport. Guard so the
  // teardown doesn't throw an unhandled rejection that fails CI.
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('keydown', handleKeydown);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updatePopoverPosition);
    window.removeEventListener('scroll', updatePopoverPosition, true);
  }
});

function handleClickOutside(event: MouseEvent) {
  // Popover is teleported to body, so `dropdownRef` (the trigger's wrapper)
  // doesn't contain it. Check both the trigger wrapper AND the popover so
  // clicks inside either don't dismiss.
  const target = event.target as Node;
  const inTrigger = dropdownRef.value?.contains(target) ?? false;
  const inPopover = popoverRef.value?.contains(target) ?? false;
  if (!inTrigger && !inPopover) {
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
  // Compute position synchronously (trigger rect available now) AND on next
  // tick (after popover renders, in case the size shifts). Both keep things
  // robust on slower devices where layout-thrashes can desync.
  updatePopoverPosition();
  nextTick(() => {
    updatePopoverPosition();
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
    <label
      v-if="label"
      class="font-outfit dark:text-ink-soft block text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
    </label>

    <!-- Trigger button -->
    <button
      ref="triggerRef"
      type="button"
      data-testid="combobox-trigger"
      class="flex w-full items-center justify-between rounded-[16px] border-2 border-transparent px-4 py-3 text-left transition-all duration-200 focus:outline-none"
      :class="[
        error
          ? 'border-red-500 focus:border-red-500'
          : 'focus:border-primary-500 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        'dark:bg-surface-overlay bg-[var(--tint-slate-5)]',
      ]"
      :disabled="disabled"
      @click="toggleDropdown"
    >
      <span
        class="font-outfit flex-1 truncate text-sm font-semibold"
        :class="
          hasSelection
            ? 'dark:text-ink text-[var(--color-text)]'
            : 'text-[var(--color-text-muted)] opacity-30'
        "
      >
        {{ displayText }}
      </span>
      <div class="ml-2 flex items-center gap-1">
        <!-- Custom badge -->
        <span
          v-if="isOtherMode && customText"
          class="dark:bg-surface-overlay dark:text-ink-soft rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
        >
          {{ t('combobox.custom') }}
        </span>
        <!-- Clear button -->
        <button
          v-if="hasSelection && !disabled"
          type="button"
          data-testid="combobox-clear"
          class="dark:hover:text-ink-soft rounded p-0.5 text-gray-400 hover:text-gray-600"
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
      class="focus:border-primary-500 font-outfit dark:bg-surface-overlay dark:text-ink block w-full rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 text-base font-semibold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none"
      :placeholder="otherPlaceholder"
      @blur="handleCustomBlur"
      @keydown="handleCustomKeydown"
    />

    <!-- Dropdown — teleported to body so containers with overflow:hidden
         (e.g. modals with rounded corners) don't clip it. Uses fixed
         positioning anchored to the trigger via getBoundingClientRect.
         See `updatePopoverPosition` for the math. -->
    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="popoverRef"
        data-testid="combobox-dropdown"
        :style="popoverStyle"
        class="dark:border-line dark:bg-surface-raised z-[9999] overflow-y-auto rounded-[16px] border border-gray-200 bg-white shadow-lg"
      >
        <!-- Search input. z-10 keeps the sticky header above scrolled options
             (without it, options scroll on top of the bg-white search wrapper). -->
        <div
          class="dark:border-line dark:bg-surface-raised sticky top-0 z-10 border-b border-gray-100 bg-white p-2"
        >
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            data-testid="combobox-search"
            class="focus:border-primary-500 focus:ring-primary-500 dark:border-line-strong dark:bg-surface-ground dark:text-ink w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-base text-gray-900 focus:ring-1 focus:outline-none"
            :placeholder="searchPlaceholder"
            @keydown.stop
          />
        </div>

        <!-- Options list -->
        <div class="py-1">
          <button
            v-for="option in filteredOptions.items"
            :key="option.value"
            type="button"
            :data-testid="`combobox-option-${option.value}`"
            class="dark:hover:bg-surface-hover flex w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-gray-100"
            :class="[
              option.rich ? 'py-2.5' : 'py-2',
              option.value === modelValue && !isOtherMode
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-accent-lift'
                : 'dark:text-ink-soft text-gray-700',
            ]"
            @click="selectOption(option)"
          >
            <!-- Rich (two-line) layout: primary + optional secondary + optional right-aligned badge -->
            <div v-if="option.rich" class="flex min-w-0 flex-1 flex-col gap-0.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-outfit truncate font-semibold">{{ option.rich.primary }}</span>
                <span
                  v-if="option.rich.badge"
                  class="flex-shrink-0 font-mono text-[0.6875rem] font-semibold tracking-wider opacity-60"
                >
                  {{ option.rich.badge }}
                </span>
              </div>
              <span
                v-if="option.rich.secondary"
                class="truncate text-xs leading-snug opacity-55 dark:opacity-50"
              >
                {{ option.rich.secondary }}
              </span>
            </div>
            <!-- Plain (single-line) fallback — existing behaviour for any consumer that hasn't opted into rich -->
            <span v-else class="flex-1 truncate">{{ option.label }}</span>
            <span v-if="option.isCustom" class="flex items-center gap-1">
              <span
                class="dark:bg-surface-overlay dark:text-ink-soft rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
              >
                {{ t('combobox.custom') }}
              </span>
              <button
                type="button"
                :data-testid="`combobox-remove-${option.value}`"
                class="dark:hover:text-danger-lift rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                :title="t('combobox.removeCustom')"
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
              class="text-primary-600 dark:text-accent-lift h-4 w-4 flex-shrink-0"
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
            v-if="filteredOptions.items.length === 0"
            class="dark:text-ink-soft px-3 py-2 text-sm text-gray-500"
          >
            {{ t('combobox.noResults') }}
          </div>

          <!-- Cap hint — shown when the filtered match count exceeds the
               rendered cap, telling the user to keep typing to narrow.
               Sized small + muted so it doesn't compete with options. -->
          <div
            v-if="hintText"
            class="font-outfit dark:border-line dark:text-ink-soft border-t border-gray-100 px-3 py-2 text-center text-xs text-gray-500 italic"
            data-testid="combobox-cap-hint"
          >
            {{ hintText }}
          </div>

          <!-- "Other" option -->
          <button
            v-if="otherValue"
            type="button"
            data-testid="combobox-other"
            class="dark:border-line dark:hover:bg-surface-hover flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100"
            :class="
              isOtherMode
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-accent-lift'
                : 'dark:text-ink-soft text-gray-500'
            "
            @click="selectOther"
          >
            <span class="flex-1">{{ otherLabel }}</span>
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Error/Hint -->
    <p v-if="error" class="dark:text-danger-lift text-sm text-red-600">
      {{ error }}
    </p>
    <p v-else-if="hint" class="dark:text-ink-soft text-sm text-gray-500">
      {{ hint }}
    </p>
  </div>
</template>
