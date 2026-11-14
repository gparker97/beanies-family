/**
 * `failureBackoff` (#146): episodes on a doubling ladder, reported once per episode, timed on the
 * MONOTONIC clock so a wall-clock correction can never freeze the retries.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { failureBackoff, STATIC_LOAD_BACKOFF } from '@/utils/backoff';

afterEach(() => vi.restoreAllMocks());

describe('failureBackoff', () => {
  it('doubles from the base to the cap, and reports only an episode’s first failure', () => {
    const b = failureBackoff({ baseMs: 1000, maxMs: 4000 });
    expect(b.ready(0)).toBe(true);
    expect(b.fail(0)).toBe(true); // a new episode: report it
    expect(b.ready(999)).toBe(false);
    expect(b.ready(1000)).toBe(true);
    expect(b.fail(1000)).toBe(false); // same episode
    expect(b.ready(2999)).toBe(false);
    expect(b.fail(3000)).toBe(false);
    expect(b.fail(7000)).toBe(false); // capped at 4 s
    expect(b.ready(10_999)).toBe(false);
    expect(b.ready(11_000)).toBe(true);
    b.succeed();
    expect(b.ready(11_000)).toBe(true);
    expect(b.fail(11_000)).toBe(true); // a later failure is a new episode
  });

  it('the static-load ladder is short: 15 s, doubling to 5 min', () => {
    expect(STATIC_LOAD_BACKOFF).toEqual({ baseMs: 15_000, maxMs: 300_000 });
  });

  it('reads the monotonic clock, not Date: a wall-clock jump back does not freeze it', () => {
    let mono = 50_000;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    const b = failureBackoff();
    b.fail();
    // The wall clock jumps back a day; the monotonic clock simply moves on.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 86_400_000);
    mono += 15_000;
    expect(b.ready()).toBe(true);
  });
});
