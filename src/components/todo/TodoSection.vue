<script setup lang="ts">
/**
 * One section of the To-do page (Open / Someday · Maybe / Completed) — a
 * labelled header plus a list of `TodoItemCard`s. Extracted so the three
 * sections share one renderer instead of near-identical template blocks. The
 * "Completed" section opts into `collapsible` (the header becomes a toggle);
 * the others are always visible. The parent passes an already-filtered/sorted
 * `todos` list and handles the to-do events (it's the orchestrator).
 */
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import TodoItemCard from '@/components/todo/TodoItemCard.vue';
import type { TodoItem } from '@/types/models';

withDefaults(
  defineProps<{
    label: string;
    /** Optional emoji prefix shown before the label (e.g. 💭). */
    emoji?: string;
    /** Colour class for the `nook-section-label` header. */
    labelClass?: string;
    todos: TodoItem[];
    /** When true, the header becomes a toggle and the body is hidden while collapsed. */
    collapsible?: boolean;
    /** Collapsed state (only meaningful when `collapsible`). */
    collapsed?: boolean;
    /** Message shown when `todos` is empty (and the section isn't collapsed). Omit to render nothing. */
    emptyText?: string;
  }>(),
  { collapsible: false, collapsed: false }
);

defineEmits<{
  'update:collapsed': [value: boolean];
  toggle: [id: string];
  view: [todo: TodoItem];
  edit: [todo: TodoItem];
  delete: [id: string];
  'set-someday': [id: string, value: boolean];
  acknowledge: [id: string];
}>();

const { syncHighlightClass } = useSyncHighlight();
</script>

<template>
  <div>
    <!-- Header — a toggle when collapsible, a plain label otherwise -->
    <button
      v-if="collapsible"
      type="button"
      class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
      @click="$emit('update:collapsed', !collapsed)"
    >
      <span class="text-xs opacity-50">{{ collapsed ? '▼' : '▲' }}</span>
      <span class="nook-section-label" :class="labelClass">
        <span v-if="emoji" aria-hidden="true">{{ emoji }} </span>{{ label }} ({{ todos.length }})
      </span>
    </button>
    <p v-else class="nook-section-label mb-2" :class="labelClass">
      <span v-if="emoji" aria-hidden="true">{{ emoji }} </span>{{ label }} ({{ todos.length }})
    </p>

    <!-- Optional hint line under the header -->
    <p
      v-if="$slots.hint && (!collapsible || !collapsed)"
      class="mb-2 text-xs text-[var(--color-text-muted)]"
    >
      <slot name="hint" />
    </p>

    <template v-if="!collapsible || !collapsed">
      <div v-if="todos.length === 0 && emptyText" class="py-6 text-center">
        <p class="text-sm text-[var(--color-text-muted)]">{{ emptyText }}</p>
      </div>
      <div :class="collapsible ? 'mt-2 space-y-2' : 'space-y-2'">
        <div v-for="todo in todos" :key="todo.id" :class="syncHighlightClass(todo.id)">
          <TodoItemCard
            :todo="todo"
            @toggle="$emit('toggle', $event)"
            @view="$emit('view', $event)"
            @edit="$emit('edit', $event)"
            @delete="$emit('delete', $event)"
            @set-someday="(id, value) => $emit('set-someday', id, value)"
            @acknowledge="$emit('acknowledge', $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
