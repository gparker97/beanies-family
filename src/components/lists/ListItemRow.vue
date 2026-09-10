<script setup lang="ts">
// One checkable list item — shared by the detail drawer and the travel-plan
// embed (one source of truth for the row). Done check is the mockup's orange
// gradient (heritage→terracotta), not the green to-do tick.
//
// Edit + drag are OPT-IN via props so the read-only LinkedLists embed (which
// omits them) renders exactly as before. The row owns its in-flight edit draft
// (so the modal needs no per-row draft) and self-commits on blur / unmount /
// editing→false while dirty, so closing the drawer mid-edit never loses text.
// The inline-edit discipline (draft, focus, and the three ways an edit can end
// without losing text) lives in `useInlineRename`, shared with the wall's job
// row. Escape is owned by that composable via the shared `useEscapeClose`
// stack, so this file must NOT also bind `@keyup.esc`.
import { toRef } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useInlineRename } from '@/composables/useInlineRename';
import type { FamilyListItem } from '@/types/models';

const props = defineProps<{
  item: FamilyListItem;
  removable?: boolean;
  /** Make the text tappable to inline-edit. */
  editable?: boolean;
  /** Whether THIS row is the one currently being edited (owned by the modal's useInlineEdit). */
  editing?: boolean;
  /** Render the drag handle (reorder is opt-in). */
  draggable?: boolean;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  remove: [id: string];
  'edit-start': [];
  'edit-save': [text: string];
  'edit-cancel': [];
}>();

const { t } = useTranslation();

const { draft, inputRef, onEnter, onEsc, onBlur } = useInlineRename({
  editing: toRef(props, 'editing'),
  current: () => props.item.title,
  save: (text) => emit('edit-save', text),
  cancel: () => emit('edit-cancel'),
});
</script>

<template>
  <div
    class="group flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 last:border-0"
  >
    <!-- Drag handle (opt-in). touch-action:none so a handle-drag doesn't scroll;
         the row keeps pan-y, so dragging the body still scrolls the list. -->
    <button
      v-if="draggable"
      type="button"
      class="drag-handle flex-shrink-0 cursor-grab touch-none text-base leading-none text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)] active:cursor-grabbing"
      :aria-label="t('lists.detail.dragHandle')"
    >
      <span aria-hidden="true">⠿</span>
    </button>
    <button
      type="button"
      class="grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg border-2 text-xs text-white transition-colors"
      :class="
        item.completed
          ? 'border-transparent bg-gradient-to-br from-[var(--color-primary-500)] to-[#E67E22]'
          : 'dark:bg-surface-raised border-[var(--color-border)] bg-white'
      "
      :aria-label="item.title"
      @click="$emit('toggle', item.id)"
    >
      <span v-if="item.completed" aria-hidden="true">✓</span>
    </button>

    <!-- EDITING: raw <input> (focusable + autofocused via nextTick; matches the
         static text rhythm so no layout jump) + explicit save/cancel controls.
         `pointerdown.prevent` on the controls keeps focus on the input so the
         input's blur-to-save can't fire BEFORE a deliberate ✕ cancel. -->
    <template v-if="editable && editing">
      <input
        :ref="(el) => (inputRef = el as HTMLInputElement | null)"
        v-model="draft"
        type="text"
        class="min-w-0 flex-1 border-b border-[var(--color-primary-500)] bg-transparent text-base text-[var(--color-text)] outline-none"
        :placeholder="t('lists.detail.itemPlaceholder')"
        :aria-label="t('lists.detail.editItem')"
        @keyup.enter="onEnter"
        @blur="onBlur"
      />
      <button
        type="button"
        class="dark:text-accent-lift flex-shrink-0 text-sm text-[var(--color-primary-500)] transition-opacity hover:opacity-80"
        :aria-label="t('action.save')"
        @pointerdown.prevent
        @click="onEnter"
      >
        <span aria-hidden="true">✓</span>
      </button>
      <button
        type="button"
        class="flex-shrink-0 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger,#e11d48)]"
        :aria-label="t('action.cancel')"
        @pointerdown.prevent
        @click="onEsc"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </template>

    <!-- EDITABLE (not editing): tappable text + a subtle pencil hint so it's
         clear the row can be edited (no hover on touch, so the hint is always
         faintly visible and brightens on hover/focus). -->
    <button
      v-else-if="editable"
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
      :class="
        item.completed ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'
      "
      :aria-label="t('lists.detail.editItem')"
      @click="$emit('edit-start')"
    >
      <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
      <span
        class="flex-shrink-0 text-xs text-[var(--color-text-muted)] opacity-40 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        aria-hidden="true"
        >✎</span
      >
    </button>

    <!-- READ-ONLY text (default; the LinkedLists embed). -->
    <span
      v-else
      class="flex-1 text-sm"
      :class="
        item.completed ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'
      "
    >
      {{ item.title }}
    </span>

    <!-- Remove (hidden while editing — save/cancel take its place). -->
    <button
      v-if="removable && !(editable && editing)"
      type="button"
      class="flex-shrink-0 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)]"
      :aria-label="t('action.delete')"
      @click="$emit('remove', item.id)"
    >
      <span aria-hidden="true">✕</span>
    </button>
  </div>
</template>
