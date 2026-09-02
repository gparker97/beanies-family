/**
 * The once-per-session confetti claim.
 *
 * The property that matters is that a SECOND mount of the same card gets nothing — a
 * celebrating card re-mounts on every scroll in a virtualised list and on every day
 * rollover on the wall, and replaying the animation each time turns a once-a-year moment
 * into a twitch.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { claimConfetti, resetCelebrationSeen } from '@/composables/useCelebrationSeen';

beforeEach(() => resetCelebrationSeen());

describe('claimConfetti', () => {
  it('grants the confetti once, then never again for that activity', () => {
    expect(claimConfetti('act-1')).toBe(true);
    expect(claimConfetti('act-1')).toBe(false);
    expect(claimConfetti('act-1')).toBe(false);
  });

  it('tracks activities independently', () => {
    expect(claimConfetti('act-1')).toBe(true);
    expect(claimConfetti('act-2')).toBe(true);
    expect(claimConfetti('act-1')).toBe(false);
    expect(claimConfetti('act-2')).toBe(false);
  });

  it('reset restores the claim — a new pod gets its moment', () => {
    expect(claimConfetti('act-1')).toBe(true);
    resetCelebrationSeen();
    expect(claimConfetti('act-1')).toBe(true);
  });

  /**
   * The bound exists so a wall left running for months cannot grow the Set without limit.
   * Clearing wholesale means the entry that tipped it over is re-grantable, which costs one
   * replayed animation — deliberately cheaper than an LRU for a decoration.
   */
  it('stays bounded, and the cost of the bound is only a replay', () => {
    for (let i = 0; i < 500; i++) expect(claimConfetti(`act-${i}`)).toBe(true);
    // The 501st clears the Set, so an early id becomes claimable again.
    expect(claimConfetti('act-overflow')).toBe(true);
    expect(claimConfetti('act-0')).toBe(true);
  });
});
