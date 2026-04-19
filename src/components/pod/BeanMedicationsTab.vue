<script setup lang="ts">
/**
 * Medications tab — card per Medication. Active (ongoing OR today
 * within [start, end]) sort first. Inactive entries dim so the list
 * reads as "what they're on now" vs "history".
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import MedicationCard from '@/components/pod/MedicationCard.vue';
import MedicationFormModal from '@/components/pod/MedicationFormModal.vue';
import { useAutoOpenOnQuery } from '@/composables/useAutoOpenOnQuery';
import { useTranslation } from '@/composables/useTranslation';
import { isMedicationActive, useMedicationsStore } from '@/stores/medicationsStore';
import type { Medication, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const medicationsStore = useMedicationsStore();

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

const modalOpen = ref(false);
const editing = ref<Medication | null>(null);
useAutoOpenOnQuery(modalOpen);

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(m: Medication): void {
  editing.value = m;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}
</script>

<template>
  <div>
    <div v-if="medications.length" class="grid gap-3 md:grid-cols-2">
      <MedicationCard v-for="m in medications" :key="m.id" :medication="m" @click="openEdit(m)" />
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

    <MedicationFormModal
      :open="modalOpen"
      :member-id="memberId"
      :medication="editing"
      @close="closeModal"
    />
  </div>
</template>
