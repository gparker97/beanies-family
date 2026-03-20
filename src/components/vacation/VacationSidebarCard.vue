<script setup lang="ts">
import { computed } from 'vue';
import type { FamilyVacation } from '@/types/models';
import { bookingProgress, daysUntilTrip } from '@/utils/vacation';
import { formatDateShort } from '@/utils/date';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{ vacation: FamilyVacation }>();
defineEmits<{ click: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const tripEmojis: Record<string, string> = {
  fly_and_stay: '✈️',
  cruise: '🚢',
  road_trip: '🚗',
  combo: '🎒',
  camping: '🏕️',
  adventure: '🏔️',
};

const emoji = computed(() => tripEmojis[props.vacation.tripType] ?? '✈️');
const progress = computed(() => bookingProgress(props.vacation));
const days = computed(() =>
  props.vacation.startDate ? daysUntilTrip(props.vacation.startDate) : null
);
const dateRange = computed(() => {
  if (!props.vacation.startDate) return '';
  const start = formatDateShort(props.vacation.startDate);
  return props.vacation.endDate ? `${start} – ${formatDateShort(props.vacation.endDate)}` : start;
});
const assignees = computed(() =>
  props.vacation.assigneeIds
    .map((id) => familyStore.members.find((m) => m.id === id))
    .filter(Boolean)
);
const unbookedCount = computed(() => progress.value.total - progress.value.booked);
</script>

<template>
  <div
    class="group relative cursor-pointer overflow-hidden rounded-2xl border border-[var(--vacation-teal-15)] p-4 transition-all hover:-translate-y-px hover:border-[var(--vacation-teal)] hover:shadow-md dark:border-slate-600 dark:bg-slate-800/50"
    style="background: linear-gradient(135deg, rgb(0 180 216 / 5%), rgb(255 217 61 / 4%))"
    @click="$emit('click')"
  >
    <!-- Decorative circle -->
    <div
      class="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30"
      style="background: radial-gradient(circle, var(--vacation-teal-tint), transparent)"
    />

    <!-- Name row -->
    <div class="flex items-center gap-2">
      <span class="text-2xl leading-none">{{ emoji }}</span>
      <span
        class="font-outfit truncate text-sm font-bold text-[var(--color-text)] dark:text-gray-100"
        >{{ vacation.name }}</span
      >
    </div>

    <!-- Date row -->
    <p v-if="dateRange" class="font-outfit mt-1.5 text-xs text-[var(--color-text-muted)]">
      📅 {{ dateRange }}
    </p>

    <!-- Countdown + avatars -->
    <div class="mt-2 flex items-center justify-between">
      <span
        v-if="days !== null && days >= 0"
        class="inline-flex items-center rounded-lg px-2.5 py-0.5 text-[10px] font-bold text-white"
        style="background: linear-gradient(135deg, var(--vacation-teal), #0096c7)"
      >
        ✈️ {{ days }} {{ t('vacation.daysAway').toLowerCase() }}!
      </span>
      <span v-else />
      <div class="flex items-center">
        <span
          v-for="(m, i) in assignees"
          :key="m!.id"
          class="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-white dark:ring-slate-800"
          :class="{ '-ml-1': i > 0 }"
          :style="{ backgroundColor: m!.color }"
          >{{ m!.name.charAt(0) }}</span
        >
      </div>
    </div>

    <!-- Progress bar -->
    <div v-if="progress.total > 0" class="mt-2 flex items-center gap-2">
      <div class="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-slate-700">
        <div
          class="h-full rounded-full transition-all"
          style="background: var(--vacation-teal)"
          :style="{ width: progress.percent + '%' }"
        />
      </div>
      <span class="text-xs text-[var(--color-text-muted)]"
        >{{ progress.booked }}/{{ progress.total }} {{ t('vacation.progress') }}</span
      >
    </div>

    <!-- Alert row -->
    <div v-if="unbookedCount > 0" class="mt-2">
      <span
        class="inline-flex items-center rounded-lg bg-[var(--vacation-gold-tint)] px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
      >
        ⏳ {{ unbookedCount }} {{ unbookedCount === 1 ? 'item needs' : 'items need' }} booking
      </span>
    </div>
  </div>
</template>
