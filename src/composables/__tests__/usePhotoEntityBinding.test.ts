import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, ref, type Ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { usePhotoEntityBinding } from '../usePhotoEntityBinding';
import * as toastModule from '../useToast';
import * as reporterModule from '@/utils/errorReporter';

const FIXTURE_ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_A = '22222222-2222-4222-8222-222222222222';
const PHOTO_B = '33333333-3333-4333-8333-333333333333';

interface HarnessOptions {
  entityId?: Ref<string | null>;
  initialPhotoIds?: () => string[] | undefined;
  watchSource?: () => unknown;
  update?: (id: string, patch: { photoIds: string[] }) => Promise<unknown | null>;
  surface?: string;
}

function makeHarness(opts: HarnessOptions = {}) {
  const update = vi.fn(opts.update ?? (async () => ({ ok: true })));
  const watchSourceRef = ref<unknown>(0);

  const scope = effectScope();
  const api = scope.run(() =>
    usePhotoEntityBinding({
      entityId: opts.entityId ?? ref(FIXTURE_ENTITY_ID),
      initialPhotoIds: opts.initialPhotoIds ?? (() => []),
      watchSource: opts.watchSource ?? (() => watchSourceRef.value),
      update,
      surface: opts.surface ?? 'TestSurface',
    })
  )!;

  return { api, update, scope, watchSourceRef };
}

describe('usePhotoEntityBinding', () => {
  let toastSpy: ReturnType<typeof vi.spyOn>;
  let reportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    toastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    reportSpy = vi.spyOn(reporterModule, 'reportError').mockImplementation(() => {});
  });

  afterEach(() => {
    toastSpy.mockRestore();
    reportSpy.mockRestore();
  });

  it('initial photoIds reflects initialPhotoIds()', () => {
    const { api } = makeHarness({ initialPhotoIds: () => [PHOTO_A] });
    expect(api.photoIds.value).toEqual([PHOTO_A]);
  });

  it('initial photoIds is empty when initialPhotoIds() returns undefined', () => {
    const { api } = makeHarness({ initialPhotoIds: () => undefined });
    expect(api.photoIds.value).toEqual([]);
  });

  it('re-syncs photoIds when watchSource changes', async () => {
    let backing: string[] = [PHOTO_A];
    const { api, watchSourceRef } = makeHarness({
      initialPhotoIds: () => backing,
    });
    expect(api.photoIds.value).toEqual([PHOTO_A]);

    backing = [PHOTO_A, PHOTO_B];
    watchSourceRef.value = 1; // trigger watcher
    await Promise.resolve();
    await Promise.resolve();
    expect(api.photoIds.value).toEqual([PHOTO_A, PHOTO_B]);
  });

  it('updatePhotoIds writes optimistically and persists via update()', async () => {
    const { api, update } = makeHarness({ initialPhotoIds: () => [] });

    await api.updatePhotoIds([PHOTO_A]);

    expect(update).toHaveBeenCalledWith(FIXTURE_ENTITY_ID, { photoIds: [PHOTO_A] });
    expect(api.photoIds.value).toEqual([PHOTO_A]);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('updatePhotoIds reverts and toasts when update() returns null', async () => {
    const { api } = makeHarness({
      initialPhotoIds: () => [PHOTO_A],
      update: async () => null,
    });

    await api.updatePhotoIds([PHOTO_A, PHOTO_B]);

    expect(api.photoIds.value).toEqual([PHOTO_A]); // reverted
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ surface: 'TestSurface' })
    );
  });

  it('updatePhotoIds reverts and toasts when update() returns undefined', async () => {
    const { api } = makeHarness({
      initialPhotoIds: () => [PHOTO_A],
      update: async () => undefined,
    });

    await api.updatePhotoIds([PHOTO_A, PHOTO_B]);

    expect(api.photoIds.value).toEqual([PHOTO_A]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('updatePhotoIds calls reportError and skips update() when entityId is null', async () => {
    const { api, update } = makeHarness({
      entityId: ref<string | null>(null),
      initialPhotoIds: () => [],
      surface: 'NullIdSurface',
    });

    await api.updatePhotoIds([PHOTO_A]);

    expect(update).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'NullIdSurface',
        message: expect.stringContaining('without an entity id'),
      })
    );
    // Local state untouched on the no-id path
    expect(api.photoIds.value).toEqual([]);
  });

  describe('background source-content sync', () => {
    it('picks up a background photoId added to the source while no op is in flight', async () => {
      // Simulates the drawer-close-mid-upload bug: the photoStore writes
      // a new photoId directly to entity.photoIds (via attachPhotoToEntity)
      // while the modal is closed. The binding has no watchSource swap
      // (same entity), so the old behavior was to stay stale until a full
      // refresh. The deep watch now catches it.
      const sourceIds = ref<string[]>([PHOTO_A]);
      const { api } = makeHarness({
        initialPhotoIds: () => sourceIds.value,
      });
      expect(api.photoIds.value).toEqual([PHOTO_A]);

      // Simulate background change: photoStore wrote a new id directly.
      sourceIds.value = [PHOTO_A, PHOTO_B];
      await Promise.resolve();
      await Promise.resolve();

      expect(api.photoIds.value).toEqual([PHOTO_A, PHOTO_B]);
    });

    it('does NOT clobber an in-flight optimistic update with a background source change', async () => {
      // Race scenario: user adds a photo (optimistic update fires), and
      // mid-await another change lands on the source. The optimistic
      // snapshot must win until the op resolves.
      const sourceIds = ref<string[]>([]);
      let resolveUpdate: ((v: unknown) => void) | undefined;
      const updatePromise = new Promise((r) => {
        resolveUpdate = r;
      });
      const update = vi.fn(async (_id: string, _patch: { photoIds: string[] }) => updatePromise);

      const { api } = makeHarness({
        initialPhotoIds: () => sourceIds.value,
        update,
      });

      // Start an optimistic update (don't await yet).
      const opPromise = api.updatePhotoIds([PHOTO_A]);
      // Optimistic value should be set synchronously.
      expect(api.photoIds.value).toEqual([PHOTO_A]);

      // While the op is awaiting, simulate a background source change that
      // adds a DIFFERENT photoId.
      sourceIds.value = [PHOTO_B];
      await Promise.resolve();
      await Promise.resolve();

      // Optimistic snapshot must still be the in-flight value, not the
      // background change.
      expect(api.photoIds.value).toEqual([PHOTO_A]);

      // Resolve the op. The finally block re-syncs from source — picks
      // up the background change we missed.
      resolveUpdate!({ ok: true });
      await opPromise;
      await Promise.resolve();

      // After op resolves, local re-syncs from source.
      expect(api.photoIds.value).toEqual([PHOTO_B]);
    });

    it('skips re-render when the source emits a fresh array with the same content', async () => {
      // Defensive: avoids spurious updates if a parent passes a fresh
      // array reference on every render (a common pitfall).
      const sourceIds = ref<string[]>([PHOTO_A]);
      const { api } = makeHarness({
        initialPhotoIds: () => sourceIds.value,
      });
      const initialArrayRef = api.photoIds.value;

      // Same content, new array reference.
      sourceIds.value = [PHOTO_A];
      await Promise.resolve();
      await Promise.resolve();

      // photoIds.value should NOT have been replaced (sameContent check).
      expect(api.photoIds.value).toBe(initialArrayRef);
    });
  });
});
