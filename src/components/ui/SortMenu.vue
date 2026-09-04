<script setup lang="ts" generic="T extends string">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * One row of the menu. `labelKey` is a translation key, not a string: the menu is shared
 * across surfaces and every one of them must localise (ADR-008).
 */
export interface SortMenuOption<T extends string = string> {
  value: T;
  labelKey: UIStringKey;
  /** Decorative leading glyph. */
  icon: string;
}

/**
 * A sort/choice popover: a trigger naming the current selection, and a teleported menu.
 *
 * Generalised out of the To-Do sort menu when the cookbook needed the same control. It is
 * ~190 lines of teleport + getBoundingClientRect + drop-up + viewport clamp + roving focus +
 * escape/click-outside, and re-implementing that a second time would have been the single
 * largest duplication in the cookbook work. The to-do-specific component was deleted rather
 * than left as a pass-through wrapper — a wrapper IS the duplication.
 *
 * Fully-controlled: reads `modelValue` directly, emits on change. No internal mirror ref
 * (which could desync from the parent's persisted value).
 */
const props = defineProps<{
  modelValue: T;
  options: readonly SortMenuOption<T>[];
  /** Names the control on the trigger and as the menu's accessible name. */
  triggerLabelKey: UIStringKey;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T] }>();

const { t } = useTranslation();

const show = ref(false);
const el = ref<HTMLElement>();
const triggerRef = ref<HTMLButtonElement>();
const popoverRef = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const POPOVER_WIDTH = 208;
const POPOVER_HEIGHT_ESTIMATE = 156;

const activeLabel = computed(() => {
  const option = props.options.find((o) => o.value === props.modelValue) ?? props.options[0];
  // An empty `options` is a caller bug, not a runtime state to render around — but it must not
  // blank the trigger silently, so say so where a developer will see it.
  if (!option) {
    console.warn('[SortMenu] rendered with no options — the trigger will show no current value');
    return '';
  }
  return t(option.labelKey);
});

// ── Open / position ────────────────────────────────────────────────
// Teleported + fixed-position so a clipping/scrolling ancestor can't cut the
// menu off (the overflow-safe idiom proven on AssigneePickerButton 2026-05-21).
// TODO(consolidation): 6 components now share this teleport + getBoundingClientRect
// + drop-up + viewport-clamp + scroll/resize popover idiom (AssigneePickerButton,
// BaseCombobox, BeanieDatePicker, BeanieTimeInput, InfoHintBadge, SortMenu).
// A dedicated refactor should extract a shared composable/primitive designed
// against all six — deliberately out of scope for this change.
function positionPopover() {
  if (!el.value) return;
  const rect = el.value.getBoundingClientRect();
  const height = popoverRef.value?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;
  const width = popoverRef.value?.offsetWidth ?? POPOVER_WIDTH;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - rect.bottom;

  // Flip up when there isn't room below but there is above.
  const dropUp = spaceBelow < height + 16 && rect.top > height + 16;
  const top = dropUp ? rect.top - height - 6 : rect.bottom + 6;

  // Anchor the menu's right edge to the trigger's right edge, then clamp to the
  // viewport so a trigger near the edge can't push the menu off-screen.
  let left = rect.right - width;
  if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
  if (left < MARGIN) left = MARGIN;

  popoverStyle.value = {
    position: 'fixed',
    top: `${Math.max(MARGIN, top)}px`,
    left: `${left}px`,
  };
}

function menuItems(): HTMLButtonElement[] {
  if (!popoverRef.value) return [];
  return Array.from(popoverRef.value.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
}

function open() {
  show.value = true;
  nextTick(() => {
    positionPopover();
    // Move focus to the active option so keyboard users land on the current sort.
    const items = menuItems();
    const activeIdx = Math.max(
      0,
      props.options.findIndex((o) => o.value === props.modelValue)
    );
    items[activeIdx]?.focus();
  });
}

function close(returnFocus = false) {
  show.value = false;
  if (returnFocus) nextTick(() => triggerRef.value?.focus());
}

function toggle() {
  if (show.value) close();
  else open();
}

function select(value: T) {
  emit('update:modelValue', value);
  close(true);
}

function onMenuKeydown(e: KeyboardEvent) {
  const items = menuItems();
  if (items.length === 0) return;
  const currentIdx = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[currentIdx < 0 ? 0 : (currentIdx + 1) % items.length]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[
      currentIdx < 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length
    ]?.focus();
  }
}

// ── Dismiss wiring (reuse useEscapeClose; single click-outside handler) ──
useEscapeClose(show, () => close(true));

function onDocClick(e: MouseEvent) {
  const target = e.target as Node;
  // The menu is teleported to <body>, so it's outside `el` — check it too.
  if (el.value?.contains(target) || popoverRef.value?.contains(target)) return;
  show.value = false;
}

function handleViewportChange() {
  if (show.value) positionPopover();
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
});
</script>

<template>
  <div ref="el" class="relative shrink-0">
    <!-- Trigger: bordered, icon-led button that names the current sort. -->
    <button
      ref="triggerRef"
      type="button"
      class="dark:border-line-strong dark:bg-surface-raised flex items-center gap-2 rounded-2xl border border-gray-200 bg-white py-1.5 pr-2.5 pl-1.5 shadow-[var(--card-shadow)] transition-colors hover:border-[#F15D22]"
      aria-haspopup="menu"
      :aria-expanded="show ? 'true' : 'false'"
      @click.stop="toggle"
    >
      <span
        class="dark:text-accent-lift flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--tint-orange-8)] text-sm text-[#F15D22]"
        aria-hidden="true"
        >⇅</span
      >
      <span class="font-outfit text-xs text-[var(--color-text-muted)]">
        {{ t(triggerLabelKey) }}
        <span class="text-sm font-semibold text-[var(--color-text)]">{{ activeLabel }}</span>
      </span>
      <span
        class="font-outfit text-[0.5rem] text-[var(--color-text-muted)] transition-transform"
        :class="{ 'rotate-180': show }"
        aria-hidden="true"
        >▾</span
      >
    </button>

    <!-- Menu — teleported to <body> so clipping/scrolling ancestors can't cut
         it off; positioned via fixed coords from positionPopover(). -->
    <Teleport to="body">
      <div
        v-if="show"
        ref="popoverRef"
        :style="popoverStyle"
        role="menu"
        :aria-label="t(triggerLabelKey)"
        class="dark:border-line-strong dark:bg-surface-raised z-50 min-w-[12rem] rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[var(--soft-shadow)]"
        @click.stop
        @keydown="onMenuKeydown"
      >
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="menuitemradio"
          :aria-checked="option.value === modelValue ? 'true' : 'false'"
          class="font-outfit flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition-colors"
          :class="
            option.value === modelValue
              ? 'dark:text-accent-lift bg-[var(--tint-orange-8)] text-[#F15D22]'
              : 'text-[var(--color-text)] hover:bg-[var(--tint-slate-5)]'
          "
          @click="select(option.value)"
        >
          <span class="w-4 text-center text-sm" aria-hidden="true">{{ option.icon }}</span>
          <span class="flex-1">{{ t(option.labelKey) }}</span>
          <span
            v-if="option.value === modelValue"
            class="dark:text-accent-lift text-[#F15D22]"
            aria-hidden="true"
            >✓</span
          >
        </button>
      </div>
    </Teleport>
  </div>
</template>
