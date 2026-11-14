/**
 * The tick a celebration starts from must still be ON SCREEN when the burst plays (#146). The
 * store HOLDS the block at the tap (invisibly), before the write's marks refresh, and starts the
 * celebration only once the block is really done and its mark written, so the section keeps
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
  cancelChoreCelebrationSound: vi.fn(),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));

import ChoreBlockSection from '../ChoreBlockSection.vue';
import { chore, resetKit } from './choreTestKit';
import {
  celebrateChore,
  holdChoreBlock,
  releaseChoreBlock,
  resetChoreCelebrationForTest,
  useCelebration,
} from '@/composables/useCelebration';
import { DEFAULT_CHORE_BLOCK_STARTS, type ChoreDayBlock } from '@/utils/chores';
import type { ChoreCelebrationAnchor } from '@/utils/choreCelebration';

function block(done: boolean[]): ChoreDayBlock {
  const chores = done.map((d, i) => ({ chore: chore(`c${i + 1}`), done: d }));
  const n = done.filter(Boolean).length;
  return {
    block: 'morning',
    chores,
    done: n,
    total: done.length,
    allDone: n === done.length,
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

    // The store's order: the hold at the tap, THEN the refreshed marks make the block done,
    // THEN (its mark written) the celebration starts and the hold goes.
    holdChoreBlock('kid', 'morning');
    await w.setProps({ block: block([true, true]) });
    await nextTick();
    expect(w.find('[data-testid="chore-done-banner"]').exists()).toBe(false);
    const key = celebrateChore({
      memberId: 'kid',
      block: 'morning',
      beanName: 'Pip',
      count: 2,
      anchor,
    })!;
    releaseChoreBlock('kid', 'morning');
    await nextTick();
    expect(useCelebration().activeChores.value.get(key)?.anchor?.tickEl).toBe(tapped);
    expect(tapped.isConnected).toBe(true);
    expect(w.get('[data-chore-id="c2"] [data-testid="chore-tick"]').element).toBe(tapped);

    // The banner arrives at the phase flip, in its celebrating form, once.
    vi.advanceTimersByTime(560);
    await nextTick();
    const banner = w.get('[data-testid="chore-done-banner"]');
    expect(banner.classes()).toContain('is-celebrating');
    w.unmount();
  });

  it('two quick ticks: the second is held before either lands; its tick is the one at burst', async () => {
    const w = mount(ChoreBlockSection, {
      attachTo: document.body,
      props: {
        block: block([true, false, false]),
        memberId: 'kid',
        beanName: 'Pip',
        starts: DEFAULT_CHORE_BLOCK_STARTS,
        celebrate: true,
      },
      global: { stubs: { CardArt: true } },
    });
    await w.get('[data-chore-id="c2"] [data-testid="chore-tick"]').trigger('click');
    const last = w.get('[data-chore-id="c3"] [data-testid="chore-tick"]').element;
    await w.get('[data-chore-id="c3"] [data-testid="chore-tick"]').trigger('click');
    const anchor = w.emitted('toggle')![1]![1] as ChoreCelebrationAnchor;
    // The store holds on the SECOND tap (the first counts as done while in flight).
    holdChoreBlock('kid', 'morning');
    await w.setProps({ block: block([true, true, false]) }); // the first write lands
    await w.setProps({ block: block([true, true, true]) }); // then the second
    await nextTick();
    expect(w.find('[data-testid="chore-done-banner"]').exists()).toBe(false);
    celebrateChore({
      memberId: 'kid',
      block: 'morning',
      beanName: 'Pip',
      count: 3,
      anchor,
    });
    releaseChoreBlock('kid', 'morning');
    await nextTick();
    expect(anchor.tickEl).toBe(last);
    expect(last.isConnected).toBe(true);
    vi.advanceTimersByTime(560);
    await nextTick();
    expect(w.findAll('[data-testid="chore-done-banner"]')).toHaveLength(1);
    w.unmount();
  });
});
