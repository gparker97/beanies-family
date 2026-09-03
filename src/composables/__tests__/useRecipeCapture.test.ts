/**
 * Coverage for the capture wedge's ATTACH step (#72).
 *
 * This composable had no tests at all, which is why "the photo does not appear and nothing
 * says it is coming" took a live repro to pin down instead of a test run. The attach step is
 * the part with real branching — dish image only, source file only, both, neither — and it
 * owns the `isAttaching` flag the UI renders, so it is worth pinning properly.
 */
import { __testConsentGrant } from '@/test/consentGrant';
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
import { logEvent } from '@/services/telemetry/logEvent';
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
    await c.processUrl('https://www.youtube.com/watch?v=PmuCEQTy-9E', __testConsentGrant);
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

describe('processUrl — the title-only fallback', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('hands over a NAMED, LINKED recipe with nothing invented in it', async () => {
    // A video whose method is only spoken aloud. The title is quoted verbatim as the name
    // and the video becomes the source link; ingredients and steps stay EMPTY for the user
    // to type. Filling either of them here would be reconstructing a recipe from a title,
    // which is the one thing this path must never do.
    resolveRecipeSource.mockResolvedValue({
      kind: 'titleOnly',
      title: 'Pumpkin Pie',
      sourceUrl: 'https://youtu.be/PmuCEQTy-9E',
      path: 'youtube_description',
    });
    const onRecipeReady = vi.fn();
    const c = useRecipeCapture({ onRecipeReady });

    await c.processUrl('https://youtu.be/PmuCEQTy-9E', __testConsentGrant);

    expect(onRecipeReady).toHaveBeenCalledTimes(1);
    const { prefill, sourceFile } = onRecipeReady.mock.calls[0][0];
    // A link has no file to attach — only the name and the URL.
    expect(sourceFile).toBeNull();
    expect(prefill.fields.name).toBe('Pumpkin Pie');
    expect(prefill.fields.ingredients).toEqual([]);
    expect(prefill.fields.steps).toEqual([]);
    expect(prefill.fields.sourceUrl).toBe('https://youtu.be/PmuCEQTy-9E');
    // Nothing was inferred, so nothing may be flagged as inferred.
    expect(prefill.inferredIngredients).toEqual([]);
    expect(prefill.inferredSteps).toEqual([]);
  });
});

// ─── The compensating `start` event (#84) ────────────────────────────────────
//
// `recipe-extract` pairs a `start` with a `ready` so a failure RATE is computable. A capture
// read by the ORCHESTRATOR — a share, or the in-app magic-beans button — never passes through
// the `start` that `processFile`/`processUrl` log before their await, so `deliverRecipe` logs
// it instead.
//
// ⚠️ This block is the assertion plan #84 named and did not get written. The guard tested
// `env.origin === 'share'` before #84 widened the field; left that way, an in-app capture
// would have silently stopped being compensated and the pair would have quietly gone out of
// balance again — the exact regression the production comment warns about, invisible to the
// eight tests that were already here.

describe('deliverRecipe compensates the start event for BOTH orchestrated doors', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const RECIPE_SOURCE = {
    via: 'extraction' as const,
    data: { isRecipe: true, name: 'Cake', ingredients: [], steps: [] },
  };

  function deliver(origin: 'share' | 'in-app' | undefined) {
    const capture = useRecipeCapture({ onRecipeReady: vi.fn() });
    capture.deliverRecipe(
      RECIPE_SOURCE as never,
      {
        sourceFile: null,
        ...(origin ? { origin } : {}),
      } as never
    );
  }

  const startEvents = () =>
    (logEvent as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0]?.context?.action === 'start'
    );

  it('logs start for a SHARE, naming which door', () => {
    deliver('share');
    expect(startEvents()).toHaveLength(1);
    expect(startEvents()[0][0].context.detail).toBe('share');
  });

  it('logs start for an IN-APP capture, naming which door', () => {
    // Tests for PRESENCE, not `=== 'share'`. Reverting that guard makes this the only failing
    // test in the file.
    deliver('in-app');
    expect(startEvents()).toHaveLength(1);
    expect(startEvents()[0][0].context.detail).toBe('in-app');
  });

  it('does NOT log start when the page did its own reading', () => {
    // `processFile`/`processUrl` already logged one; a second would double-count the
    // denominator and make the failure rate look better than it is.
    deliver(undefined);
    expect(startEvents()).toHaveLength(0);
  });
});
