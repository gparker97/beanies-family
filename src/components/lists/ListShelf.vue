<script setup lang="ts">
import ListTile from './ListTile.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { FamilyList } from '@/types/models';
import type { Band } from '@/utils/completedListBands';
import type { UIStringKey } from '@/services/translation/uiStrings';

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
    /**
     * Optional recency bands. When present the tiles render under dated subheadings
     * instead of as one flat grid — `lists` still supplies the header count, so the
     * caller passes both. Only the completed shelf uses this; every other shelf is
     * small enough that banding would be noise.
     */
    bands?: Band<FamilyList>[];
  }>(),
  { collapsible: false, collapsed: false, bands: undefined }
);

const { t } = useTranslation();

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

    <template v-if="!collapsible || !collapsed">
      <template v-if="bands">
        <div v-for="band in bands" :key="band.key" class="mb-4 last:mb-0">
          <p class="mb-2 text-xs text-[var(--color-text-muted)]">
            {{ band.isLabelKey ? t(band.label as UIStringKey) : band.label }}
            ({{ band.items.length }})
          </p>
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ListTile
              v-for="list in band.items"
              :key="list.id"
              :list="list"
              @open="$emit('open', $event)"
            />
          </div>
        </div>
      </template>
      <div v-else class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ListTile v-for="list in lists" :key="list.id" :list="list" @open="$emit('open', $event)" />
      </div>
    </template>
  </div>
</template>
