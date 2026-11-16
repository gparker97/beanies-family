/**
 * The weekly reward's achieved banner (#148): `celebrateReward` waits behind that child's block
 * celebration (if one plays), asks `stillClaimable()` and drops the banner if the child unticked
 * below the bar, THEN claims the week (`claim()`, the store's mark) and shows only when the
 * claim says yes; the banner ends on its own timer. It logs
 * nothing (the star store logs its answer).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/composables/useSounds', () => ({
  playFanfare: vi.fn(),
  playChime: vi.fn(),
  playChoreCelebrationSound: vi.fn(async () => 'played'),
  cancelChoreCelebrationSound: vi.fn(),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));

import {
  REWARD_BANNER_MS,
  REWARD_BANNER_WAIT_MAX_MS,
  celebrateChore,
  celebrateReward,
  dismissChoreCelebration,
  resetChoreCelebrationForTest,
  rewardBannerFor,
  type RewardCelebrationRequest,
} from '@/composables/useCelebration';

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
  logEvent.mockClear();
});

afterEach(() => {
  resetChoreCelebrationForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('celebrateReward', () => {
  it('shows at once with no block celebration, and ends on its own timer', async () => {
    expect(await celebrateReward(req())).toBe('played');
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
    expect(await played).toBe('waited');
    expect(rewardBannerFor('max')).not.toBeNull();
  });

  it('another child’s block celebration does not hold it', async () => {
    celebrateChore({ memberId: 'juno', block: 'morning', beanName: 'Juno', count: 3 });
    expect(await celebrateReward(req())).toBe('played');
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

  it('the wait is bounded even if a block celebration never ended', async () => {
    celebrateChore({ memberId: 'max', block: 'morning', beanName: 'Max', count: 3 });
    const played = celebrateReward(req());
    vi.advanceTimersByTime(REWARD_BANNER_WAIT_MAX_MS);
    expect(await played).toBe('waited');
  });
});
