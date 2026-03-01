import { computed, ref, watch } from 'vue';

/**
 * Provides shared boilerplate for entity CRUD modals:
 * - `isEditing` computed (true when editing an existing entity)
 * - `isSubmitting` ref (set to true while save is in progress)
 * - Watches the open prop and calls onEdit/onNew to load/reset form fields
 */
export function useFormModal<T>(
  getEntity: () => T | undefined | null,
  getOpen: () => boolean,
  options: {
    onEdit: (entity: T) => void;
    onNew: () => void;
  }
) {
  const isEditing = computed(() => !!getEntity());
  const isSubmitting = ref(false);

  watch(getOpen, (isOpen) => {
    if (!isOpen) return;
    const entity = getEntity();
    if (entity) {
      options.onEdit(entity);
    } else {
      options.onNew();
    }
  });

  return { isEditing, isSubmitting };
}
