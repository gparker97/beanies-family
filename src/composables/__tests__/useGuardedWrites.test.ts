/** The shared grown-up write contract (#148; extracted from the chore store). */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({
    t: (k: string) => (k === 'msg.over' ? '{name} has {count} stars' : k),
  }),
}));
const family = {
  members: [
    { id: 'mom', role: 'owner', ageGroup: 'adult' },
    { id: 'kid', role: 'member', ageGroup: 'child' },
    { id: 'rex', role: 'member', ageGroup: 'adult', isPet: true },
  ],
};
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));
const wrapAsync = vi.fn();
vi.mock('@/composables/useStoreActions', () => ({
  wrapAsync: (...a: unknown[]) => wrapAsync(...a),
}));

import { createGuardedWrites } from '../useGuardedWrites';

type R = 'no' | 'over';
function make() {
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const g = createGuardedWrites<R>({
    surface: 'chore-stars',
    store: 'starStore',
    isLoading,
    error,
    messages: { no: 'msg.no' as never, over: 'msg.over' as never },
    notAdult: 'no',
  });
  return { g, isLoading, error };
}

beforeEach(() => vi.clearAllMocks());

describe('createGuardedWrites', () => {
  it('log sends the surface and the context', () => {
    make().g.log('info', 'thing-done', { count: 2 });
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'chore-stars',
      message: 'thing-done',
      context: { count: 2 },
    });
  });

  it('refuse is an info toast and an edit-refused warn, and answers null', () => {
    expect(make().g.refuse('no', 'giveStars')).toBeNull();
    expect(showToast).toHaveBeenCalledWith('info', 'msg.no');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: 'edit-refused',
        context: { action: 'giveStars', detail: 'no' },
      })
    );
  });

  it('refuse fills the message with vars; the log never carries them', () => {
    make().g.refuse('over', 'giveStars', { name: 'Max', count: 3 });
    expect(showToast).toHaveBeenCalledWith('info', 'Max has 3 stars');
    expect(logEvent.mock.calls[0]![0].context).toEqual({ action: 'giveStars', detail: 'over' });
  });

  it.each([
    ['an adult', 'mom', 'mom'],
    ['a child', 'kid', null],
    ['a pet', 'rex', null],
    ['nobody', null, null],
    ['an unknown id', 'ghost', null],
  ])('adultActor: %s', (_n, actorId, want) => {
    expect(make().g.adultActor(actorId, 'setRewards')).toBe(want);
    if (want === null) expect(showToast).toHaveBeenCalledWith('info', 'msg.no');
    else expect(showToast).not.toHaveBeenCalled();
  });

  it('write runs under wrapAsync with the store-prefixed action; undefined becomes null', async () => {
    const { g, isLoading, error } = make();
    wrapAsync.mockResolvedValueOnce('ok');
    const fn = async () => 'ok';
    expect(await g.write('saveAward', fn)).toBe('ok');
    expect(wrapAsync).toHaveBeenCalledWith(isLoading, error, fn, {
      action: 'starStore:saveAward',
      surface: 'chore-stars',
      errorToast: true,
    });
    wrapAsync.mockResolvedValueOnce(undefined);
    expect(await g.write('saveAward', fn, { errorToast: false })).toBeNull();
    expect(wrapAsync.mock.calls[1]![3]).toMatchObject({ errorToast: false });
  });
});
