/**
 * The page's in-flight tick guard (#146), keyed `choreId:memberId`: a double-tap writes once,
 * a shared chore's beans tick independently, two different chores run together, and the
 * guard clears after a failure (`null`) so a retry is possible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const toggleChore = vi.hoisted(() => vi.fn());
vi.mock('@/stores/choreStore', () => ({ useChoreStore: () => ({ toggleChore }) }));
/** #148: every landed (or refused, or failed) toggle is handed to the star store, unawaited. */
const afterTick = vi.hoisted(() => vi.fn());
vi.mock('@/stores/starStore', () => ({ useStarStore: () => ({ afterTick }) }));

import { useChoreTicks } from '@/composables/useChoreTicks';

function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  toggleChore.mockReset();
  afterTick.mockReset();
});

/** A tick from a bean's day: that surface draws the reward banner. */
const DAY = { showsBanner: true };

describe('useChoreTicks', () => {
  it('a double-tap on the same tick writes once, with surface app', async () => {
    const d = deferred();
    toggleChore.mockReturnValue(d.promise);
    const ticks = useChoreTicks();
    const first = ticks.toggle('c1', 'kid', DAY);
    expect(ticks.isPending('c1', 'kid')).toBe(true);
    expect(await ticks.toggle('c1', 'kid', DAY)).toBeNull();
    d.resolve({ action: 'tick', completed: null, celebrated: false });
    await first;
    expect(toggleChore).toHaveBeenCalledTimes(1);
    expect(toggleChore).toHaveBeenCalledWith('c1', 'kid', { surface: 'app' });
    expect(ticks.isPending('c1', 'kid')).toBe(false);
  });

  it('a shared chore’s beans, and two different chores, are independent', async () => {
    const d = deferred();
    toggleChore.mockReturnValue(d.promise);
    const ticks = useChoreTicks();
    const all = [
      ticks.toggle('c1', 'kid', DAY),
      ticks.toggle('c1', 'sib', DAY),
      ticks.toggle('c2', 'kid', DAY),
    ];
    expect(toggleChore).toHaveBeenCalledTimes(3);
    d.resolve(null);
    await Promise.all(all);
  });

  it('clears after a failure, so the next tap retries', async () => {
    toggleChore.mockResolvedValueOnce(null).mockResolvedValueOnce({ action: 'tick' });
    const ticks = useChoreTicks();
    expect(await ticks.toggle('c1', 'kid', DAY)).toBeNull();
    expect(ticks.isPending('c1', 'kid')).toBe(false);
    expect(await ticks.toggle('c1', 'kid', DAY)).toEqual({ action: 'tick' });
    expect(toggleChore).toHaveBeenCalledTimes(2);
  });

  it('a refusal (already toasted by the store) answers null to the page, like a failure', async () => {
    toggleChore.mockResolvedValueOnce({ action: 'refused', detail: 'not-yours' });
    const ticks = useChoreTicks();
    expect(await ticks.toggle('c1', 'sib', DAY)).toBeNull();
    expect(ticks.isPending('c1', 'sib')).toBe(false);
  });

  it('hands every outcome to starStore.afterTick once, with surface app, without awaiting it', async () => {
    const landed = { action: 'tick', completed: null, celebrated: false };
    toggleChore.mockResolvedValueOnce(landed).mockResolvedValueOnce(null);
    // A star check that never settles must not hold the row's pending state.
    afterTick.mockReturnValue(new Promise(() => {}));
    const ticks = useChoreTicks();
    expect(await ticks.toggle('c1', 'kid', DAY)).toEqual(landed);
    expect(ticks.isPending('c1', 'kid')).toBe(false);
    expect(afterTick).toHaveBeenCalledTimes(1);
    expect(afterTick).toHaveBeenCalledWith({
      memberId: 'kid',
      outcome: landed,
      surface: 'app',
      showsBanner: true,
    });
    await ticks.toggle('c1', 'kid', DAY);
    expect(afterTick).toHaveBeenLastCalledWith({
      memberId: 'kid',
      outcome: null,
      surface: 'app',
      showsBanner: true,
    });
    expect(afterTick).toHaveBeenCalledTimes(2);
  });

  it('passes the surface’s showsBanner through (the home cards say false) and the anchor on', async () => {
    const landed = { action: 'tick', completed: null, celebrated: false };
    toggleChore.mockResolvedValue(landed);
    const ticks = useChoreTicks();
    const anchor = { block: {} } as never;
    await ticks.toggle('c1', 'kid', { anchor, showsBanner: false });
    expect(toggleChore).toHaveBeenCalledWith('c1', 'kid', { surface: 'app', anchor });
    expect(afterTick).toHaveBeenCalledWith(expect.objectContaining({ showsBanner: false }));
  });

  it('a double tap that never reaches the store never reaches afterTick either', async () => {
    const d = deferred();
    toggleChore.mockReturnValue(d.promise);
    const ticks = useChoreTicks();
    const first = ticks.toggle('c1', 'kid', DAY);
    await ticks.toggle('c1', 'kid', DAY);
    d.resolve({ action: 'tick', completed: null, celebrated: false });
    await first;
    expect(afterTick).toHaveBeenCalledTimes(1);
  });
});
