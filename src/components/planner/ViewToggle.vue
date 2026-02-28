<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ activeView: string }>();
const emit = defineEmits<{ 'update:activeView': [view: string] }>();
const { t } = useTranslation();

const views = [
  { id: 'month', labelKey: 'planner.view.month' as const },
  { id: 'week', labelKey: 'planner.view.week' as const },
  { id: 'day', labelKey: 'planner.view.day' as const },
  { id: 'agenda', labelKey: 'planner.view.agenda' as const },
];
</script>

<template>
  <div
    class="inline-flex items-center gap-1 rounded-2xl bg-white p-1 shadow-[0_2px_8px_rgba(44,62,80,0.06)] dark:bg-slate-800 dark:shadow-none"
  >
    <button
      v-for="view in views"
      :key="view.id"
      type="button"
      class="font-outfit cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition-all"
      :class="
        view.id === activeView
          ? 'bg-gradient-to-r from-[#F15D22] to-[#E67E22] text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
          : 'text-[#2C3E50]/50 hover:text-[#2C3E50]/70 dark:text-gray-400 dark:hover:text-gray-300'
      "
      :title="view.id !== 'month' ? t('planner.comingSoon') : undefined"
      @click="view.id === 'month' ? emit('update:activeView', view.id) : undefined"
    >
      {{ t(view.labelKey) }}
    </button>
  </div>
</template>
