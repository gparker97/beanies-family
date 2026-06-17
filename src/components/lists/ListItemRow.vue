<script setup lang="ts">
// One checkable list item — shared by the detail drawer and the travel-plan
// embed (one source of truth for the row). Done check is the mockup's orange
// gradient (heritage→terracotta), not the green to-do tick.
import { useTranslation } from '@/composables/useTranslation';
import type { FamilyListItem } from '@/types/models';

defineProps<{ item: FamilyListItem; removable?: boolean }>();
defineEmits<{ toggle: [id: string]; remove: [id: string] }>();

const { t } = useTranslation();
</script>

<template>
  <div class="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 last:border-0">
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
    <span
      class="flex-1 text-sm"
      :class="
        item.completed ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'
      "
    >
      {{ item.title }}
    </span>
    <button
      v-if="removable"
      type="button"
      class="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)]"
      :aria-label="t('action.delete')"
      @click="$emit('remove', item.id)"
    >
      <span aria-hidden="true">✕</span>
    </button>
  </div>
</template>
