<script setup lang="ts">
/**
 * Medications tab — card per Medication. Active (ongoing OR today
 * within [start, end]) sort first. Inactive entries dim so the list
 * reads as "what they're on now" vs "history".
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import MedicationFormModal from '@/components/pod/MedicationFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMedicationsStore } from '@/stores/medicationsStore';
import type { Medication, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const medicationsStore = useMedicationsStore();

function isActive(m: Medication): boolean {
  if (m.ongoing) return true;
  const today = new Date().toISOString().slice(0, 10);
  if (m.endDate && m.endDate < today) return false;
  if (m.startDate && m.startDate > today) return false;
  return true;
}

const medications = computed(() => {
  const list = medicationsStore.byMember(props.memberId).value;
  // Active first, then alphabetical by name for stable ordering.
  return [...list].sort((a, b) => {
    const aActive = isActive(a) ? 0 : 1;
    const bActive = isActive(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name);
  });
});

const modalOpen = ref(false);
const editing = ref<Medication | null>(null);

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

function scheduleLabel(m: Medication): string {
  if (m.ongoing) return t('medications.active');
  const parts: string[] = [];
  if (m.startDate) parts.push(m.startDate);
  if (m.endDate) parts.push(`→ ${m.endDate}`);
  return parts.join(' ');
}
</script>

<template>
  <div>
    <div v-if="medications.length" class="grid gap-3 md:grid-cols-2">
      <button
        v-for="m in medications"
        :key="m.id"
        type="button"
        class="flex flex-col items-start gap-2 rounded-[var(--sq)] bg-white p-4 text-left shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        :class="{ 'opacity-60': !isActive(m) }"
        @click="openEdit(m)"
      >
        <div class="flex w-full items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-xl" aria-hidden="true">💊</span>
            <h4 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
              {{ m.name }}
            </h4>
          </div>
          <span
            class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
            :class="
              isActive(m)
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400'
            "
          >
            {{ isActive(m) ? t('medications.active') : t('medications.ended') }}
          </span>
        </div>
        <p class="font-outfit text-secondary-500/70 text-sm dark:text-gray-400">
          {{ m.dose }} · {{ m.frequency }}
        </p>
        <p
          v-if="!m.ongoing && (m.startDate || m.endDate)"
          class="font-outfit text-secondary-500/50 text-[11px] tracking-wide uppercase"
        >
          {{ scheduleLabel(m) }}
        </p>
        <p
          v-if="m.notes"
          class="font-outfit text-secondary-500/70 line-clamp-2 text-xs dark:text-gray-400"
        >
          {{ m.notes }}
        </p>
      </button>
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
