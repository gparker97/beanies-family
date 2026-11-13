/**
 * The page's in-flight tick guard (#146), keyed `choreId:memberId`: a double-tap writes once,
 * a shared chore's beans tick independently, two different chores run together, and the
 * guard clears after a failure (`null`) so a retry is possible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const toggleChore = vi.hoisted(() => vi.fn());
vi.mock('@/stores/choreStore', () => ({ useChoreStore: () => ({ toggleChore }) }));

import { useChoreTicks } from '@/composables/useChoreTicks';

function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => toggleChore.mockReset());

describe('useChoreTicks', () => {
  it('a double-tap on the same tick writes once, with surface app', async () => {
    const d = deferred();
    toggleChore.mockReturnValue(d.promise);
    const ticks = useChoreTicks();
    const first = ticks.toggle('c1', 'kid');
    expect(ticks.isPending('c1', 'kid')).toBe(true);
    expect(await ticks.toggle('c1', 'kid')).toBeNull();
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
    const all = [ticks.toggle('c1', 'kid'), ticks.toggle('c1', 'sib'), ticks.toggle('c2', 'kid')];
    expect(toggleChore).toHaveBeenCalledTimes(3);
    d.resolve(null);
    await Promise.all(all);
  });

  it('clears after a failure, so the next tap retries', async () => {
    toggleChore.mockResolvedValueOnce(null).mockResolvedValueOnce({ action: 'tick' });
    const ticks = useChoreTicks();
    expect(await ticks.toggle('c1', 'kid')).toBeNull();
    expect(ticks.isPending('c1', 'kid')).toBe(false);
    expect(await ticks.toggle('c1', 'kid')).toEqual({ action: 'tick' });
    expect(toggleChore).toHaveBeenCalledTimes(2);
  });

  it('a refusal (already toasted by the store) answers null to the page, like a failure', async () => {
    toggleChore.mockResolvedValueOnce({ action: 'refused', detail: 'not-yours' });
    const ticks = useChoreTicks();
    expect(await ticks.toggle('c1', 'sib')).toBeNull();
    expect(ticks.isPending('c1', 'sib')).toBe(false);
  });
});
