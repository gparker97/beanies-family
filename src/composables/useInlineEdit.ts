import { ref } from 'vue';
import type { Ref } from 'vue';

export interface UseInlineEditOptions<F extends string> {
  /** Populate draft ref(s) from the current entity before editing starts */
  populateDraft: (field: F) => void;
  /** Persist the draft value to the store. Called with the field name. */
  saveDraft: (field: F) => Promise<void> | void;
}

export function useInlineEdit<F extends string>(options: UseInlineEditOptions<F>) {
  const editingField: Ref<F | null> = ref(null);

  function startEdit(field: F) {
    // Auto-save previous field if switching
    if (editingField.value && editingField.value !== field) {
      options.saveDraft(editingField.value);
    }
    options.populateDraft(field);
    editingField.value = field;
  }

  async function saveField(field: F) {
    editingField.value = null;
    await options.saveDraft(field);
  }

  function cancelEdit() {
    editingField.value = null;
  }

  /** Save any in-progress field (call before closing modal) */
  async function saveAndClose() {
    if (editingField.value) {
      await saveField(editingField.value);
    }
  }

  function isEditing(field: F): boolean {
    return editingField.value === field;
  }

  return {
    editingField: editingField as Ref<F | null>,
    startEdit,
    saveField,
    cancelEdit,
    saveAndClose,
    isEditing,
  };
}
