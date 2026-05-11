/**
 * Eager-entity-create lifecycle composable.
 *
 * Owns the gate → create → cache → 3-branch-on-save flow used by every
 * form modal that supports "tap an action (e.g. attach a photo) before
 * the form is fully filled in, and we'll create the entity for you so
 * the action can attach". Today this is milestones, medications,
 * recipes; activities adopts it next.
 *
 * Replaces the per-modal `ensureXId()` + `handleSave()` 3-branch logic.
 *
 * UX contract for consumers:
 * - Disable the action button when `firstMissingField()` returns non-null,
 *   and surface an inline hint naming the missing field (don't toast a
 *   gate fail — it's not an error, it's a precondition).
 * - When `ensureId()` returns null with the gate currently passing,
 *   the store-side create rejected: surface an error toast (the store
 *   has already reported to errorReporter via wrapAsync).
 * - Use `commit()` from the form's Save handler — it picks update vs
 *   create automatically. Toast on null return.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { UUID } from '@/types/models';

export interface EagerEntityCreateOptions<TEntity extends { id: UUID }, TPayload> {
  /** Returns the existing entity id (edit mode) OR null. */
  resolveExistingId: () => UUID | null;
  /**
   * Returns the first required field that's missing (consumer-defined string),
   * or null if the gate passes. Used by the consumer to drive both the
   * disabled-button state and the inline hint text.
   */
  firstMissingField: () => string | null;
  /** Builds the create/update payload from the form state. */
  buildPayload: () => TPayload;
  /**
   * Store-side create. Returns null on store-level failure (which has
   * already been reported via the store's wrapAsync → errorReporter chain).
   */
  create: (payload: TPayload) => Promise<TEntity | null>;
  /** Store-side update. Used by `commit()` when the entity already exists. */
  update: (id: UUID, payload: Partial<TPayload>) => Promise<TEntity | null>;
}

export interface EagerEntityCreateApi<TEntity extends { id: UUID }> {
  /**
   * Resolved id — existing OR eager-created OR null. Reactive — bind
   * directly in templates: `<X v-if="entityId" :entity-id="entityId">`.
   */
  entityId: ComputedRef<UUID | null>;
  /** True iff eager-create has fired in this composable's lifetime. */
  wasEagerCreated: ComputedRef<boolean>;
  /** True while a `create` call is in flight. Use to disable buttons. */
  isCreating: Readonly<Ref<boolean>>;
  /**
   * Returns the entity id, eager-creating if needed.
   *
   * Returns null when:
   * - the gate fails (`firstMissingField()` returns non-null), OR
   * - the in-flight re-entry guard trips (parallel call), OR
   * - the store-side `create` returns null.
   *
   * Consumer disambiguates failure modes by re-checking `firstMissingField()`
   * at the call site: still non-null → gate; null → create rejected.
   *
   * Idempotent: a second call after a successful eager-create returns the
   * cached id without calling `create` again.
   */
  ensureId: () => Promise<UUID | null>;
  /**
   * Persist the form. Branches on entity existence:
   * - existing entity (edit-mode OR eager-created) → calls `update`
   * - no entity → calls `create`
   *
   * Returns the persisted entity, or null on gate-fail / store-level error.
   * Consumer should toast the user when this returns null.
   */
  commit: () => Promise<TEntity | null>;
  /**
   * Clear the eager-created id cache. Call from the form modal's "open
   * for new entity" handler — without this, a closed-then-reopened modal
   * would still see the previous eager-created entity as the target.
   * No-op when nothing has been eager-created.
   */
  reset: () => void;
}

export function useEagerEntityCreate<TEntity extends { id: UUID }, TPayload>(
  opts: EagerEntityCreateOptions<TEntity, TPayload>
): EagerEntityCreateApi<TEntity> {
  const eagerCreatedId = ref<UUID | null>(null);
  const isCreating = ref(false);

  const entityId = computed<UUID | null>(() => opts.resolveExistingId() ?? eagerCreatedId.value);
  const wasEagerCreated = computed(() => eagerCreatedId.value !== null);

  async function ensureId(): Promise<UUID | null> {
    const existing = entityId.value;
    if (existing) return existing;

    if (opts.firstMissingField() !== null) return null;
    if (isCreating.value) return null;

    isCreating.value = true;
    try {
      const created = await opts.create(opts.buildPayload());
      if (!created) return null;
      eagerCreatedId.value = created.id;
      return created.id;
    } finally {
      isCreating.value = false;
    }
  }

  async function commit(): Promise<TEntity | null> {
    const id = entityId.value;
    if (id) {
      return opts.update(id, opts.buildPayload());
    }
    if (opts.firstMissingField() !== null) return null;
    return opts.create(opts.buildPayload());
  }

  function reset(): void {
    eagerCreatedId.value = null;
  }

  return { entityId, wasEagerCreated, isCreating, ensureId, commit, reset };
}
