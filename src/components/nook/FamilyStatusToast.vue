<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useGoalsStore } from '@/stores/goalsStore';

const { t } = useTranslation();
const todoStore = useTodoStore();
const goalsStore = useGoalsStore();

const completedCount = computed(() => todoStore.filteredCompletedTodos.length);

const milestonesCount = computed(
  () => goalsStore.filteredActiveGoals.filter((g) => g.deadline).length
);

const subtitle = computed(() => {
  if (completedCount.value === 0 && milestonesCount.value === 0) {
    return '';
  }
  return t('nook.statusSummary')
    .replace('{tasks}', String(completedCount.value))
    .replace('{milestones}', String(milestonesCount.value));
});

const title = computed(() => t('nook.statusGreatWeek'));
</script>

<template>
  <div
    class="flex items-center gap-4 rounded-[18px] px-6 py-4 text-white"
    style="
      background: linear-gradient(135deg, #f15d22, #e67e22);
      box-shadow: 0 8px 32px rgb(241 93 34 / 20%);
    "
  >
    <!-- Icon -->
    <div
      class="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px]"
      style="background: rgb(255 255 255 / 20%)"
    >
      <span class="text-xl">🌳</span>
    </div>

    <!-- Text -->
    <div class="min-w-0">
      <p class="font-outfit truncate text-[0.85rem] leading-snug font-semibold">
        {{ title }}
      </p>
      <p v-if="subtitle" class="mt-0.5 truncate text-[0.7rem] opacity-70">
        {{ subtitle }}
      </p>
      <p v-else class="mt-0.5 truncate text-[0.7rem] opacity-70">
        {{ t('nook.familyAtAGlance') }}
      </p>
    </div>
  </div>
</template>
