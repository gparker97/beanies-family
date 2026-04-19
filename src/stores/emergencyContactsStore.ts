import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/emergencyContactRepository';
import type { EmergencyContact, EmergencyContactCategory } from '@/types/models';

type CreateInput = Omit<EmergencyContact, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

export const useEmergencyContactsStore = defineStore('emergencyContacts', () => {
  const contacts = ref<EmergencyContact[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byCategory(category: EmergencyContactCategory) {
    return computed(() => contacts.value.filter((c) => c.category === category));
  }

  /**
   * Search across name, role, phone, email. Used by the Emergency Contacts
   * page search bar. Case-insensitive, trims whitespace.
   */
  function search(query: string) {
    return computed(() => {
      const q = query.trim().toLowerCase();
      if (!q) return contacts.value;
      return contacts.value.filter((c) =>
        [c.name, c.role, c.phone, c.email]
          .filter((v): v is string => !!v)
          .some((v) => v.toLowerCase().includes(q))
      );
    });
  }

  async function loadEmergencyContacts() {
    await wrapAsync(isLoading, error, async () => {
      contacts.value = await repo.getAllEmergencyContacts();
    });
  }

  async function createContact(input: CreateInput): Promise<EmergencyContact | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createEmergencyContact(input);
      contacts.value = [...contacts.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateContact(id: string, input: UpdateInput): Promise<EmergencyContact | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateEmergencyContact(id, input);
      if (updated) contacts.value = contacts.value.map((c) => (c.id === id ? updated : c));
      return updated;
    });
    return result ?? null;
  }

  async function deleteContact(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteEmergencyContact(id);
      contacts.value = contacts.value.filter((c) => c.id !== id);
    });
  }

  return {
    contacts,
    isLoading,
    error,
    byCategory,
    search,
    loadEmergencyContacts,
    createContact,
    updateContact,
    deleteContact,
  };
});
