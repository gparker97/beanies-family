/**
 * The weekly reward's burst (#154): drawn while it is young, never under reduced motion (`calm`),
 * nothing once its time has passed since the banner started, and a host remounted part-way through
 * resumes it (a negative animation offset) rather than restarting it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import RewardBurst from '../RewardBurst.vue';
import source from '../RewardBurst.vue?raw';
import { REWARD_BURST_MS, REWARD_BANNER_MS } from '@/composables/useCelebration';

afterEach(() => {
  vi.useRealTimers();
});

const banner = (over: { calm?: boolean; startedAt?: number } = {}) => ({
  id: 7,
  emoji: '🍦',
  calm: false,
  startedAt: performance.now(),
  ...over,
});

describe('RewardBurst', () => {
  it('the reward’s picture with a shower of stars, decorative, then gone after its time', async () => {
    vi.useFakeTimers();
    const w = mount(RewardBurst, { props: { banner: banner({ startedAt: performance.now() }) } });
    const burst = w.get('[data-testid="reward-burst"]');
    expect(burst.attributes('aria-hidden')).toBe('true');
    expect(burst.classes()).toContain('pointer-events-none');
    expect(w.get('[data-testid="reward-burst-prize"]').text()).toBe('🍦');
    expect(w.findAll('.reward-burst-star').length).toBeGreaterThan(5);
    vi.advanceTimersByTime(REWARD_BURST_MS);
    await nextTick();
    expect(w.find('[data-testid="reward-burst"]').exists()).toBe(false);
  });

  it('calm (reduced motion): nothing is drawn', () => {
    const w = mount(RewardBurst, { props: { banner: banner({ calm: true }) } });
    expect(w.find('[data-testid="reward-burst"]').exists()).toBe(false);
  });

  it('a host remounted after its time: nothing; part-way: resumed, not restarted', () => {
    const late = mount(RewardBurst, {
      props: { banner: banner({ startedAt: performance.now() - REWARD_BURST_MS - 10 }) },
    });
    expect(late.find('[data-testid="reward-burst"]').exists()).toBe(false);
    const mid = mount(RewardBurst, {
      props: { banner: banner({ startedAt: performance.now() - 1000 }) },
    });
    const offset = mid.get('[data-testid="reward-burst"]').attributes('style');
    expect(offset).toMatch(/--burst-offset: -\d+ms/);
  });

  it('the picture’s animation length is the constant the unmount timer reads (one source)', () => {
    const w = mount(RewardBurst, { props: { banner: banner() } });
    expect(w.get('[data-testid="reward-burst"]').attributes('style')).toContain(
      `--burst-ms: ${REWARD_BURST_MS}ms`
    );
    // The picture's animation reads it; no second, hard-coded length in the CSS.
    expect(source).toMatch(/animation: reward-rise var\(--burst-ms\)/);
  });

  it('finishes well inside the banner', () => {
    expect(REWARD_BURST_MS).toBeLessThan(REWARD_BANNER_MS);
  });
});
