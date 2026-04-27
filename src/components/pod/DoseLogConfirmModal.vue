<script setup lang="ts">
/**
 * Global singleton renderer for the dose-log confirmation dialog.
 *
 * Mount once in App.vue. State lives in `useDoseConfirm`; callers
 * anywhere (MedicationCard, MedicationViewModal, any future surface)
 * trigger it by awaiting `requestDoseConfirm(medication)`.
 *
 * Contents:
 *  - Compact read-only list of today's logged doses for the medication
 *    (reusing `MedicationLogRow` with `readOnly` so we don't duplicate
 *    avatar/name/time rendering). Empty state is explicit.
 *  - Editable date + time, defaulting to now. Future values blocked
 *    via input max-attribute AND a gating computed on the Save button
 *    (defense in depth — native validation is best-effort).
 *  - Save emits the chosen timestamp as ISO 8601; cancel resolves the
 *    caller's promise with `undefined`.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BeanieTimeInput from '@/components/ui/BeanieTimeInput.vue';
import MedicationLogRow from '@/components/pod/MedicationLogRow.vue';
import { useDoseConfirm } from '@/composables/useDoseConfirm';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useTranslation } from '@/composables/useTranslation';
import { toDateInputValue, toTimeInputValue } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import type { MedicationLogEntry } from '@/types/models';

const { state, handleConfirm, handleCancel } = useDoseConfirm();
const { t } = useTranslation();
const medicationsStore = useMedicationsStore();

// Local form state — reset each time the modal opens so a stale value
// from a prior invocation never bleeds into a new dose.
const dateValue = ref<string>('');
const timeValue = ref<string>('');

function resetToNow(): void {
  const now = new Date();
  dateValue.value = toDateInputValue(now);
  timeValue.value = toTimeInputValue(now);
}

// Bounds. Date max = today local. Time has a ceiling only when the
// selected date IS today — earlier dates have no time restriction.
const { today: todayISO } = useToday();
const nowTime = computed(() => toTimeInputValue(new Date()));
const timeMax = computed(() => (dateValue.value === todayISO.value ? nowTime.value : undefined));

const combinedDate = computed(() => {
  if (!dateValue.value || !timeValue.value) return null;
  const d = new Date(`${dateValue.value}T${timeValue.value}`);
  return isNaN(d.getTime()) ? null : d;
});

const isFuture = computed(() => {
  const d = combinedDate.value;
  return !!d && d.getTime() > Date.now();
});

const saveDisabled = computed(
  () => !combinedDate.value || isFuture.value || !state.value.medication
);

// Today's log entries for THIS medication. Reactive: if another
// device logs a dose while the modal is open (CRDT merge), this list
// updates live.
const todaysDoses = computed<MedicationLogEntry[]>(() => {
  const med = state.value.medication;
  if (!med) return [];
  const today = todayISO.value;
  return medicationsStore
    .logsForMedication(med.id)
    .value.filter((l) => toDateInputValue(new Date(l.administeredOn)) === today);
});

watch(
  () => state.value.open,
  (open) => {
    if (open) resetToNow();
  }
);

function onSave(): void {
  const d = combinedDate.value;
  if (!d || isFuture.value) return;
  handleConfirm(d.toISOString());
}
</script>

<template>
  <BeanieFormModal
    :open="state.open"
    :title="
      state.medication ? `${t('medicationLog.modalTitlePrefix')} ${state.medication.name}` : ''
    "
    icon="💊"
    size="narrow"
    :save-label="t('medicationLog.confirmLogDose')"
    save-gradient="orange"
    :save-disabled="saveDisabled"
    @close="handleCancel"
    @save="onSave"
  >
    <div v-if="state.medication" class="space-y-5">
      <!-- ── Today's doses for this medication ────────────────── -->
      <section>
        <h3
          class="font-outfit mb-2 text-xs font-semibold tracking-[0.14em] text-[#2C3E50]/55 uppercase dark:text-gray-400"
        >
          {{ t('medicationLog.givenTodayHeader') }}
        </h3>
        <div
          v-if="todaysDoses.length === 0"
          class="rounded-2xl bg-[var(--tint-slate-5)] px-3 py-3 text-center dark:bg-slate-800/60"
        >
          <p class="font-inter text-sm text-[#2C3E50]/60 italic dark:text-gray-400">
            {{ t('medicationLog.noneYetToday') }}
          </p>
        </div>
        <div v-else class="space-y-1.5">
          <MedicationLogRow v-for="log in todaysDoses" :key="log.id" :entry="log" read-only />
        </div>
      </section>

      <!-- ── When was this dose given? ────────────────────────── -->
      <section>
        <h3
          class="font-outfit mb-2 text-xs font-semibold tracking-[0.14em] text-[#2C3E50]/55 uppercase dark:text-gray-400"
        >
          {{ t('medicationLog.whenHeader') }}
        </h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
          <BeanieDatePicker
            v-model="dateValue"
            :max="todayISO"
            :placeholder="t('medicationLog.dateFieldLabel')"
          />
          <BeanieTimeInput
            v-model="timeValue"
            :max="timeMax"
            :placeholder="t('medicationLog.timeFieldLabel')"
          />
          <button
            type="button"
            class="font-outfit rounded-xl bg-[var(--tint-orange-8)] px-3 py-2 text-xs font-bold tracking-wider text-[#F15D22] uppercase transition-colors hover:bg-[var(--tint-orange-15)] focus:bg-[var(--tint-orange-15)] focus:outline-none"
            @click="resetToNow"
          >
            {{ t('medicationLog.now') }}
          </button>
        </div>
        <p v-if="isFuture" class="font-inter mt-2 text-xs text-[#F15D22]" role="alert">
          {{ t('medicationLog.errors.futureNotAllowed') }}
        </p>
      </section>
    </div>
  </BeanieFormModal>
</template>
