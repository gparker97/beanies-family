/**
 * The weekly reward's achieved banner (#148, #154): `celebrateReward` does ALL its waiting before
 * the claim (this device's ticks settled, then behind that child's block celebrations and until
 * their ticks go quiet, one bound, then the ticks settled again), asks `stillClaimable()` and
 * drops the banner if the child unticked below the bar, THEN claims the week (`claim()`, the
 * store's mark) and shows at once when the claim says yes; the banner ends on its own timer. A
 * block celebration starting while the banner is up changes nothing about it (the accepted
 * overlap). A tick write still pending at the one deadline ends it with nothing asked.
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
  ticksSettled: async () => {},
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
    await vi.advanceTimersByTimeAsync(0);
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
    await vi.advanceTimersByTimeAsync(0);
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
    await vi.advanceTimersByTimeAsync(0);
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
    await vi.advanceTimersByTimeAsync(0); // the ticks settled: the wait has begun
    endChoreCelebrationExpected('max', 'afternoon');
    expect(await played).toBe('shown-after-wait');
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('a finishing tick tapped while the mark is written: the banner still shows at once after the claim', async () => {
    let finishMark!: (yes: boolean) => void;
    const claim = vi.fn(() => new Promise<boolean>((resolve) => (finishMark = resolve)));
    const played = celebrateReward(req({ claim }));
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledTimes(1);
    // The last tick of the block, tapped during the mark write: nothing waits after the claim.
    expectChoreCelebration('max', 'afternoon');
    celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 });
    endChoreCelebrationExpected('max', 'afternoon');
    finishMark(true);
    expect(await played).toBe('shown');
    expect(rewardBannerFor('max')).not.toBeNull();
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

  it('an untick below the bar during the quiet wait, written slowly: the re-check waits for it, so nothing is claimed or shown (#154)', async () => {
    let below = false;
    let pending: Promise<void> = Promise.resolve();
    const stillClaimable = vi.fn(() => !below);
    const claim = vi.fn(async () => true);
    noteChoreTick('max'); // the tick that crossed the bar
    const played = celebrateReward(req({ ticksSettled: () => pending, stillClaimable, claim }));
    await vi.advanceTimersByTimeAsync(1000);
    // The untick, tapped now; its write lands well after the quiet period.
    noteChoreTick('max');
    let land!: () => void;
    pending = new Promise<void>((resolve) => {
      land = () => {
        below = true;
        resolve();
      };
    });
    await vi.advanceTimersByTimeAsync(REWARD_TICK_QUIET_MS + 1000);
    expect(stillClaimable).not.toHaveBeenCalled(); // waiting on the untick's write
    land();
    expect(await played).toBe('dropped');
    expect(claim).not.toHaveBeenCalled();
    expect(rewardBannerFor('max')).toBeNull();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('a tick write that never lands: the one deadline ends it (unsettled), nothing asked, claimed or shown', async () => {
    const stillClaimable = vi.fn(() => true);
    const claim = vi.fn(async () => true);
    const played = celebrateReward(
      req({ ticksSettled: () => new Promise<void>(() => {}), stillClaimable, claim })
    );
    await vi.advanceTimersByTimeAsync(REWARD_BANNER_WAIT_MAX_MS);
    expect(await played).toBe('unsettled');
    expect(vi.getTimerCount()).toBe(0);
    expect(stillClaimable).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(rewardBannerFor('max')).toBeNull();
  });

  it('a slow write still pending after the quiet wait, the finishing tick tapped meanwhile: the block celebration first, the claim after it', async () => {
    const order: string[] = [];
    let pending: Promise<void> = Promise.resolve();
    const claim = vi.fn(async () => {
      order.push('claim');
      return true;
    });
    noteChoreTick('max'); // the tick that crossed the bar, written
    const played = celebrateReward(req({ ticksSettled: () => pending, claim }));
    await vi.advanceTimersByTimeAsync(1000);
    // A non-finishing tick whose write is slow.
    noteChoreTick('max');
    let land!: () => void;
    pending = new Promise<void>((resolve) => (land = resolve));
    await vi.advanceTimersByTimeAsync(REWARD_TICK_QUIET_MS + 500);
    expect(claim).not.toHaveBeenCalled(); // the next pass waits on that write
    // The block's finishing tick, tapped while that write is still pending: its celebration plays.
    noteChoreTick('max');
    expectChoreCelebration('max', 'afternoon');
    celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 });
    order.push('block');
    endChoreCelebrationExpected('max', 'afternoon');
    land();
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).not.toHaveBeenCalled(); // behind the block celebration now
    await vi.advanceTimersByTimeAsync(CHORE_CELEBRATION_BEATS.done);
    expect(await played).toBe('shown-after-wait');
    expect(order).toEqual(['block', 'claim']);
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('a block celebration starting while the banner is up changes nothing about the banner (the accepted overlap)', async () => {
    await celebrateReward(req());
    const shown = rewardBannerFor('max')!;
    await vi.advanceTimersByTimeAsync(3000);
    expect(celebrateChore({ memberId: 'max', block: 'afternoon', beanName: 'Max', count: 4 })).toBe(
      'max:afternoon'
    );
    expect(rewardBannerFor('max')).toBe(shown);
    await vi.advanceTimersByTimeAsync(REWARD_BANNER_MS - 3000 - 1);
    expect(rewardBannerFor('max')).toBe(shown);
    await vi.advanceTimersByTimeAsync(1);
    expect(rewardBannerFor('max')).toBeNull();
  });

  it('another child’s expected celebration does not hold it', async () => {
    expectChoreCelebration('juno', 'afternoon');
    expect(await celebrateReward(req())).toBe('shown');
  });

  it('the wait is bounded even if a block celebration never ended', async () => {
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 3 });
    const played = celebrateReward(req());
    await vi.advanceTimersByTimeAsync(REWARD_BANNER_WAIT_MAX_MS);
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
