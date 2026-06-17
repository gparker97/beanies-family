<script setup lang="ts">
import ListTile from './ListTile.vue';
import type { FamilyList } from '@/types/models';

// Presentational shelf — title + optional all-or-nothing collapse (the
// `TodoSection` pattern, driven by `v-model:collapsed`) + a responsive grid of
// tiles. No store access; props in, `open` out.
withDefaults(
  defineProps<{
    title: string;
    emoji?: string;
    lists: FamilyList[];
    labelClass?: string;
    collapsible?: boolean;
    collapsed?: boolean;
  }>(),
  { collapsible: false, collapsed: false }
);

defineEmits<{
  'update:collapsed': [value: boolean];
  open: [id: string];
}>();
</script>

<template>
  <div>
    <button
      v-if="collapsible"
      type="button"
      class="mb-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
      @click="$emit('update:collapsed', !collapsed)"
    >
      <span class="text-xs opacity-50" aria-hidden="true">{{ collapsed ? '▼' : '▲' }}</span>
      <span class="nook-section-label" :class="labelClass">
        <span v-if="emoji" aria-hidden="true">{{ emoji }} </span>{{ title }} ({{ lists.length }})
      </span>
    </button>
    <p v-else class="nook-section-label mb-2" :class="labelClass">
      <span v-if="emoji" aria-hidden="true">{{ emoji }} </span>{{ title }} ({{ lists.length }})
    </p>

    <div v-if="!collapsible || !collapsed" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <ListTile v-for="list in lists" :key="list.id" :list="list" @open="$emit('open', $event)" />
    </div>
  </div>
</template>
