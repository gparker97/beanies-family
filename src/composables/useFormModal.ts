import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { diffPayload } from '@/utils/diffPayload';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * The seam between a modal and its store write. `changes` is what to SEND; `rebaseline`
 * re-anchors the diff after something other than the form wrote the entity (an eager create).
 */
export interface FormDiff<P> {
  /** Full payload when there is no baseline (create); otherwise only the changed fields. A
   *  cleared text field is `undefined` (a delete); an explicit `null` is a write of null (see
   *  `diffPayload`). */
  changes(payload: P): Partial<P>;
  /** Replace the baseline, e.g. right after an eager create so the next save diffs against it. */
  rebaseline(payload: P): void;
}

export interface FormSnapshotOption<P> {
  /**
   * Builds the form payload. MUST be a pure function of form state: a clock or a fresh-id
   * fallback in it is a permanent phantom diff. Emit every field (`orUndefined`) so a clear
   * is representable.
   */
  build: () => P;
  /** Modal name, logged as `kind` on the `form-diff` surface. */
  name: string;
}

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
 *
 * `snapshot` (optional): snapshot-at-open diffing. After `onEdit`, the baseline is captured on
 * the next tick (so values settled by watchers are not phantom edits) and `formDiff.changes(p)`
 * returns only what the user changed. The capture is dropped if the modal closed or reseeded
 * before the tick. See docs/plans/2026-10-01-crdt-merge-safe-writes.md section E.
 *
 * `entityKey` (optional): a modal that stays open while its parent retargets it (a drawer
 * whose entity id changes under it) passes the id here, so a new target reseeds too, not
 * only a change of `open`. Key on the id, never the entity object: a store that rebuilds
 * its objects on every write would otherwise wipe the draft mid-edit.
 */
export function useFormModal<T, P = Record<string, unknown>>(
  getEntity: () => T | undefined | null,
  getOpen: () => boolean,
  options: {
    onEdit: (entity: T) => void;
    onNew: () => void;
    entityKey?: () => unknown;
    snapshot?: FormSnapshotOption<P>;
  }
) {
  const isEditing = computed(() => !!getEntity());
  const isSubmitting = ref(false);

  const snapshot = options.snapshot;
  let baseline: P | null = null;
  // Bumped on every seed; a capture queued by an earlier seed sees a newer value and drops out.
  let seedToken = 0;

  function seed(): void {
    if (!getOpen()) return;
    const token = ++seedToken;
    baseline = null;
    const entity = getEntity();
    if (entity) {
      options.onEdit(entity);
      if (snapshot) {
        void nextTick(() => {
          if (token !== seedToken || !getOpen()) return;
          baseline = snapshot.build();
        });
      }
    } else {
      options.onNew();
    }
  }

  const formDiff: FormDiff<P> = {
    changes(payload) {
      if (!baseline) {
        if (snapshot && isEditing.value) {
          logEvent({
            level: 'warn',
            surface: 'form-diff',
            message: 'edit without baseline',
            context: { kind: snapshot.name },
          });
        }
        return payload as Partial<P>;
      }
      const diff = diffPayload(baseline as object, payload as Partial<object>) as Partial<P>;
      if (snapshot && Object.keys(diff).length === 0) {
        logEvent({
          level: 'debug',
          surface: 'form-diff',
          message: 'empty diff, no write',
          context: { kind: snapshot.name },
        });
      }
      return diff;
    },
    rebaseline(payload) {
      baseline = payload;
    },
  };

  // The ordinary path: the parent flips `open` while the modal is already mounted.
  // Retargeting while open (`entityKey`) reseeds too.
  const entityKey = options.entityKey;
  if (entityKey) watch([getOpen, entityKey], seed);
  else watch(getOpen, seed);
  // The already-open path: the parent opened it before this component ever rendered.
  onMounted(seed);

  return { isEditing, isSubmitting, formDiff };
}
