<script setup lang="ts">
/**
 * Notes tab — list of MemberNote cards (title + body preview). Click
 * to edit; AddTile appends. No rich formatting yet.
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import MemberNoteFormModal from '@/components/pod/MemberNoteFormModal.vue';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import type { MemberNote, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const notesStore = useMemberNotesStore();

const notes = computed(() => notesStore.byMember(props.memberId).value);

const modalOpen = ref(false);
const editing = ref<MemberNote | null>(null);
useQuickAddIntent((action) => {
  if (action === 'add-note') {
    editing.value = null;
    modalOpen.value = true;
  }
});

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(n: MemberNote): void {
  editing.value = n;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}
</script>

<template>
  <div>
    <div v-if="notes.length" class="grid gap-3 md:grid-cols-2">
      <button
        v-for="n in notes"
        :key="n.id"
        type="button"
        class="flex flex-col items-start gap-2 rounded-[var(--sq)] bg-white p-4 text-left shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        @click="openEdit(n)"
      >
        <h4 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
          {{ n.title }}
        </h4>
        <p class="font-outfit text-secondary-500/70 line-clamp-4 text-sm dark:text-gray-400">
          {{ n.body }}
        </p>
      </button>
      <AddTile :label="t('memberNotes.addTile')" @click="openAdd" />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="📝"
        :message="t('memberNotes.empty')"
        :action-label="t('memberNotes.emptyCTA')"
        @action="openAdd"
      />
    </div>

    <MemberNoteFormModal
      :open="modalOpen"
      :member-id="memberId"
      :note="editing"
      @close="closeModal"
    />
  </div>
</template>
