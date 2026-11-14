/**
 * The tick a celebration starts from must still be ON SCREEN when the burst plays (#146). The
 * store holds the block (`holdChoreBlock`) before the write's marks refresh, so the section keeps
 * the very same rows through the tick: the anchor's tick element is the one the bean tapped,
 * still connected, when `celebrateChore` begins; and the banner mounts once, at the phase flip.
 * Real `useCelebration` here (the section's other tests mock it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useSounds', () => ({
  playChime: vi.fn(),
  playFanfare: vi.fn(),
  playChoreCelebrationSound: vi.fn(() => Promise.resolve('played')),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));

import ChoreBlockSection from '../ChoreBlockSection.vue';
import { chore, resetKit } from './choreTestKit';
import {
  celebrateChore,
  holdChoreBlock,
  resetChoreCelebrationForTest,
  useCelebration,
} from '@/composables/useCelebration';
import { DEFAULT_CHORE_BLOCK_STARTS, type ChoreDayBlock } from '@/utils/chores';
import type { ChoreCelebrationAnchor } from '@/utils/choreCelebration';

function block(done: [boolean, boolean]): ChoreDayBlock {
  const chores = [
    { chore: chore('c1'), done: done[0] },
    { chore: chore('c2'), done: done[1] },
  ];
  const n = done.filter(Boolean).length;
  return {
    block: 'morning',
    chores,
    done: n,
    total: 2,
    allDone: n === 2,
    celebrated: false,
    isNow: true,
    ended: false,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  resetKit();
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

describe('the tick a celebration starts from', () => {
  it('is the same element, still connected, when the burst begins; the banner mounts once', async () => {
    const w = mount(ChoreBlockSection, {
      attachTo: document.body,
      props: {
        block: block([true, false]),
        memberId: 'kid',
        beanName: 'Pip',
        starts: DEFAULT_CHORE_BLOCK_STARTS,
        celebrate: true,
      },
      global: { stubs: { CardArt: true } },
    });
    const tapped = w.get('[data-chore-id="c2"] [data-testid="chore-tick"]').element;
    await w.get('[data-chore-id="c2"] [data-testid="chore-tick"]').trigger('click');
    const anchor = w.emitted('toggle')![0]![1] as ChoreCelebrationAnchor;
    expect(anchor.tickEl).toBe(tapped);

    // The store's order: hold, THEN the refreshed marks make the block done, THEN celebrate.
    holdChoreBlock('kid', 'morning');
    await w.setProps({ block: block([true, true]) });
    await nextTick();
    expect(w.find('[data-testid="chore-done-banner"]').exists()).toBe(false);
    celebrateChore({ memberId: 'kid', block: 'morning', beanName: 'Pip', count: 2, anchor });
    await nextTick();
    expect(useCelebration().activeChore.value?.anchor?.tickEl).toBe(tapped);
    expect(tapped.isConnected).toBe(true);
    expect(w.get('[data-chore-id="c2"] [data-testid="chore-tick"]').element).toBe(tapped);

    // The banner arrives at the phase flip, in its celebrating form, once.
    vi.advanceTimersByTime(560);
    await nextTick();
    const banner = w.get('[data-testid="chore-done-banner"]');
    expect(banner.classes()).toContain('is-celebrating');
    w.unmount();
  });
});
