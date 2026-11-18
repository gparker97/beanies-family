/**
 * The weekly reward's achieved banner (#148, #154): `celebrateReward` does ALL its waiting before
 * the claim (behind that child's block celebrations and until their ticks go quiet, one bound),
 * asks `stillClaimable()` and drops the banner if the child unticked below the bar, THEN claims
 * the week (`claim()`, the store's mark) and shows only when the claim says yes, and only if a
 * banner host is still mounted (`hasHost`); the banner ends on its own timer. A block
 * celebration cutting the banner resumes it once. Each showing is reported through `onShow`
 * (the star store logs it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const playSound = vi.hoisted(() => vi.fn(async (_id: string, _standIn: string) => 'played'));
vi.mock('@/composables/useSounds', () => ({
  playFanfare: vi.fn(),
  playChime: vi.fn(),
  playChoreCelebrationSound: playSound,
  cancelChoreCelebrationSound: vi.fn(),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));

import {
  CHORE_HOLD_SAFETY_MS,
  REWARD_BANNER_MS,
  REWARD_BANNER_WAIT_MAX_MS,
  REWARD_TICK_QUIET_MS,
  celebrateChore,
  celebrateReward,
  dismissChoreCelebration,
  dismissRewardBanner,
  endChoreCelebrationExpected,
  expectChoreCelebration,
  noteChoreTick,
  resetCelebrationMode,
  resetChoreCelebrationForTest,
  rewardBannerFor,
  setCelebrationMode,
  type RewardCelebrationRequest,
} from '@/composables/useCelebration';
import { CHORE_CELEBRATION_BEATS } from '@/utils/choreCelebration';

const req = (over: Partial<RewardCelebrationRequest> = {}): RewardCelebrationRequest => ({
  memberId: 'max',
  beanName: 'Max',
  title: 'Ice cream',
  emoji: '🍦',
  stillClaimable: () => true,
  claim: async () => true,
  ...over,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  resetChoreCelebrationForTest();
  resetCelebrationMode();
  logEvent.mockClear();
  playSound.mockClear();
});

afterEach(() => {
  resetChoreCelebrationForTest();
  resetCelebrationMode();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('celebrateReward', () => {
  it('shows at once with no block celebration, and ends on its own timer', async () => {
    expect(await celebrateReward(req())).toBe('shown');
    expect(rewardBannerFor('max')).toMatchObject({
      memberId: 'max',
      beanName: 'Max',
      title: 'Ice cream',
      emoji: '🍦',
    });
    expect(rewardBannerFor('juno')).toBeNull();
    vi.advanceTimersByTime(REWARD_BANNER_MS);
    expect(rewardBannerFor('max')).toBeNull();
    expect(logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'reward' }));
  });

  it('waits behind that child’s block celebration, then shows', async () => {
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 3 });
    const played = celebrateReward(req());
    await Promise.resolve();
    expect(rewardBannerFor('max')).toBeNull();
    dismissChoreCelebration('max:morning');
    expect(await played).toBe('shown-after-wait');
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('another child’s block celebration does not hold it', async () => {
    celebrateChore({ memberId: 'juno', block: 'morning', beanName: 'Juno', count: 3 });
    expect(await celebrateReward(req())).toBe('shown');
  });

  it('drops the banner when the child unticked below the bar during the wait', async () => {
    let still = true;
    celebrateChore({ memberId: 'max', block: 'evening', beanName: 'Max', count: 3 });
    const played = celebrateReward(req({ stillClaimable: () => still }));
    still = false;
    dismissChoreCelebration('max:evening');
    expect(await played).toBe('dropped');
    expect(rewardBannerFor('max')).toBeNull();
  });

  it('claims only after the wait and the re-check; an untick during the wait claims nothing', async () => {
    let still = true;
    const claim = vi.fn(async () => true);
    celebrateChore({ memberId: 'max', block: 'evening', beanName: 'Max', count: 3 });
    const played = celebrateReward(req({ stillClaimable: () => still, claim }));
    await Promise.resolve();
    expect(claim).not.toHaveBeenCalled();
    still = false;
    dismissChoreCelebration('max:evening');
    expect(await played).toBe('dropped');
    expect(claim).not.toHaveBeenCalled();
  });

  it('a claim that says no (another device celebrated first) shows nothing', async () => {
    expect(await celebrateReward(req({ claim: async () => false }))).toBe('claimed-elsewhere');
    expect(rewardBannerFor('max')).toBeNull();
  });

  it('with no wait it still asks stillClaimable before claiming', async () => {
    const claim = vi.fn(async () => true);
    expect(await celebrateReward(req({ stillClaimable: () => false, claim }))).toBe('dropped');
    expect(claim).not.toHaveBeenCalled();
  });

  it('an EXPECTED block celebration (requested, not started yet) holds it: waits, then plays after it ends (#154)', async () => {
    const claim = vi.fn(async () => true);
    expectChoreCelebration('max', 'afternoon');
    const played = celebrateReward(req({ claim }));
    await Promise.resolve();
    expect(claim).not.toHaveBeenCalled();
    // The store's handover: the celebration starts, then the expectation ends. Still waiting.
    celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 });
    endChoreCelebrationExpected('max', 'afternoon');
    await Promise.resolve();
    expect(claim).not.toHaveBeenCalled();
    expect(rewardBannerFor('max')).toBeNull();
    dismissChoreCelebration('max:afternoon');
    expect(await played).toBe('shown-after-wait');
    expect(claim).toHaveBeenCalledTimes(1);
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('an expected celebration that never starts or ends cannot hold it for ever', async () => {
    expectChoreCelebration('max', 'afternoon');
    const played = celebrateReward(req());
    await vi.advanceTimersByTimeAsync(CHORE_HOLD_SAFETY_MS);
    expect(await played).toBe('shown-after-wait');
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('an expected celebration that will not play (its mark was another device’s) lets it go at once', async () => {
    expectChoreCelebration('max', 'afternoon');
    const played = celebrateReward(req());
    endChoreCelebrationExpected('max', 'afternoon');
    expect(await played).toBe('shown-after-wait');
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('a finishing tick tapped while the mark is written: the banner (never the claim) waits behind its celebration', async () => {
    let finishMark!: (yes: boolean) => void;
    const claim = vi.fn(() => new Promise<boolean>((resolve) => (finishMark = resolve)));
    const played = celebrateReward(req({ claim }));
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledTimes(1);
    // The last tick of the block, tapped during the mark write (the wall walk's overlap).
    expectChoreCelebration('max', 'afternoon');
    finishMark(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(rewardBannerFor('max')).toBeNull();
    celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 });
    endChoreCelebrationExpected('max', 'afternoon');
    await vi.advanceTimersByTimeAsync(0);
    expect(rewardBannerFor('max')).toBeNull();
    playSound.mockClear();
    // The block celebration ends on its own timer; only then the banner and its own sound.
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done - 1);
    expect(rewardBannerFor('max')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await played).toBe('shown-after-wait');
    expect(rewardBannerFor('max')).not.toBeNull();
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('bar crossed on one tick, the block finished 0.9 s later: the block celebration first, the reward after it (#154)', async () => {
    const shown: string[] = [];
    const claim = vi.fn(async () => {
      shown.push('claim');
      return true;
    });
    noteChoreTick('max'); // tick 2: crosses the weekly bar
    const played = celebrateReward(req({ claim })).then((r) => {
      shown.push('reward');
      return r;
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(rewardBannerFor('max')).toBeNull(); // the quiet period holds it
    // Tick 3, 0.9 s later, finishes the afternoon: its celebration plays at once.
    noteChoreTick('max');
    expectChoreCelebration('max', 'afternoon');
    expect(celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 })).toBe(
      'max:afternoon'
    );
    shown.push('block');
    endChoreCelebrationExpected('max', 'afternoon');
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done - 1);
    expect(rewardBannerFor('max')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await played).toBe('shown-after-wait');
    expect(rewardBannerFor('max')).not.toBeNull();
    // The claim waited too: nothing is spent while the block celebration plays.
    expect(shown).toEqual(['block', 'claim', 'reward']);
  });

  it('claims (and shows) only once the child has not ticked for the quiet period', async () => {
    const claim = vi.fn(async () => true);
    noteChoreTick('max');
    const played = celebrateReward(req({ claim }));
    await vi.advanceTimersByTimeAsync(REWARD_TICK_QUIET_MS - 1);
    expect(claim).not.toHaveBeenCalled(); // the quiet period is waited BEFORE the claim
    expect(rewardBannerFor('max')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await played).toBe('shown');
    expect(claim).toHaveBeenCalledTimes(1);
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('a child who never stops ticking: the one deadline ends the wait, then it claims and shows', async () => {
    const claim = vi.fn(async () => true);
    const played = celebrateReward(req({ claim }));
    let done = false;
    void played.then(() => (done = true));
    let t = 0;
    for (; t < REWARD_BANNER_WAIT_MAX_MS + 1000 && !done; t += 500) {
      noteChoreTick('max');
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(done).toBe(true);
    expect(t).toBeGreaterThanOrEqual(REWARD_BANNER_WAIT_MAX_MS);
    expect(t).toBeLessThanOrEqual(REWARD_BANNER_WAIT_MAX_MS + 500);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('another child’s ticks do not hold it', async () => {
    noteChoreTick('juno');
    expect(await celebrateReward(req())).toBe('shown');
  });

  it('a block celebration starting while the banner is up cuts it, then the banner resumes in full once it ends (#154)', async () => {
    const claim = vi.fn(async () => true);
    const onShow = vi.fn();
    await celebrateReward(req({ claim, onShow }));
    const first = rewardBannerFor('max')!;
    expect(first).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    logEvent.mockClear();
    playSound.mockClear();
    // Another child's celebration leaves it alone.
    celebrateChore({ memberId: 'juno', block: 'afternoon', beanName: 'Juno', count: 2 });
    expect(rewardBannerFor('max')).not.toBeNull();
    // A finishing tick 3 s in: the block celebration starts at once and the banner goes.
    expect(celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 })).toBe(
      'max:afternoon'
    );
    expect(rewardBannerFor('max')).toBeNull();
    const cuts = logEvent.mock.calls.filter(
      ([e]) => (e as { context?: { action?: string } }).context?.action === 'reward-banner-cut'
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]![0]).toMatchObject({
      surface: 'chore-celebration',
      context: { action: 'reward-banner-cut', slot: 'afternoon', stage: 'resume' },
    });
    // Nothing comes back under the block celebration.
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done - 1);
    expect(rewardBannerFor('max')).toBeNull();
    playSound.mockClear();
    // It ends: the reward plays again IN FULL (a new banner, a fresh burst clock, its sound).
    await vi.advanceTimersByTimeAsync(1);
    const again = rewardBannerFor('max')!;
    expect(again).not.toBeNull();
    expect(again.id).not.toBe(first.id);
    expect(again.startedAt).toBeGreaterThan(first.startedAt);
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(onShow.mock.calls.map(([a]) => a)).toEqual(['shown', 'resumed-after-cut']);
    await vi.advanceTimersByTimeAsync(REWARD_BANNER_MS - 1);
    expect(rewardBannerFor('max')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(rewardBannerFor('max')).toBeNull();
    // Exactly once: nothing further replays, and the claim was made once.
    await vi.advanceTimersByTimeAsync(REWARD_BANNER_MS * 2);
    expect(rewardBannerFor('max')).toBeNull();
    expect(onShow).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('a second cut (after the resume) ends it: no further resume, reported as cut', async () => {
    const onShow = vi.fn();
    await celebrateReward(req({ onShow }));
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 2 });
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done);
    expect(rewardBannerFor('max')).not.toBeNull(); // resumed
    logEvent.mockClear();
    celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 3 });
    expect(rewardBannerFor('max')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'reward-banner-cut', slot: 'afternoon', stage: 'final' },
      })
    );
    await vi.advanceTimersByTimeAsync(REWARD_BANNER_MS * 3);
    expect(rewardBannerFor('max')).toBeNull();
    expect(onShow.mock.calls.map(([a]) => a)).toEqual(['shown', 'resumed-after-cut', 'cut']);
  });

  it('a resume with no host left by then shows nothing (skipped-no-host)', async () => {
    let hosted = true;
    const onShow = vi.fn();
    await celebrateReward(req({ hasHost: () => hosted, onShow }));
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 2 });
    hosted = false; // the grown-up leaves the child's day under the block celebration
    playSound.mockClear();
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done + REWARD_BANNER_MS);
    expect(rewardBannerFor('max')).toBeNull();
    expect(playSound).not.toHaveBeenCalled();
    expect(onShow.mock.calls.map(([a]) => a)).toEqual(['shown', 'skipped-no-host']);
  });

  it('clearing the child’s banner state (a reset) ends a pending resume: nothing stale shows later', async () => {
    const onShow = vi.fn();
    await celebrateReward(req({ onShow }));
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 2 });
    dismissRewardBanner('max');
    await vi.advanceTimersByTimeAsync(0);
    expect(onShow.mock.calls.map(([a]) => a)).toEqual(['shown', 'cut']);
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done + REWARD_BANNER_MS);
    expect(rewardBannerFor('max')).toBeNull();
    expect(onShow).toHaveBeenCalledTimes(2);
  });

  it('a host unmounted before the showing: nothing shown or heard, skipped-no-host, and the mark IS written', async () => {
    let hosted = true;
    let finishMark!: (yes: boolean) => void;
    const claim = vi.fn(() => new Promise<boolean>((resolve) => (finishMark = resolve)));
    const onShow = vi.fn();
    const played = celebrateReward(req({ claim, hasHost: () => hosted, onShow }));
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledTimes(1); // the mark is being written
    hosted = false; // the grown-up navigates away from the child's day meanwhile
    finishMark(true);
    expect(await played).toBe('skipped-no-host');
    expect(rewardBannerFor('max')).toBeNull();
    expect(playSound).not.toHaveBeenCalled();
    expect(onShow.mock.calls.map(([a]) => a)).toEqual(['skipped-no-host']);
    // Nothing pending: a later block celebration of that child resumes nothing.
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 2 });
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done + REWARD_BANNER_MS);
    expect(rewardBannerFor('max')).toBeNull();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('the host is asked AFTER the wait behind a block celebration a tick started during the mark write', async () => {
    let hosted = true;
    let finishMark!: (yes: boolean) => void;
    const claim = vi.fn(() => new Promise<boolean>((resolve) => (finishMark = resolve)));
    const played = celebrateReward(req({ claim, hasHost: () => hosted }));
    await vi.advanceTimersByTimeAsync(0);
    celebrateChore({ memberId: 'max', block: 'evening', beanName: 'Max', count: 2 });
    finishMark(true);
    await vi.advanceTimersByTimeAsync(0);
    hosted = false; // left under the block celebration
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done);
    expect(await played).toBe('skipped-no-host');
    expect(rewardBannerFor('max')).toBeNull();
  });

  it('another child’s expected celebration does not hold it', async () => {
    expectChoreCelebration('juno', 'afternoon');
    expect(await celebrateReward(req())).toBe('shown');
  });

  it('the wait is bounded even if a block celebration never ended', async () => {
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 3 });
    const played = celebrateReward(req());
    vi.advanceTimersByTime(REWARD_BANNER_WAIT_MAX_MS);
    expect(await played).toBe('shown-after-wait');
  });
});

/**
 * The one-time celebration (#154): the same claim, enriched. After the claim the banner carries
 * `calm` and `startedAt` (the burst's clock), lasts 6 s or the surface's shorter cap, and a
 * celebration sound plays through the existing picker (its overlap rule included).
 */
