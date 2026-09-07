/**
 * The receiving surface (#92).
 *
 * Two things matter here and neither is provable from the decoder's own tests. First, the
 * recipe renders for a visitor with no account and no pod — that is the whole feature.
 * Second, a failed decode NEVER says which check refused: the discriminated reason is a
 * developer diagnostic, and showing it to whoever holds the link is an oracle.
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SharedRecipePage from '@/pages/SharedRecipePage.vue';
import { encodeRecipeShare, type SharedRecipeFields } from '@/utils/recipeShareLink';
import { stashKeptRecipe } from '@/utils/recipeKeepStash';
import { showToast } from '@/composables/useToast';
import type { Recipe } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/recipeKeepStash', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/recipeKeepStash')>()),
  stashKeptRecipe: vi.fn(() => true),
}));

const push = vi.fn();
let hash = '';
vi.mock('vue-router', () => ({
  useRoute: () => ({
    get hash() {
      return hash;
    },
    params: {},
    query: {},
  }),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

let authed = false;
let hasPodFlag = false;
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    get isAuthenticated() {
      return authed;
    },
    get podCreated() {
      return hasPodFlag;
    },
  }),
}));

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r-1',
    name: 'Lemon Drizzle Cake',
    subtitle: 'the one that never lasts a day',
    prepTime: '20 mins',
    cookTime: '45 mins',
    servings: 'Serves 8',
    ingredients: ['225g unsalted butter', '4 large eggs'],
    steps: ['Heat the oven to 180C.', 'Beat the butter and sugar.'],
    notes: 'Keeps three days in a tin.',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function mountAt(fragment: string) {
  hash = fragment;
  return mount(SharedRecipePage);
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.mocked(stashKeptRecipe).mockReturnValue(true);
  authed = false;
  hasPodFlag = false;
});

describe('a decoded recipe', () => {
  it('renders the whole recipe for a visitor with no account', () => {
    const w = mountAt('#' + encodeRecipeShare(recipe()));
    const text = w.text();
    expect(text).toContain('Lemon Drizzle Cake');
    expect(text).toContain('the one that never lasts a day');
    expect(text).toContain('225g unsalted butter');
    expect(text).toContain('Heat the oven to 180C.');
    expect(text).toContain('Keeps three days in a tin.');
    expect(text).toContain('20 mins');
    // The recipe comes first; the offer is present but never a wall in front of it.
    expect(w.find('[data-testid="shared-recipe-keep"]').exists()).toBe(true);
  });

  it('tells a signed-out visitor how to recover a keep BEFORE they sign up', () => {
    // After the iOS Drive OAuth hop the loss is undetectable by construction, so the
    // recovery has to be stated while we can still say it.
    const w = mountAt('#' + encodeRecipeShare(recipe()));
    expect(w.text()).toContain('recipeShare.received.keepAcrossSignup');
  });

  it('does not show that line to someone who already has a pod', () => {
    authed = true;
    hasPodFlag = true;
    const w = mountAt('#' + encodeRecipeShare(recipe()));
    expect(w.text()).not.toContain('recipeShare.received.keepAcrossSignup');
  });

  it('renders no source link when the shared recipe had none', () => {
    const w = mountAt('#' + encodeRecipeShare(recipe({ sourceUrl: undefined })));
    expect(w.text()).not.toContain('recipeShare.received.source');
  });
});

describe('keeping', () => {
  it('routes a podless visitor to onboarding, and one with a pod to the cookbook', async () => {
    const w = mountAt('#' + encodeRecipeShare(recipe()));
    await w.get('[data-testid="shared-recipe-keep"]').trigger('click');
    expect(push).toHaveBeenCalledWith('/welcome');

    push.mockClear();
    authed = true;
    hasPodFlag = true;
    const w2 = mountAt('#' + encodeRecipeShare(recipe()));
    await w2.get('[data-testid="shared-recipe-keep"]').trigger('click');
    expect(push).toHaveBeenCalledWith('/pod/cookbook');
  });

  it('says so rather than routing to an empty cookbook when storage refuses the stash', async () => {
    vi.mocked(stashKeptRecipe).mockReturnValue(false);
    const w = mountAt('#' + encodeRecipeShare(recipe()));
    await w.get('[data-testid="shared-recipe-keep"]').trigger('click');
    expect(push).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'recipeShare.received.keepFailed',
      'recipeShare.received.keepFailedHelp'
    );
  });
});

describe('failures never name the check that refused', () => {
  const asFragment = (obj: unknown) =>
    '#' +
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  it.each([
    ['no fragment at all', ''],
    ['garbage', '#!!!not-base64!!!'],
    ['valid base64, not JSON', '#' + btoa('{not json')],
  ])('%s → the one dead-end, with no diagnostic', (_label, fragment) => {
    const w = mountAt(fragment);
    const text = w.text();
    expect(text).toContain('recipeShare.received.deadEndTitle');
    // Not one of the discriminated reasons reaches the screen.
    for (const reason of ['empty', 'bad-encoding', 'bad-json', 'not-an-object', 'no-name']) {
      expect(text).not.toContain(reason);
    }
    expect(w.find('[data-testid="shared-recipe-keep"]').exists()).toBe(false);
  });

  it('a payload with no name is the SAME dead-end as garbage — not its own message', () => {
    const w = mountAt(asFragment({ v: 1, i: ['flour'] }));
    expect(w.text()).toContain('recipeShare.received.deadEndTitle');
    expect(w.text()).not.toContain('recipeShare.received.staleTitle');
  });

  it('an unknown wire version gets its own actionable screen, because it HAS an answer', () => {
    const w = mountAt(asFragment({ v: 99, n: 'Cake' }));
    expect(w.text()).toContain('recipeShare.received.staleTitle');
    expect(w.text()).not.toContain('recipeShare.received.deadEndTitle');
  });
});

describe('the decoded fields the page renders', () => {
  it('renders script-looking text as inert data, never as markup', () => {
    const fields: SharedRecipeFields = {
      name: '<script>alert(1)</script>',
      ingredients: [],
      steps: [],
    };
    const w = mountAt('#' + encodeRecipeShare(recipe({ name: fields.name })));
    expect(w.text()).toContain('<script>alert(1)</script>');
    expect(w.html()).not.toContain('<script>alert(1)</script>');
  });
});
