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
});
