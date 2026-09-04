<script setup lang="ts">
/** Data-driven from WALL_VIEWS. Not a fork of ViewToggle: different glyph set, four items, wall scale. */
import { WALL_VIEWS } from '@/components/wall/wallViews';
import { useTranslation } from '@/composables/useTranslation';
import type { WallViewId } from '@/types/wall';

defineProps<{ active: WallViewId }>();
defineEmits<{ select: [WallViewId] }>();
const { t } = useTranslation();
</script>

<template>
  <div
    class="dark:bg-surface-raised flex shrink-0 gap-0.5 rounded-[18px] bg-white p-1 shadow-[var(--card-shadow)]"
  >
    <template v-for="view in WALL_VIEWS" :key="view.id">
      <span
        v-if="view.dividerBefore"
        class="mx-0.5 my-1.5 w-px bg-[rgba(44,62,80,0.1)]"
        aria-hidden="true"
      />
      <button
        type="button"
        class="wall-switch-btn grid place-items-center rounded-[14px] transition-colors"
        :class="
          active === view.id
            ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white opacity-100 shadow-[0_3px_10px_rgba(241,93,34,0.3)]'
            : 'text-secondary-500 dark:text-ink bg-transparent opacity-50'
        "
        :title="t(view.labelKey)"
        :aria-label="t(view.labelKey)"
        :aria-pressed="active === view.id"
        @click="$emit('select', view.id)"
      >
        <span aria-hidden="true">{{ view.glyph }}</span>
      </button>
    </template>
  </div>
</template>
