<script setup lang="ts">
/**
 * The banded grid of archived cycles — the cycle-side twin of `ListShelf`, minus the
 * collapse control. Kept separate so it can be deleted wholesale if the feature ever is,
 * and so `ListShelf` keeps its current props and events untouched.
 */
import ListCycleTile from './ListCycleTile.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { Band } from '@/utils/completedListBands';
import type { ListCycle } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

defineProps<{
  title: string;
  bands: Band<ListCycle>[];
  count: number;
  collapsed: boolean;
}>();

defineEmits<{ 'update:collapsed': [value: boolean]; open: [id: string] }>();

const { t } = useTranslation();
</script>

<template>
  <div>
    <button
      type="button"
      class="mb-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
      @click="$emit('update:collapsed', !collapsed)"
    >
      <span class="text-xs opacity-50" aria-hidden="true">{{ collapsed ? '▼' : '▲' }}</span>
      <span class="nook-section-label">{{ title }} ({{ count }})</span>
      <!-- The retention rule, legible where the history is, not only in the help centre.
           This is the cheapest way to make an automatic deletion discoverable BEFORE it
           surprises somebody. -->
      <span class="text-xs opacity-60">{{ t('lists.history.retention') }}</span>
    </button>

    <template v-if="!collapsed">
      <div v-for="band in bands" :key="band.key" class="mb-4 last:mb-0">
        <p class="mb-2 text-xs text-[var(--color-text-muted)]">
          {{ band.isLabelKey ? t(band.label as UIStringKey) : band.label }}
          ({{ band.items.length }})
        </p>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ListCycleTile
            v-for="cycle in band.items"
            :key="cycle.id"
            :cycle="cycle"
            @open="$emit('open', $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
