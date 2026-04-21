<script setup lang="ts">
/**
 * Medications tab — card per Medication. Active (ongoing OR today
 * within [start, end]) sort first. Inactive entries dim so the list
 * reads as "what they're on now" vs "history".
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
import { useAutoOpenOnQuery } from '@/composables/useAutoOpenOnQuery';
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

const medications = computed(() => {
  const list = medicationsStore.byMember(props.memberId).value;
  // Active first, then alphabetical by name for stable ordering.
  return [...list].sort((a, b) => {
    const aActive = isMedicationActive(a) ? 0 : 1;
    const bActive = isMedicationActive(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name);
  });
});

// ── Modal state machine ─────────────────────────────────────────────
type ModalState =
  | { kind: 'none' }
  | { kind: 'viewing'; medicationId: UUID }
  | { kind: 'editing'; medication: Medication | null };

const modalState = ref<ModalState>({ kind: 'none' });

// Auto-open `?add=medications` / similar query deep links in ADD mode.
const addModalOpen = computed({
  get: () => modalState.value.kind === 'editing' && modalState.value.medication === null,
  set: (value: boolean) => {
    if (value) modalState.value = { kind: 'editing', medication: null };
    else if (modalState.value.kind === 'editing' && modalState.value.medication === null)
      modalState.value = { kind: 'none' };
  },
});
useAutoOpenOnQuery(addModalOpen);

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
  <div>
    <div v-if="medications.length" class="grid gap-3 md:grid-cols-2">
      <MedicationCard
        v-for="m in medications"
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
