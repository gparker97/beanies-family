import { computed, onMounted, ref, watch } from 'vue';

/**
 * Provides shared boilerplate for entity CRUD modals:
 * - `isEditing` computed (true when editing an existing entity)
 * - `isSubmitting` ref (set to true while save is in progress)
 * - Watches the open prop and calls onEdit/onNew to load/reset form fields
 *
 * ⚠️ THE CONTRACT IS "OPEN ⇒ SEEDED", not "open CHANGED ⇒ seeded". A modal whose parent sets
 * `open` to true BEFORE the modal's first render sees no transition, so a watch alone never
 * fires `onNew`/`onEdit` and the form draws every field blank — silently, with a perfectly
 * good prefill sitting in its props. That is not hypothetical: a caller opened this from its
 * parent's `setup()` (a `watch(..., { immediate: true })` that ran before the child mounted)
 * and shipped exactly that. The same trap is documented at `FamilyCookbookPage.openAdd`.
 *
 * ⚠️ AND THE ALREADY-OPEN SEED RUNS FROM `onMounted`, NOT FROM `{ immediate: true }`.
 * `immediate` fires synchronously partway through the consumer's `setup()`, so any `onNew`
 * that closes over a `const` declared BELOW its `useFormModal(...)` call throws
 * `ReferenceError: Cannot access '…' before initialization` — `TransactionModal.onNew` does
 * exactly that with `linkPromptDismissed`, and it is a hard throw at setup rather than a
 * subtle bug. `onMounted` runs after the whole setup body, so every binding is initialised
 * whatever order a consumer declares things in. Twenty-two modals use this; the seed must
 * not depend on any of them getting their declaration order right.
 *
 * Both paths are a no-op for a modal mounted closed — the `seed()` guard below — which is
 * every consumer in the codebase today.
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

  function seed(): void {
    if (!getOpen()) return;
    const entity = getEntity();
    if (entity) {
      options.onEdit(entity);
    } else {
      options.onNew();
    }
  }

  // The ordinary path: the parent flips `open` while the modal is already mounted.
  watch(getOpen, seed);
  // The already-open path: the parent opened it before this component ever rendered.
  onMounted(seed);

  return { isEditing, isSubmitting };
}
