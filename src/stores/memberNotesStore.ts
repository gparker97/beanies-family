import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/memberNoteRepository';
import type { MemberNote } from '@/types/models';

type CreateInput = Omit<MemberNote, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

export const useMemberNotesStore = defineStore('memberNotes', () => {
  const notes = ref<MemberNote[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byMember(memberId: string) {
    return computed(() => notes.value.filter((n) => n.memberId === memberId));
  }

  async function loadMemberNotes() {
    await wrapAsync(isLoading, error, async () => {
      notes.value = await repo.getAllMemberNotes();
    });
  }

  async function createMemberNote(input: CreateInput): Promise<MemberNote | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createMemberNote(input);
      notes.value = [...notes.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateMemberNote(id: string, input: UpdateInput): Promise<MemberNote | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateMemberNote(id, input);
      if (updated) notes.value = notes.value.map((n) => (n.id === id ? updated : n));
      return updated;
    });
    return result ?? null;
  }

  async function deleteMemberNote(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteMemberNote(id);
      notes.value = notes.value.filter((n) => n.id !== id);
    });
  }

  return {
    notes,
    isLoading,
    error,
    byMember,
    loadMemberNotes,
    createMemberNote,
    updateMemberNote,
    deleteMemberNote,
  };
});
