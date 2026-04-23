<script setup lang="ts">
/**
 * Medications tab — active meds in the primary grid; ended meds tucked
 * into a collapsible "Ended medications" section below (mirrors the
 * completed-goals pattern on GoalsPage). Keeps the default view focused
 * on "what they're on now" without losing the history surface.
 *
 * Modal coordination uses an explicit state machine rather than paired
 * booleans: `{ kind: 'none' | 'viewing' | 'editing', medication }`. This
 * keeps illegal states unrepresentable (no "viewing AND editing") and
 * makes adding a third mode (e.g. dose log drawer) a new variant rather
 * than another boolean.
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import MedicationCard from '@/components/pod/MedicationCard.vue';
import MedicationFormModal from '@/components/pod/MedicationFormModal.vue';
import MedicationViewModal from '@/components/pod/MedicationViewModal.vue';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useTranslation } from '@/composables/useTranslation';
import { useGiveDose } from '@/composables/useGiveDose';
import { isMedicationActive, useMedicationsStore } from '@/stores/medicationsStore';
import type { Medication, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const medicationsStore = useMedicationsStore();
const { giveDose } = useGiveDose();

const memberMedications = computed(() => medicationsStore.byMember(props.memberId).value);

// Active meds: primary grid. Sorted alphabetically for stable ordering.
const activeMedications = computed(() =>
  memberMedications.value.filter(isMedicationActive).sort((a, b) => a.name.localeCompare(b.name))
);

// Ended meds: collapsible history section. Sorted by endDate desc
// (most-recently-ended first) so fresh history tops the list;
// undated ended meds fall through to an alphabetical tiebreak.
const endedMedications = computed(() =>
  memberMedications.value
    .filter((m) => !isMedicationActive(m))
    .sort((a, b) => {
      const aEnd = a.endDate ?? '';
      const bEnd = b.endDate ?? '';
      if (aEnd !== bEnd) return bEnd.localeCompare(aEnd);
      return a.name.localeCompare(b.name);
    })
);

const hasAnyMedications = computed(
  () => activeMedications.value.length > 0 || endedMedications.value.length > 0
);

// Ended section is collapsed by default — history doesn't compete for
// attention with current meds.
const showEndedMedications = ref(false);

// ── Modal state machine ─────────────────────────────────────────────
type ModalState =
  | { kind: 'none' }
  | { kind: 'viewing'; medicationId: UUID }
  | { kind: 'editing'; medication: Medication | null };

const modalState = ref<ModalState>({ kind: 'none' });

// Auto-open via `?action=add-medication` from the Quick-add FAB.
useQuickAddIntent((action) => {
  if (action === 'add-medication') {
    modalState.value = { kind: 'editing', medication: null };
  }
});

// Reactive resolution of the viewing medication — recomputes if the
// store mutates (e.g. deleted on another device → becomes undefined,
// the view modal's watcher auto-closes).
const viewingMedication = computed<Medication | null>(() => {
  const s = modalState.value;
  if (s.kind !== 'viewing') return null;
  return medicationsStore.medications.find((m) => m.id === s.medicationId) ?? null;
});

const editingMedication = computed<Medication | null>(() =>
  modalState.value.kind === 'editing' ? modalState.value.medication : null
);

const formModalOpen = computed(() => modalState.value.kind === 'editing');
const viewModalOpen = computed(() => modalState.value.kind === 'viewing');

function openAdd(): void {
  modalState.value = { kind: 'editing', medication: null };
}

function openView(m: Medication): void {
  modalState.value = { kind: 'viewing', medicationId: m.id };
}

function openEditFromView(m: Medication): void {
  modalState.value = { kind: 'editing', medication: m };
}

function closeModals(): void {
  modalState.value = { kind: 'none' };
}
</script>

<template>
  <div class="space-y-4">
    <!-- Active medications grid (always includes AddTile as the last slot).
         When there are ended meds but zero active, the grid is still
         rendered so the AddTile stays discoverable. -->
    <div v-if="hasAnyMedications" class="grid gap-3 md:grid-cols-2">
      <MedicationCard
        v-for="m in activeMedications"
        :key="m.id"
        :medication="m"
        @view="openView(m)"
        @give-dose="giveDose"
      />
      <AddTile :label="t('medications.addTile')" @click="openAdd" />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="💊"
        :message="t('medications.empty')"
        :action-label="t('medications.emptyCTA')"
        @action="openAdd"
      />
    </div>

    <!-- Ended medications — collapsible history section. Mirrors the
         GoalsPage completed-goals pattern (single toggle button with
         emoji + label + count pill + rotating chevron). -->
    <div v-if="endedMedications.length > 0">
      <button
        type="button"
        class="flex w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--tint-slate-5)]"
        :aria-expanded="showEndedMedications"
        @click="showEndedMedications = !showEndedMedications"
      >
        <span class="text-lg">📋</span>
        <span class="font-outfit text-secondary-400 text-base font-semibold dark:text-gray-400">
          {{ t('medications.endedSection.title') }}
        </span>
        <span
          class="font-outfit rounded-full bg-[var(--tint-slate-10)] px-2.5 py-0.5 text-xs font-semibold text-[#2C3E50] dark:bg-slate-700 dark:text-gray-300"
        >
          {{ endedMedications.length }}
        </span>
        <span
          class="ml-auto text-xs text-gray-400 transition-transform"
          :class="{ 'rotate-180': !showEndedMedications }"
          aria-hidden="true"
        >
          ▲
        </span>
      </button>
      <div v-if="showEndedMedications" class="mt-3 grid gap-3 md:grid-cols-2">
        <MedicationCard
          v-for="m in endedMedications"
          :key="m.id"
          :medication="m"
          @view="openView(m)"
          @give-dose="giveDose"
        />
      </div>
    </div>

    <!-- View modal — opens on card click; emits `edit` to pivot into edit mode. -->
    <MedicationViewModal
      :open="viewModalOpen"
      :medication="viewingMedication"
      @close="closeModals"
      @edit="openEditFromView"
    />

    <!-- Edit / create form modal — reused from the existing pod flow. -->
    <MedicationFormModal
      :open="formModalOpen"
      :member-id="memberId"
      :medication="editingMedication"
      @close="closeModals"
    />
  </div>
</template>
