/**
 * The chore celebration's overlay (#146): it draws an anchored celebration on the board (the
 * stars burst from the tick, the move plays on the surface's own banner), falls back to its own
 * centered banner when there is no anchor or the anchor is gone, follows the phases
 * `useCelebration` runs, and cancels everything when a new one starts or it unmounts. The
 * choreography itself is the player's (mocked here; its own cleanup is tested below).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { routeLocationKey } from 'vue-router';

vi.mock('@/composables/useSounds', () => ({
  playFanfare: vi.fn(),
  playChime: vi.fn(),
  playChoreCelebrationSound: vi.fn(() => Promise.resolve('played')),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const players = vi.hoisted(() => [] as Array<Record<string, ReturnType<typeof vi.fn>>>);
const createPlayer = vi.hoisted(() =>
  vi.fn((_opts: Record<string, unknown>) => {
    const p = {
      burst: vi.fn(),
      arrive: vi.fn(),
      calm: vi.fn(),
      fadeOutBy: vi.fn(),
      follow: vi.fn(),
      cancel: vi.fn(),
    };
    players.push(p);
    return p;
  })
);
vi.mock('@/components/ui/choreCelebrationPlayer', () => ({
  createChoreCelebrationPlayer: createPlayer,
}));

import ChoreCelebration from '../ChoreCelebration.vue';
import {
  celebrateChore,
  resetCelebrationMode,
  resetChoreCelebrationForTest,
  useCelebration,
} from '@/composables/useCelebration';
import { choreCelebrationAnchor } from '@/utils/choreCelebration';

function rect(el: HTMLElement, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
}

/** A block on the board with a tick, inside a clip, with (optionally) its banner. */
function board(withBanner: boolean) {
  const clip = document.createElement('div');
  clip.setAttribute('data-celebration-clip', '');
  const block = document.createElement('section');
  const tick = document.createElement('button');
  block.append(tick);
  if (withBanner) {
    const banner = document.createElement('div');
    banner.setAttribute('data-celebration-banner', '');
    block.append(banner);
  }
  clip.append(block);
  document.body.append(clip);
  rect(clip, 0, 0, 400, 800);
  rect(block, 16, 200, 368, 300);
  rect(tick, 320, 420, 52, 52);
  return { clip, block, tick };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 16, 7, 42)); // a Monday: Bounce party
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  players.length = 0;
  createPlayer.mockClear();
  logEvent.mockClear();
  resetCelebrationMode();
  resetChoreCelebrationForTest();
  document.body.innerHTML = '';
});

