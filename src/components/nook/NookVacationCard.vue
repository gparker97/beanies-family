<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useVacationStore } from '@/stores/vacationStore';
import { useTranslation } from '@/composables/useTranslation';
import { tripTypeEmoji, bookingProgress, daysUntilTrip, tripCountdownKey } from '@/utils/vacation';
import { formatDateShort } from '@/utils/date';
import NookSectionCard from './NookSectionCard.vue';

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
  <NookSectionCard
    v-if="vacation"
    class="nook-vacation-tint cursor-pointer"
    :title="t('vacation.upcoming')"
    border-color="#00B4D8"
    @click="handleClick"
  >
    <!-- Row 1: Trip name + emoji + date -->
    <div class="flex items-center gap-2.5">
      <span class="text-xl">{{ tripTypeEmoji(vacation.tripType) }}</span>
      <div class="min-w-0 flex-1">
        <div class="font-outfit text-sm font-bold text-gray-900 dark:text-gray-100">
          {{ vacation.name }}
        </div>
        <div class="font-outfit mt-0.5 text-xs text-gray-400">📅 {{ dateRange }}</div>
      </div>
    </div>

    <!-- Row 2: Booking progress -->
    <div v-if="progress && progress.total > 0" class="mt-3 flex items-center gap-2.5">
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(0,180,216,0.1)]">
        <div
          class="h-full rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6]"
          :style="{ width: progress.percent + '%' }"
        />
      </div>
      <span class="font-outfit text-[10px] font-semibold whitespace-nowrap text-[#00B4D8]">
        {{ progress.booked }}/{{ progress.total }} booked
      </span>
    </div>

    <!-- Row 3: Countdown hero badge -->
    <div
      v-if="countdown !== null && countdown > 0"
      class="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-4 py-2 shadow-[0_4px_12px_rgba(0,180,216,0.2)]"
    >
      <span class="font-outfit text-lg leading-none font-extrabold text-white">
        {{ countdown }}
      </span>
      <span class="font-outfit text-[11px] font-semibold text-white/80">
        {{ t(tripCountdownKey(vacation.tripType) as any) }}!
        {{ tripTypeEmoji(vacation.tripType) }}
      </span>
    </div>
  </NookSectionCard>
</template>

<style scoped>
.nook-vacation-tint {
  background: linear-gradient(180deg, rgb(0 180 216 / 6%), rgb(0 180 216 / 14%)) !important;
}

:global(.dark) .nook-vacation-tint {
  background: linear-gradient(180deg, rgb(0 180 216 / 8%), rgb(0 180 216 / 18%)) !important;
}
</style>
