<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import ActivityListCard from '@/components/planner/ActivityListCard.vue';

const activityStore = useActivityStore();
const { t } = useTranslation();

const emit = defineEmits<{ edit: [id: string, date: string] }>();

const PAGE_SIZE = 6;
const visibleCount = ref(PAGE_SIZE);

const upcoming = computed(() => activityStore.upcomingActivities);
const visibleUpcoming = computed(() => upcoming.value.slice(0, visibleCount.value));
const hasMore = computed(() => upcoming.value.length > visibleCount.value);

function showMore() {
  visibleCount.value += PAGE_SIZE;
}
</script>

<template>
  <div>
    <h3 class="font-outfit text-secondary-500 mb-3 text-base font-bold dark:text-gray-100">
      {{ t('planner.upcoming') }}
    </h3>

    <div
      v-if="upcoming.length === 0"
      class="rounded-3xl bg-white p-6 text-center shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    >
      <p class="text-secondary-500/40 text-sm dark:text-gray-500">{{ t('planner.noUpcoming') }}</p>
    </div>

    <div v-else class="space-y-1.5">
      <ActivityListCard
        v-for="(occ, i) in visibleUpcoming"
        :key="`${occ.activity.id}-${occ.date}-${i}`"
        :activity="occ.activity"
        :date="occ.date"
        show-date
        show-reminder
        @click="emit('edit', occ.activity.id, occ.date)"
      />

      <!-- View more -->
      <button
        v-if="hasMore"
        type="button"
        class="text-primary-500 hover:bg-primary-500/5 mt-2 w-full cursor-pointer rounded-2xl py-2 text-center text-sm font-semibold transition-colors"
        @click="showMore"
      >
        {{ t('planner.viewMore') }}
      </button>
    </div>
  </div>
</template>
