<script setup lang="ts">
/**
 * Shared holiday banner — "Vesak Day (SG) — public holiday" — clay-tinted to
 * match the holiday chip and clickable to open the details popup. Used by the
 * daily view and the day-agenda drawer (full size, optional observance
 * sub-line) and by the mobile day timeline (`compact`). The country code goes
 * in parentheses after the name (no leading flag emoji — see HolidayChip).
 */
import { useTranslation } from '@/composables/useTranslation';
import type { HolidayOccurrence } from '@/types/models';

defineProps<{
  holiday: HolidayOccurrence;
  /** Compact pill (mobile timeline) — just the name, smaller padding. */
  compact?: boolean;
  /** Show the hedged observance note below the title (drawer / day view). */
  showSubline?: boolean;
}>();
defineEmits<{ click: [] }>();

const { t } = useTranslation();
</script>

<template>
  <button
    type="button"
    class="font-outfit flex w-full cursor-pointer items-center gap-2 rounded-xl bg-[var(--holiday-clay-tint)] text-left text-[var(--holiday-clay)] transition-opacity hover:opacity-80"
    :class="compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'"
    @click="$emit('click')"
  >
    <span class="min-w-0 flex-1">
      <span class="font-semibold">{{ holiday.name }} ({{ holiday.countryCode }})</span
      ><template v-if="!compact"> — {{ t('holiday.publicHolidaySuffix') }}</template>
      <span v-if="holiday.nameLocal && !compact"> · {{ holiday.nameLocal }}</span>
      <span v-if="showSubline && !compact" class="mt-0.5 block text-xs font-normal opacity-80">
        {{ t('holiday.observanceNote') }}
      </span>
    </span>
  </button>
</template>
