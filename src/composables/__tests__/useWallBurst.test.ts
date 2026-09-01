import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { CHEER_KEYS, useWallBurst } from '@/composables/useWallBurst';

describe('useWallBurst', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds a burst at the given coordinates and clears it on its own', () => {
    const { bursts, burst } = useWallBurst();
    burst(120, 340);

    expect(bursts.value).toHaveLength(1);
    expect(bursts.value[0]).toMatchObject({ x: 120, y: 340 });
    expect(bursts.value[0].beans.length).toBeGreaterThan(0);

    vi.advanceTimersByTime(2000);
    expect(bursts.value).toHaveLength(0);
  });

  it('stacks concurrent bursts — four children ticking at once must all be seen', () => {
    const { bursts, burst } = useWallBurst();
    burst(10, 10);
    burst(20, 20);
    burst(30, 30);

    expect(bursts.value).toHaveLength(3);
  });

  it('expires each burst on its own timer, not the newest one', () => {
    const { bursts, burst } = useWallBurst();
    burst(10, 10);
    vi.advanceTimersByTime(1000);
    burst(20, 20);

    // The first is past its lifetime; the second is not.
    vi.advanceTimersByTime(700);
    expect(bursts.value).toHaveLength(1);
    expect(bursts.value[0]).toMatchObject({ x: 20 });
  });

  it('rotates the cheer so consecutive ticks do not repeat a word', () => {
    const { bursts, burst } = useWallBurst();
    for (let i = 0; i < CHEER_KEYS.length; i++) burst(i, i);

    const used = bursts.value.map((b) => b.cheerKey);
    expect(new Set(used).size).toBe(CHEER_KEYS.length);
  });

  it('clears pending timers when the scope is disposed', () => {
    const scope = effectScope();
    let api!: ReturnType<typeof useWallBurst>;
    scope.run(() => (api = useWallBurst()));
    api.burst(1, 1);
    expect(api.bursts.value).toHaveLength(1);

    scope.stop();
    // A live timer here would write to a ref belonging to a disposed scope.
    expect(vi.getTimerCount()).toBe(0);
  });
});
