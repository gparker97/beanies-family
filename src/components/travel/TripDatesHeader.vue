<script setup lang="ts">
/**
 * Trip dates display + click-to-edit affordance for the trip summary
 * page. Collapsed state shows a date chip plus an "Edit dates" button;
 * expanded state reveals the shared `<TripDatesInput>` with Save /
 * Cancel. Wiring `aria-expanded` / `aria-controls` keeps the
 * accordion-like interaction accessible.
 *
 * Store failures surface automatically via `wrapAsync` (error toast) —
 * no UI-layer toast boilerplate needed here. Cancel restores the
 * previous values by closing without committing; the editor re-seeds
 * from the live vacation prop each time it opens.
 *
 * See ADR-023 for why trip dates are user-owned and editable here.
 */
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useVacationStore } from '@/stores/vacationStore';
import TripDatesInput from '@/components/ui/TripDatesInput.vue';
import { formatDateShort } from '@/utils/date';
import { tripDurationDays } from '@/utils/vacation';
import type { FamilyVacation } from '@/types/models';

interface Props {
  vacation: FamilyVacation;
}
const props = defineProps<Props>();

const { t } = useTranslation();
const store = useVacationStore();

const isEditing = ref(false);
const editStart = ref('');
const editEnd = ref('');
const isValid = ref(false);
const isSubmitting = ref(false);

const regionId = `trip-dates-editor-${Math.random().toString(36).slice(2, 9)}`;

const display = computed(() => {
  const start = props.vacation.startDate;
  const end = props.vacation.endDate;
  if (!start || !end) return t('travel.dates.notSet');
  const days = tripDurationDays(start, end);
  const label = days === 1 ? t('travel.dates.dayLabelSingular') : t('travel.dates.dayLabelPlural');
  return `${formatDateShort(start)} → ${formatDateShort(end)} · ${days} ${label}`;
});

function openEditor(): void {
  editStart.value = props.vacation.startDate ?? '';
  editEnd.value = props.vacation.endDate ?? '';
  isEditing.value = true;
}

function cancel(): void {
  isEditing.value = false;
}

async function save(): Promise<void> {
  if (!isValid.value || isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    const result = await store.updateVacation(props.vacation.id, {
      startDate: editStart.value,
      endDate: editEnd.value,
    });
    // wrapAsync toasted on failure (null result). Only close on success.
    if (result) isEditing.value = false;
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="mb-5">
    <div v-if="!isEditing" class="flex flex-wrap items-center gap-2">
      <span
        class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-[var(--tint-slate-5)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text)] dark:bg-slate-700 dark:text-gray-100"
      >
        📅 {{ display }}
      </span>
      <button
        type="button"
        class="font-outfit inline-flex items-center gap-1 rounded-full border border-[var(--vacation-teal)]/30 px-3 py-1 text-xs font-medium text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-5)]"
        :aria-expanded="false"
        :aria-controls="regionId"
        @click="openEditor"
      >
        ✏️ {{ t('travel.dates.edit') }}
      </button>
    </div>

    <div
      v-else
      :id="regionId"
      class="rounded-2xl border border-[var(--vacation-teal)]/20 bg-[var(--vacation-teal-5)] p-4 dark:bg-slate-800/40"
    >
      <TripDatesInput
        v-model:start-date="editStart"
        v-model:end-date="editEnd"
        @update:is-valid="isValid = $event"
      />
      <div class="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          class="font-outfit rounded-full border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-gray-400 dark:hover:bg-slate-700"
          :disabled="isSubmitting"
          @click="cancel"
        >
          {{ t('action.cancel') }}
        </button>
        <button
          type="button"
          class="font-outfit rounded-full bg-[var(--vacation-teal)] px-4 py-1.5 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!isValid || isSubmitting"
          @click="save"
        >
          {{ t('action.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
