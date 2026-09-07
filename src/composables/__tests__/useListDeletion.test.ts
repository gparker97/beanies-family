/**
 * The delete flow shared by the list tile and the detail drawer.
 *
 * The behaviour worth locking is the tri-state: `deleteList` says `true` deleted,
 * `false` refused-and-nobody-told-the-user, `null` threw-and-wrapAsync-already-said-so.
 * Collapsing the last two is what produced two stacked error toasts for one failure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const confirmFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmFn }));

const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: toast.fn }));

const reporter = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reporter.fn }));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

const deleteFn = vi.hoisted(() => vi.fn());
vi.mock('@/stores/listStore', () => ({ useListStore: () => ({ deleteList: deleteFn }) }));

import { confirmAndDeleteList } from '../useListDeletion';

beforeEach(() => {
  vi.clearAllMocks();
  confirmFn.mockResolvedValue(true);
});

describe('confirmAndDeleteList', () => {
  it('does nothing at all when the confirm is cancelled', async () => {
    confirmFn.mockResolvedValue(false);
    expect(await confirmAndDeleteList('l-1')).toBe(false);
    expect(deleteFn).not.toHaveBeenCalled();
    expect(toast.fn).not.toHaveBeenCalled();
  });

  it('confirms with the danger variant before deleting anything', async () => {
    deleteFn.mockResolvedValue(true);
    await confirmAndDeleteList('l-1');
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
  });

  it('reports true on a real deletion, silently', async () => {
    deleteFn.mockResolvedValue(true);
    expect(await confirmAndDeleteList('l-1')).toBe(true);
    expect(toast.fn).not.toHaveBeenCalled();
    expect(reporter.fn).not.toHaveBeenCalled();
  });

  it('tells the user when the delete was refused, instead of closing silently', async () => {
    deleteFn.mockResolvedValue(false);
    expect(await confirmAndDeleteList('l-1')).toBe(false);
    expect(toast.fn).toHaveBeenCalledWith('error', 'lists.detail.deleteFailed');
    expect(reporter.fn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the action threw, because wrapAsync already spoke', async () => {
    deleteFn.mockResolvedValue(null);
    expect(await confirmAndDeleteList('l-1')).toBe(false);
    // Two toasts and two reports for one failure is what the tri-state exists to stop.
    expect(toast.fn).not.toHaveBeenCalled();
    expect(reporter.fn).not.toHaveBeenCalled();
  });
});
