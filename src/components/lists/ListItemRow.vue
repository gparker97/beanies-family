<script setup lang="ts">
// One checkable list item — shared by the detail drawer and the travel-plan
// embed (one source of truth for the row). Done check is the mockup's orange
// gradient (heritage→terracotta), not the green to-do tick.
//
// Edit + drag are OPT-IN via props so the read-only LinkedLists embed (which
// omits them) renders exactly as before. The row owns its in-flight edit draft
// (so the modal needs no per-row draft) and self-commits on blur / unmount /
// editing→false while dirty, so closing the drawer mid-edit never loses text.
// Esc sets a `resolved` guard so the unmount-blur can't re-commit a cancel.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
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

const draft = ref('');
// A terminal action (save via Enter, or cancel via Esc) already happened this
// edit session — guards the unmount/blur backstops from firing a second time.
const resolved = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.editing,
  (isEditing, was) => {
    if (isEditing && !was) {
      draft.value = props.item.title;
      resolved.value = false;
      void nextTick(() => inputRef.value?.focus());
    } else if (!isEditing && was) {
      // The modal ended this edit (e.g. switched to another field via
      // useInlineEdit's auto-save-previous) — commit a dirty draft.
      commitIfDirty();
    }
  }
);

/** Save the draft if it's a real change and nothing has resolved yet. The store
 *  trims + no-ops empty/unchanged, so this stays a clean single dispatch. */
function commitIfDirty(): void {
  if (resolved.value) return;
  resolved.value = true;
  if (draft.value.trim() && draft.value !== props.item.title) emit('edit-save', draft.value);
}

function onEnter(): void {
  if (resolved.value) return;
  resolved.value = true;
  emit('edit-save', draft.value); // store no-ops empty/unchanged → reverts cleanly
}

function onEsc(): void {
  if (resolved.value) return;
  resolved.value = true;
  emit('edit-cancel');
}

// Tap-away save (and the native blur fired when the input unmounts). Guarded by
// `resolved` so an Enter/Esc that already ran makes this a no-op.
function onBlur(): void {
  commitIfDirty();
}

// Backstop: a focused input removed from the DOM (modal close / list switch)
// doesn't reliably fire blur, so commit a dirty draft here too. `resolved`
// prevents a double-emit when blur DID fire.
onBeforeUnmount(() => commitIfDirty());
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
          : 'border-[var(--color-border)] bg-white dark:bg-slate-800'
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
        ref="inputRef"
        v-model="draft"
        type="text"
        class="min-w-0 flex-1 border-b border-[var(--color-primary-500)] bg-transparent text-base text-[var(--color-text)] outline-none"
        :placeholder="t('lists.detail.itemPlaceholder')"
        :aria-label="t('lists.detail.editItem')"
        @keyup.enter="onEnter"
        @keyup.esc="onEsc"
        @blur="onBlur"
      />
      <button
        type="button"
        class="flex-shrink-0 text-sm text-[var(--color-primary-500)] transition-opacity hover:opacity-80"
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
