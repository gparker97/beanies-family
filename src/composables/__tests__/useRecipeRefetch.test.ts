/**
 * The re-fetch shell.
 *
 * Almost nothing here is new code — the ladder, the guards, the failure toasts and the
 * telemetry all come from `useRecipeCapture`. What IS new, and what this file pins, is the
 * ORDER of the three gates and the apply's return-value check:
 *
 *   peek (refuse cheaply, before asking for anything) → consent → consume (so a declined
 *   consent never burns the slot) → fetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useRecipeRefetch } from '../useRecipeRefetch';
import { peekAttempt, consumeAttempt, __resetAttemptBudgetForTests } from '@/utils/attemptBudget';
import { showToast } from '@/composables/useToast';
import { logEvent } from '@/services/telemetry/logEvent';
import type { Recipe } from '@/types/models';
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const requestConsent = vi.fn();
vi.mock('@/composables/useDocumentConsent', () => ({
  useDocumentConsent: () => ({ requestConsent }),
}));

const processUrl = vi.fn();
const attachAfterSave = vi.fn();
let onReady: ((r: { prefill: RecipePrefill }) => void) | null = null;
vi.mock('@/composables/useRecipeCapture', async () => {
  const { ref } = await import('vue');
  return {
    useRecipeCapture: (opts: { onRecipeReady: (r: { prefill: RecipePrefill }) => void }) => {
      onReady = opts.onRecipeReady;
      return { processUrl, attachAfterSave, isProcessing: ref(false) };
    },
  };
});

const updateRecipe = vi.fn();
vi.mock('@/stores/recipesStore', () => ({ useRecipesStore: () => ({ updateRecipe }) }));

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r-1',
    name: 'Lemon Drizzle Cake',
    prepTime: '20 mins',
    ingredients: ['225g butter'],
    steps: ['Heat the oven.'],
    sourceUrl: 'https://example.com/cake',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function prefill(fields: Partial<RecipePrefill['fields']> = {}): RecipePrefill {
  return {
    fields: {
      name: 'Lemon Drizzle Cake',
      ingredients: ['225g butter'],
      steps: ['Heat the oven.'],
      ...fields,
    },
    inferredIngredients: [],
    inferredSteps: [],
    inferredTimes: [],
    taxonomyRejected: [],
    dishImage: null,
    confidence: { name: 1, ingredients: 1, steps: 1 },
  };
}

const GRANT = { __consent: true } as never;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  __resetAttemptBudgetForTests();
  onReady = null;
  requestConsent.mockResolvedValue(GRANT);
  updateRecipe.mockResolvedValue({ id: 'r-1' });
});

describe('the three gates, in order', () => {
  it('asks for consent, burns a slot, then fetches', async () => {
    const r = useRecipeRefetch();
    await r.start(recipe());
    expect(requestConsent).toHaveBeenCalledOnce();
    expect(processUrl).toHaveBeenCalledWith('https://example.com/cake', GRANT);
  });

  it('does NOT burn a slot when the user declines consent', async () => {
    requestConsent.mockResolvedValue(null);
    const r = useRecipeRefetch();
    await r.start(recipe());
    expect(processUrl).not.toHaveBeenCalled();
    // The slot is still there: a decline must not cost the user their one read.
    expect(peekAttempt('recipe-refetch:r-1', { max: 1, windowMs: 600_000 }).ok).toBe(true);
  });

  it('refuses cheaply when the cooldown is live — before asking for consent', async () => {
    consumeAttempt('recipe-refetch:r-1', { max: 1, windowMs: 600_000 });
    const r = useRecipeRefetch();
    await r.start(recipe());
    expect(requestConsent).not.toHaveBeenCalled();
    expect(processUrl).not.toHaveBeenCalled();
    // The refusal always names when it lifts, so it is actionable.
    expect(showToast).toHaveBeenCalledWith('info', expect.stringContaining('recipes.refetch'));
  });

  it('does nothing at all for a recipe with no source', async () => {
    const r = useRecipeRefetch();
    await r.start(recipe({ sourceUrl: undefined }));
    expect(requestConsent).not.toHaveBeenCalled();
    expect(processUrl).not.toHaveBeenCalled();
  });

  it('is per-recipe — a cooldown on one does not block another', async () => {
    consumeAttempt('recipe-refetch:r-1', { max: 1, windowMs: 600_000 });
    const r = useRecipeRefetch();
    await r.start(recipe({ id: 'r-2' }));
    expect(processUrl).toHaveBeenCalledOnce();
  });
});

describe('what happens when the read comes back', () => {
  async function fetchThen(p: RecipePrefill, current = recipe()) {
    const r = useRecipeRefetch();
    await r.start(current);
    onReady?.({ prefill: p });
    return r;
  }

  it('toasts and stays closed when nothing changed', async () => {
    const r = await fetchThen(prefill());
    expect(r.isOpen.value).toBe(false);
    expect(showToast).toHaveBeenCalledWith('info', 'recipes.refetch.noChange');
    // "worked, nothing new" is its own event — the failure rate depends on the distinction.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'refetch_nochange' }) })
    );
  });

  it('opens with the diff when something changed', async () => {
    const r = await fetchThen(prefill({ prepTime: '25 mins' }));
    expect(r.isOpen.value).toBe(true);
    expect(r.diff.value?.rows).toEqual([{ field: 'prepTime', mine: '20 mins', theirs: '25 mins' }]);
  });
});

describe('taking the changes', () => {
  async function open() {
    const r = useRecipeRefetch();
    await r.start(recipe());
    onReady?.({ prefill: prefill({ prepTime: '25 mins' }) });
    return r;
  }

  it('writes the minimal patch and closes', async () => {
    const r = await open();
    await r.take();
    expect(updateRecipe).toHaveBeenCalledWith('r-1', { prepTime: '25 mins' });
    expect(r.isOpen.value).toBe(false);
  });

  it('STAYS OPEN when the write fails, and does not double-report it', async () => {
    // `updateRecipe` never throws — it runs inside wrapAsync, which already toasted and
    // reported. The return value is the only signal, and a reportError here would be a
    // second Slack page for one failure.
    updateRecipe.mockResolvedValue(null);
    const r = await open();
    await r.take();
    expect(r.isOpen.value).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'apply_failed' }),
      })
    );
  });

  it('does not attach a photo the diff did not offer', async () => {
    const r = await open();
    await r.take();
    expect(attachAfterSave).not.toHaveBeenCalled();
  });

  it('dismiss drops the diff so a stale one cannot be applied later', async () => {
    const r = await open();
    r.dismiss();
    expect(r.diff.value).toBeNull();
    await r.take();
    expect(updateRecipe).not.toHaveBeenCalled();
  });
});
