/**
 * Coverage for the capture wedge's ATTACH step (#72).
 *
 * This composable had no tests at all, which is why "the photo does not appear and nothing
 * says it is coming" took a live repro to pin down instead of a test run. The attach step is
 * the part with real branching — dish image only, source file only, both, neither — and it
 * owns the `isAttaching` flag the UI renders, so it is worth pinning properly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

const photosAdd = vi.fn().mockResolvedValue([{ id: 'p1' }]);
const fetchImage = vi.fn();

vi.mock('../usePhotos', () => ({
  usePhotos: () => ({ add: photosAdd, canAdd: ref(true) }),
}));
vi.mock('@/services/ai/recipeFetchService', () => ({
  recipeFetchService: { fetchImage: (...a: unknown[]) => fetchImage(...a) },
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../useAiCapability', () => ({
  useAiCapability: () => ({ tier: ref('managed'), byokConfig: ref(null), aiAvailable: ref(true) }),
}));
vi.mock('../useOnline', () => ({ useOnline: () => ({ isOnline: ref(true) }) }));

const resolveRecipeSource = vi.fn();
vi.mock('@/services/ai/recipeSourceResolver', () => ({
  resolveRecipeSource: (...a: unknown[]) => resolveRecipeSource(...a),
}));

import { useRecipeCapture } from '../useRecipeCapture';
import { useRecipePhotoPending } from '../useRecipePhotoPending';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

describe('attachAfterSave', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    photosAdd.mockResolvedValue([{ id: 'p1' }]);
    fetchImage.mockResolvedValue({ success: true, data: { mime: 'image/jpeg', dataUrl: JPEG } });
    // jsdom has no fetch(data:) -> blob(); the composable converts the data URL that way.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['x']) }));
  });

  function make() {
    return useRecipeCapture({ onRecipeReady: vi.fn() });
  }

  /** Drive the real link path so the dish URL is held exactly as production holds it. */
  async function captureFromLink() {
    resolveRecipeSource.mockResolvedValue({
      kind: 'jsonld',
      path: 'youtube_link_followed',
      sourceUrl: 'https://preppykitchen.com/pumpkin-pie-2/',
      imageUrl: 'https://preppykitchen.com/img.jpg',
      recipe: {
        name: 'Pumpkin Pie',
        ingredients: ['1 crust'],
        steps: ['bake'],
        imageUrl: 'https://preppykitchen.com/img.jpg',
      },
    });
    const c = make();
    await c.processUrl('https://www.youtube.com/watch?v=PmuCEQTy-9E');
    return c;
  }

  it('is not pending before anything is captured', () => {
    make();
    expect(useRecipePhotoPending().isPending('r1')).toBe(false);
  });

  it('fetches the dish image for a pasted link and attaches it', async () => {
    const c = await captureFromLink();
    await c.attachAfterSave('r1' as never);
    expect(fetchImage).toHaveBeenCalledWith('https://preppykitchen.com/img.jpg');
    expect(photosAdd).toHaveBeenCalledTimes(1);
  });

  it('MARKS the recipe pending while its dish image is in flight', async () => {
    // The user-visible half: the recipe saves instantly and the photo lands seconds later,
    // so the card and the hero must say the photo is still coming. Keyed by recipe id, so
    // it shows on the right card rather than as a page-wide banner.
    const c = await captureFromLink();
    let duringFetch: boolean | undefined;
    let otherRecipe: boolean | undefined;
    fetchImage.mockImplementation(async () => {
      duringFetch = useRecipePhotoPending().isPending('r1');
      otherRecipe = useRecipePhotoPending().isPending('r2');
      return { success: true, data: { mime: 'image/jpeg', dataUrl: JPEG } };
    });
    await c.attachAfterSave('r1' as never);
    expect(duringFetch).toBe(true);
    expect(otherRecipe).toBe(false);
  });

  it('CLEARS pending on the dish-image-only path — no source file', async () => {
    // THE BUG THIS PINS. A pasted link yields a dish image and NO source file, and the
    // early `if (!file) return` sat ABOVE the try/finally that clears the marker — so the
    // recipe would have stayed marked forever. A permanent "adding the photo…" caption is
    // worse than the missing photo it describes.
    const c = await captureFromLink();
    await c.attachAfterSave('r1' as never);
    expect(useRecipePhotoPending().isPending('r1')).toBe(false);
  });

  it('CLEARS isAttaching even when the image fetch fails', async () => {
    fetchImage.mockResolvedValue({ success: false, errorCode: 'fetch_blocked' });
    const c = await captureFromLink();
    await c.attachAfterSave('r1' as never);
    expect(useRecipePhotoPending().isPending('r1')).toBe(false);
  });

  it('CLEARS isAttaching even when the image fetch throws', async () => {
    fetchImage.mockRejectedValue(new Error('boom'));
    const c = await captureFromLink();
    await c.attachAfterSave('r1' as never);
    expect(useRecipePhotoPending().isPending('r1')).toBe(false);
  });

  it('never marks pending when there is nothing to attach', async () => {
    const c = make();
    await c.attachAfterSave('r1' as never);
    expect(useRecipePhotoPending().isPending('r1')).toBe(false);
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
