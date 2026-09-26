<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAnchoredPopover } from '@/composables/useAnchoredPopover';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * One row of the menu. `labelKey` / `disabledReasonKey` are translation keys, not strings:
 * the menu is shared across surfaces and every one of them must localise (ADR-008).
 */
export interface OverflowMenuItem {
  id: string;
  labelKey: UIStringKey;
  /** Decorative leading glyph. */
  icon: string;
  /** `danger` is for destructive rows (delete, restore defaults). */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Shown under a disabled row's label so the user learns why it's unavailable. */
  disabledReasonKey?: UIStringKey;
}

/**
 * A "⋯" trigger that opens a teleported action menu. Emits `select` with the item id;
 * disabled rows stay focusable (`aria-disabled`) so their reason is reachable, but
 * selecting one does nothing. Positioning, dismiss and roving focus: useAnchoredPopover.
 */
withDefaults(
  defineProps<{
    items: readonly OverflowMenuItem[];
    /** Accessible name for the trigger and the menu. */
    triggerLabelKey?: UIStringKey;
  }>(),
  { triggerLabelKey: 'action.moreOptions' }
);
const emit = defineEmits<{ select: [id: string] }>();

const { t } = useTranslation();

const el = ref<HTMLElement>();
const triggerRef = ref<HTMLButtonElement>();
const popoverRef = ref<HTMLElement | null>(null);

const { show, popoverStyle, close, toggle, onMenuKeydown } = useAnchoredPopover({
  anchorRef: el,
  triggerRef,
  popoverRef,
  itemSelector: '[role="menuitem"]',
});

function select(item: OverflowMenuItem) {
  if (item.disabled) return;
  emit('select', item.id);
  close(true);
}

function itemClass(item: OverflowMenuItem): string {
  if (item.disabled) return 'cursor-not-allowed text-[var(--color-text-muted)] dark:text-ink-faint';
  if (item.tone === 'danger')
    return 'text-red-600 dark:text-danger-lift hover:bg-[var(--tint-slate-5)] dark:hover:bg-surface-hover';
  return 'text-[var(--color-text)] dark:text-ink hover:bg-[var(--tint-slate-5)] dark:hover:bg-surface-hover';
}
</script>

<template>
  <div ref="el" class="relative shrink-0">
    <button
      ref="triggerRef"
      type="button"
      class="dark:border-line-strong dark:bg-surface-raised dark:text-ink-soft flex h-9 w-9 items-center justify-center rounded-2xl border border-gray-200 bg-white text-lg text-[var(--color-text-muted)] shadow-[var(--card-shadow)] transition-colors hover:border-[#F15D22]"
      aria-haspopup="menu"
      :aria-expanded="show ? 'true' : 'false'"
      :aria-label="t(triggerLabelKey)"
      :title="t(triggerLabelKey)"
      data-testid="overflow-menu-trigger"
      @click.stop="toggle"
    >
      <span aria-hidden="true">⋯</span>
    </button>

    <!-- Menu — teleported to <body> so clipping/scrolling ancestors can't cut
         it off; positioned via fixed coords from useAnchoredPopover. -->
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
          v-for="item in items"
          :key="item.id"
          type="button"
          role="menuitem"
          :aria-disabled="item.disabled ? 'true' : undefined"
          :data-testid="`overflow-menu-item-${item.id}`"
          class="font-outfit flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition-colors"
          :class="itemClass(item)"
          @click="select(item)"
        >
          <span class="w-4 text-center text-sm" aria-hidden="true">{{ item.icon }}</span>
          <span class="flex flex-1 flex-col">
            <span>{{ t(item.labelKey) }}</span>
            <span
              v-if="item.disabled && item.disabledReasonKey"
              class="dark:text-ink-faint text-xs font-normal text-[var(--color-text-muted)]"
              >{{ t(item.disabledReasonKey) }}</span
            >
          </span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