afterEach(() => {
  resetChoreCelebrationForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

const request = (
  anchor: ReturnType<typeof choreCelebrationAnchor> | null,
  stillDone: () => boolean = () => true
) => ({ memberId: 'pip', block: 'morning' as const, beanName: 'Pip', count: 4, anchor, stillDone });

describe('ChoreCelebration', () => {
  it('anchored: stars burst from the tick, then the move plays on the surface’s banner', async () => {
    const { block, tick } = board(true);
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(createPlayer.mock.calls[0]![0]).toMatchObject({ move: 'bounce-party', count: 4 });
    const p = players[0]!;
    expect(p.burst).toHaveBeenCalledWith(
      expect.objectContaining({
        tick: { x: 320, y: 420, w: 52, h: 52 },
        tickEl: tick,
        blockEl: block,
        late: false,
      })
    );
    expect(p.arrive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(560);
    await settle();
    expect(p.arrive).toHaveBeenCalledWith(block.querySelector('[data-celebration-banner]'));
    expect(w.find('[data-testid="chore-celebration-ghost"]').exists()).toBe(false);
    w.unmount();
  });

  it('no anchor: a centered version of the same move on its own banner, fading at the end', async () => {
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(null));
    await settle();
    const p = players[0]!;
    expect(p.burst).toHaveBeenCalledWith(expect.objectContaining({ tickEl: null, blockEl: null }));
    vi.advanceTimersByTime(560);
    await settle();
    const ghost = document.querySelector<HTMLElement>('[data-testid="chore-celebration-ghost"]');
    expect(ghost).not.toBeNull();
    expect(ghost!.querySelector('[data-celebration-banner]')).not.toBeNull();
    expect(p.arrive).toHaveBeenCalledWith(ghost);
    expect(p.fadeOutBy).toHaveBeenCalledWith(ghost, 3060);
    w.unmount();
  });

  it('an anchor no longer on screen: ends at once, never laid out against a zero rect', async () => {
    const { block, tick, clip } = board(true);
    const anchor = choreCelebrationAnchor(block, tick);
    clip.remove();
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(anchor));
    await settle();
    expect(createPlayer).not.toHaveBeenCalled();
    expect(useCelebration().activeChore.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'ended-gone', detail: 'anchor-gone' }),
      })
    );
    w.unmount();
  });

  it('the anchoring surface unmounts mid-celebration: everything stops at once', async () => {
    const { block, tick, clip } = board(true);
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    clip.remove();
    vi.advanceTimersByTime(32);
    await settle();
    expect(useCelebration().activeChore.value).toBeNull();
    expect(players[0]!.cancel).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="chore-celebration"]')).toBeNull();
    w.unmount();
  });

  it('a route change ends it at once', async () => {
    const route = reactive({ fullPath: '/choreboard?bean=pip' });
    const { block, tick } = board(true);
    const w = mount(ChoreCelebration, {
      attachTo: document.body,
      global: { provide: { [routeLocationKey as symbol]: route } },
    });
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    route.fullPath = '/nook';
    await settle();
    expect(useCelebration().activeChore.value).toBeNull();
    expect(players[0]!.cancel).toHaveBeenCalled();
    w.unmount();
  });

  it('a block unticked during the burst: no banner and no ghost, it just ends', async () => {
    const { block, tick } = board(false);
    let done = true;
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(choreCelebrationAnchor(block, tick), () => done));
    await settle();
    done = false;
    vi.advanceTimersByTime(560);
    await settle();
    expect(players[0]!.arrive).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="chore-celebration-ghost"]')).toBeNull();
    expect(players[0]!.cancel).toHaveBeenCalled();
    w.unmount();
  });

  it('drawing starts late (the banner already arrived): the burst skips its step-aside', async () => {
    const { block, tick } = board(true);
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    vi.advanceTimersByTime(700); // a slow first load: the phase flipped before we mounted
    const w = mount(ChoreCelebration, { attachTo: document.body });
    await settle();
    const p = players[0]!;
    expect(p.burst).toHaveBeenCalledWith(expect.objectContaining({ late: true }));
    expect(p.arrive).toHaveBeenCalledWith(block.querySelector('[data-celebration-banner]'));
    w.unmount();
  });

  it('reduced motion: no burst, the calm settle on the banner', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { block, tick } = board(true);
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    const p = players[0]!;
    expect(p.burst).not.toHaveBeenCalled();
    expect(p.arrive).not.toHaveBeenCalled();
    expect(p.calm).toHaveBeenCalledWith(block.querySelector('[data-celebration-banner]'));
    w.unmount();
  });

  it('a new celebration cancels the last one’s player; unmounting cancels the current one', async () => {
    const { block, tick } = board(true);
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    expect(players).toHaveLength(2);
    expect(players[0]!.cancel).toHaveBeenCalled();
    expect(players[1]!.cancel).not.toHaveBeenCalled();
    w.unmount();
    expect(players[1]!.cancel).toHaveBeenCalled();
  });

  it('the end of the celebration cancels the player and removes the stage', async () => {
    const { block, tick } = board(true);
    const w = mount(ChoreCelebration, { attachTo: document.body });
    celebrateChore(request(choreCelebrationAnchor(block, tick)));
    await settle();
    expect(document.querySelector('[data-testid="chore-celebration"]')).not.toBeNull();
    vi.advanceTimersByTime(3060);
    await settle();
    expect(players[0]!.cancel).toHaveBeenCalled();
    w.unmount();
  });
});
