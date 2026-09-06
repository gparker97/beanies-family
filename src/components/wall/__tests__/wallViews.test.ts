/**
 * The wall's view registry, and the back-target rule.
 *
 * The rule has its own file-worth of tests because three consecutive review
 * passes got it wrong — each fixing one path to a back control that names the
 * view you are already standing in, and each missing the other.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WALL_VIEW,
  WALL_VIEWS,
  canGoBackFrom,
  wallViewById,
  wallViewTransition,
  type WallViewState,
} from '../wallViews';

const start = (): WallViewState => ({ active: DEFAULT_WALL_VIEW, back: DEFAULT_WALL_VIEW });
const walk = (from: WallViewState, ...ids: Parameters<typeof wallViewTransition>[1][]) =>
  ids.reduce(wallViewTransition, from);

describe('the registry', () => {
  it('declares every field for every view — no half-filled rows', () => {
    // This file's stated maintainability test is "one component + one row", and
    // a row that can be partly filled fails it.
    for (const view of WALL_VIEWS) {
      expect(view).toHaveProperty('stepUnit');
      expect(view).toHaveProperty('arrowsInView');
      expect(typeof view.arrowsInView).toBe('boolean');
    }
  });

  it('⚠️ never claims a view draws arrows it has no dates to move', () => {
    // The reason `arrowsInView` is a boolean rather than a tri-state: the
    // incoherent combination is not constructible, so it cannot be asserted
    // against — but a future row could still set it, so pin it.
    for (const view of WALL_VIEWS) {
      if (view.stepUnit === null) expect(view.arrowsInView).toBe(false);
    }
  });

  it('resolves an unknown id to something rather than nothing', () => {
    expect(wallViewById('days').id).toBe('days');
    expect(wallViewById('nonsense' as 'days')).toBe(WALL_VIEWS[0]);
  });
});

describe('the back target', () => {
  it('remembers where you came from', () => {
    const s = wallViewTransition(start(), 'jobs');
    expect(s.active).toBe('jobs');
    expect(s.back).toBe('days');
    expect(canGoBackFrom(s)).toBe(true);
  });

  it('⚠️ re-tapping the tab you are on does not make back name itself', () => {
    // Path one. Without the `id !== active` guard, selecting `today` while in
    // `today` records `today` as the place to return to.
    const s = walk(start(), 'today', 'today', 'today');
    expect(s.active).toBe('today');
    expect(s.back).toBe('days');
    expect(canGoBackFrom(s)).toBe(true);
  });

  it('⭐ today → jobs → back never leaves a control pointing at today', () => {
    // Path two, and the one three passes missed. Entering jobs records `today`;
    // LEAVING jobs skips the write, because the write is gated on not being in
    // jobs — so `back` is still `today` while `active` becomes `today` again.
    // No write-side rule can see this coming, which is why `canGoBackFrom` is a
    // read-side check.
    const s = walk(start(), 'today', 'jobs', 'today');
    expect(s.active).toBe('today');
    expect(s.back).toBe('today');
    expect(canGoBackFrom(s)).toBe(false); // hidden, rather than self-pointing
  });

  it('leaves the jobs board with somewhere real to go, always', () => {
    // `back` can never hold 'jobs', because it is never written while in jobs.
    for (const via of ['days', 'lanes', 'today'] as const) {
      const s = walk(start(), via, 'jobs');
      expect(s.back).toBe(via);
      expect(s.back).not.toBe('jobs');
      expect(canGoBackFrom(s)).toBe(true);
    }
  });

  it('survives a long wander without ever pointing at itself', () => {
    // The invariant, stated as a property: whatever route you take, the control
    // is either hidden or it names a DIFFERENT view.
    let s = start();
    for (const id of [
      'today',
      'jobs',
      'today',
      'lanes',
      'lanes',
      'jobs',
      'days',
      'days',
    ] as const) {
      s = wallViewTransition(s, id);
      if (canGoBackFrom(s)) expect(s.back).not.toBe(s.active);
    }
  });
});