describe('celebrateReward: the celebration', () => {
  it('plays a celebration sound once the claim says yes, and none when it says no', async () => {
    await celebrateReward(req({ claim: async () => false }));
    expect(playSound).not.toHaveBeenCalled();
    await celebrateReward(req());
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it('the claim still comes first: the sound and the banner only after it answers', async () => {
    const order: string[] = [];
    playSound.mockImplementationOnce(async () => {
      order.push('sound');
      return 'played';
    });
    await celebrateReward(
      req({
        claim: async () => {
          order.push('claim');
          return true;
        },
      })
    );
    expect(order).toEqual(['claim', 'sound']);
  });

  it('another celebration’s sound inside the gap: the banner shows, the sound is skipped as reward', async () => {
    celebrateChore({ memberId: 'juno', block: 'morning', beanName: 'Juno', count: 3 });
    await Promise.resolve();
    playSound.mockClear();
    logEvent.mockClear();
    expect(await celebrateReward(req())).toBe('shown');
    expect(rewardBannerFor('max')).not.toBeNull();
    expect(playSound).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'sound-skipped', kind: 'reward' }),
      })
    );
  });

  it('the banner carries calm and its start, for the burst', async () => {
    await celebrateReward(req());
    const banner = rewardBannerFor('max')!;
    expect(banner.calm).toBe(false);
    expect(typeof banner.startedAt).toBe('number');
    dismissChoreCelebration();
    resetChoreCelebrationForTest();
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await celebrateReward(req());
    expect(rewardBannerFor('max')!.calm).toBe(true);
  });

  it('stays up 6 s, or a surface’s shorter cap', async () => {
    expect(REWARD_BANNER_MS).toBe(6000);
    await celebrateReward(req());
    vi.advanceTimersByTime(REWARD_BANNER_MS - 1);
    expect(rewardBannerFor('max')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(rewardBannerFor('max')).toBeNull();

    setCelebrationMode({ autoDismissMs: 3000 });
    await celebrateReward(req());
    vi.advanceTimersByTime(3000);
    expect(rewardBannerFor('max')).toBeNull();
  });
});
