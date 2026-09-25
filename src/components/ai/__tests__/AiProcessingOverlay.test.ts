/**
 * The resolve moment, and the one thing #108 changed about it: a read the person pre-labelled
 * starts with that tile already lit and nothing ticking, then resolves in place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import AiProcessingOverlay from '@/components/ai/AiProcessingOverlay.vue';

type State =
  | { phase: 'idle' }
  | { phase: 'reading'; presentation: 'global' | 'local'; hint?: string }
  | { phase: 'resolved'; presentation: 'global' | 'local'; kind: string };

// Hoisted: the `vi.mock` factory below runs before this module's own top level. A plain
// `{ value }` rather than a `ref`: every case mounts fresh, so no reactivity is needed.
const { state } = vi.hoisted(() => ({
  state: { value: { phase: 'reading', presentation: 'global' } as State },
}));
vi.mock('@/composables/useSharedDocumentIngest', () => ({
  magicIngestState: state,
  isReadingSharedDocument: { value: true },
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const stubs = { BeanieSpinner: { name: 'BeanieSpinner', template: '<i data-test="spinner" />' } };

const mountOverlay = () => mount(AiProcessingOverlay, { global: { stubs } });
const tiles = (w: ReturnType<typeof mountOverlay>) => w.findAll('li');
const lit = (w: ReturnType<typeof mountOverlay>) =>
  tiles(w)
    .filter((li) => li.find('div').classes().includes('scale-110'))
    .map((li) => li.text());

beforeEach(() => {
  state.value = { phase: 'reading', presentation: 'global' };
});

describe('AiProcessingOverlay', () => {
  it('while reading blind: every tile ticks, none is lit, the spinner shows', () => {
    const w = mountOverlay();
    expect(tiles(w).map((li) => li.classes().includes('magic-tick'))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(lit(w)).toEqual([]);
    expect(w.find('[data-test="spinner"]').exists()).toBe(true);
  });

  it('while reading a PICKED kind: that tile is lit from the start, nothing ticks, still waiting', () => {
    state.value = { phase: 'reading', presentation: 'global', hint: 'travel' };
    const w = mountOverlay();
    expect(lit(w)).toEqual([expect.stringContaining('ai.capture.dest.travel')]);
    expect(tiles(w).map((li) => li.classes().includes('magic-tick'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // The wait is still a wait: the spinner keys on the RESOLVED kind, not the lit one.
    expect(w.find('[data-test="spinner"]').exists()).toBe(true);
    // And the others are not yet faded out — that is the resolve, which has not happened.
    expect(tiles(w).filter((li) => li.find('div').classes().includes('opacity-30'))).toHaveLength(
      0
    );
  });

  it('on resolve: the answer is lit, the spinner goes, the others fade', () => {
    state.value = { phase: 'resolved', presentation: 'global', kind: 'recipe' };
    const w = mountOverlay();
    expect(lit(w)).toEqual([expect.stringContaining('ai.capture.dest.recipe')]);
    expect(w.find('[data-test="spinner"]').exists()).toBe(false);
    expect(tiles(w).filter((li) => li.find('div').classes().includes('opacity-30'))).toHaveLength(
      3
    );
  });
});
