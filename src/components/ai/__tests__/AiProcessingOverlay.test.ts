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
  | {
      phase: 'resolved';
      presentation: 'global' | 'local';
      kind: string;
      companions: { kind: string; count: number }[];
    };

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
      true,
    ]);
    // The stagger is indexed per tile, not by `:nth-child` rules in the stylesheet.
    expect(tiles(w).map((li) => li.attributes('style'))).toEqual(
      [0, 1, 2, 3, 4].map((i) => `--tick-i: ${i};`)
    );
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
    state.value = { phase: 'resolved', presentation: 'global', kind: 'recipe', companions: [] };
    const w = mountOverlay();
    expect(lit(w)).toEqual([expect.stringContaining('ai.capture.dest.recipe')]);
    expect(w.find('[data-test="spinner"]').exists()).toBe(false);
    expect(tiles(w).filter((li) => li.find('div').classes().includes('opacity-30'))).toHaveLength(
      4
    );
    expect(w.text()).toContain('ai.processing');
  });

  it('on a SHARED resolve (#113): the activity and the to-do both lift, and the line says so', () => {
    state.value = {
      phase: 'resolved',
      presentation: 'global',
      kind: 'event',
      companions: [{ kind: 'todo', count: 3 }],
    };
    const w = mountOverlay();
    expect(lit(w)).toEqual([
      expect.stringContaining('ai.capture.dest.event'),
      expect.stringContaining('ai.capture.dest.todo'),
    ]);
    expect(tiles(w).filter((li) => li.find('div').classes().includes('opacity-30'))).toHaveLength(
      3
    );
    // The mocked `t` echoes the key, so the plural choice is what is asserted.
    expect(w.text()).toContain('ai.found.eventWithTodos.other');
    expect(w.text()).not.toContain('ai.processing');
  });

  it('uses the singular found-line for one to-do', () => {
    state.value = {
      phase: 'resolved',
      presentation: 'global',
      kind: 'event',
      companions: [{ kind: 'todo', count: 1 }],
    };
    expect(mountOverlay().text()).toContain('ai.found.eventWithTodos.one');
  });

  it('lays five tiles out as three and two on a phone, one row from sm', () => {
    const grid = mountOverlay().find('ul');
    expect(grid.attributes('style')).toContain('--cols: 3');
    expect(grid.attributes('style')).toContain('--cols-sm: 5');
  });
});
