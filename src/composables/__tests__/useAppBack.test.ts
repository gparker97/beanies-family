import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const router = { back: vi.fn(), push: vi.fn() };
vi.mock('vue-router', () => ({ useRouter: () => router }));

import { useAppBack } from '../useAppBack';

describe('useAppBack', () => {
  let state: unknown;
  beforeEach(() => {
    router.back.mockClear();
    router.push.mockClear();
    vi.spyOn(window.history, 'state', 'get').mockImplementation(() => state);
  });
  afterEach(() => vi.restoreAllMocks());

  it('goes back in history when the previous entry is in the app', () => {
    state = { back: '/pod/cookbook', position: 4 };
    useAppBack().goBack('/pod/cookbook');
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pushes the fallback on the first entry of the tab (a deep link)', () => {
    state = { back: null, position: 0 };
    useAppBack().goBack({ path: '/travel' });
    expect(router.push).toHaveBeenCalledWith({ path: '/travel' });
    expect(router.back).not.toHaveBeenCalled();
  });

  it('pushes the fallback when there is no history state at all', () => {
    state = null;
    useAppBack().goBack('/pod');
    expect(router.push).toHaveBeenCalledWith('/pod');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('with `onlyTo`, goes back only when the previous entry is exactly that full path', () => {
    state = { back: '/travel' };
    useAppBack().goBack({ path: '/travel' }, { onlyTo: '/travel' });
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('with `onlyTo`, pushes the fallback from another trip, the planner, or a lookalike path', () => {
    for (const back of ['/travel?vacation=v1', '/activities?view=day', '/travelogue']) {
      state = { back };
      useAppBack().goBack({ path: '/travel' }, { onlyTo: '/travel' });
    }
    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(3);
    expect(router.push).toHaveBeenCalledWith({ path: '/travel' });
  });
});
