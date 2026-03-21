<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useVacationStore } from '@/stores/vacationStore';
import { useTranslation } from '@/composables/useTranslation';
import { tripTypeEmoji, bookingProgress, daysUntilTrip } from '@/utils/vacation';
import { formatDateShort } from '@/utils/date';

const router = useRouter();
const vacationStore = useVacationStore();
const { t } = useTranslation();

const vacation = computed(() => vacationStore.upcomingVacations[0]);

const progress = computed(() => (vacation.value ? bookingProgress(vacation.value) : null));
const countdown = computed(() =>
  vacation.value?.startDate ? daysUntilTrip(vacation.value.startDate) : null
);
const dateRange = computed(() => {
  const v = vacation.value;
  if (!v?.startDate) return '';
  const start = formatDateShort(v.startDate);
  const end = v.endDate ? formatDateShort(v.endDate) : '';
  return end ? `${start} – ${end}` : start;
});

function handleClick() {
  if (vacation.value) {
    router.push({ path: '/travel', query: { vacation: vacation.value.id } });
  }
}
</script>

<template>
  <button
    v-if="vacation"
    class="flex w-full cursor-pointer items-center gap-3 rounded-[var(--sq)] border-l-4 border-[#00B4D8] p-3.5 text-left transition-all hover:shadow-[0_4px_16px_rgba(0,180,216,0.08)]"
    style="background: linear-gradient(135deg, rgb(0 180 216 / 4%), rgb(255 217 61 / 3%))"
    @click="handleClick"
  >
    <!-- Emoji -->
    <span class="text-2xl">{{ tripTypeEmoji(vacation.tripType) }}</span>

    <!-- Content -->
    <div class="min-w-0 flex-1">
      <div class="font-outfit text-sm font-bold text-gray-900 dark:text-gray-100">
        {{ vacation.name }}
      </div>
      <div class="font-outfit mt-0.5 text-xs text-gray-400">📅 {{ dateRange }}</div>

      <!-- Progress bar -->
      <div v-if="progress && progress.total > 0" class="mt-2 flex items-center gap-2">
        <div class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
          <div
            class="h-full rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6]"
            :style="{ width: progress.percent + '%' }"
          />
        </div>
        <span class="font-outfit text-[10px] font-semibold whitespace-nowrap text-[#00B4D8]">
          {{ progress.booked }}/{{ progress.total }}
        </span>
      </div>
    </div>

    <!-- Countdown badge -->
    <div v-if="countdown !== null && countdown > 0" class="shrink-0 text-right">
      <div class="font-outfit text-lg font-extrabold text-[#00B4D8]">{{ countdown }}</div>
      <div class="font-outfit text-[9px] font-semibold text-gray-400">
        {{ t('travel.daysUntil') }}
      </div>
    </div>
  </button>
</template>
