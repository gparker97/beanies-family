/**
 * The chore celebration's live region (#146): each praise line is ADDED once, as its own node,
 * so a screen reader says every celebration exactly once and never re-reads an earlier one when
 * a second bean finishes or the first one ends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

vi.mock('@/composables/useSounds', () => ({
  playFanfare: vi.fn(),
  playChime: vi.fn(),
  playChoreCelebrationSound: vi.fn(() => Promise.resolve('played')),
  cancelChoreCelebrationSound: vi.fn(),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The drawn celebration is not under test here (it is aria-hidden decoration).
vi.mock('@/components/ui/choreCelebrationLoader', () => ({
  loadChoreCelebration: () => Promise.resolve({ render: () => null }),
}));

import CelebrationOverlay from '../CelebrationOverlay.vue';
import { celebrateChore, resetChoreCelebrationForTest } from '@/composables/useCelebration';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  resetChoreCelebrationForTest();
});
afterEach(() => {
  resetChoreCelebrationForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the chore celebration live region', () => {
  it('adds each praise line once and keeps earlier nodes untouched', async () => {
    const w = mount(CelebrationOverlay, { global: { stubs: { CelebrationShower: true } } });
    const said = () => w.find('[data-testid="chore-celebration-said"]');
    expect(said().attributes()).toMatchObject({
      'aria-live': 'polite',
      'aria-relevant': 'additions',
    });
    expect(said().findAll('p')).toHaveLength(0);

    celebrateChore({ memberId: 'kid', block: 'morning', beanName: 'Kid', count: 2 });
    await nextTick();
    const first = said().findAll('p');
    expect(first).toHaveLength(1);
    const firstNode = first[0]!.element;
    const firstText = firstNode.textContent;
    expect(firstText).toBeTruthy();

    vi.advanceTimersByTime(1500);
    celebrateChore({ memberId: 'sib', block: 'morning', beanName: 'Sib', count: 1 });
    await nextTick();
    const both = said().findAll('p');
    expect(both).toHaveLength(2);
    // The first line is the SAME node with the same text: it is not announced a second time.
    expect(both[0]!.element).toBe(firstNode);
    expect(both[0]!.text()).toBe(firstText);

    // The first one ends: only its node goes; the second is neither re-added nor re-read.
    vi.advanceTimersByTime(2000);
    await nextTick();
    const left = said().findAll('p');
    expect(left).toHaveLength(1);
    expect(left[0]!.element).toBe(both[1]!.element);
    w.unmount();
  });
});
