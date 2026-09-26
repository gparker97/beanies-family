/**
 * useDealActions: the one undo toast for the deck. Only a truthy store result toasts
 * (the store already reported every failure), the toast carries Undo wired to the
 * token, and only one deck undo toast is ever live.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UndoToken } from '@/utils/responsibilityOps';

const toast = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn(), invoke: vi.fn() }));
vi.mock('@/composables/useToast', () => ({
  showToast: toast.show,
  dismissToast: toast.dismiss,
  invokeToastAction: toast.invoke,
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberName: (id: string) => `name:${id}` }),
}));
vi.mock('@/composables/useResponsibilityCardLabel', () => ({
  useResponsibilityCardLabel: () => ({ cardName: (c: { id: string }) => `card:${c.id}` }),
}));
const store = vi.hoisted(() => ({
  deal: vi.fn(),
  keep: vi.fn(),
  skip: vi.fn(),
  bringBack: vi.fn(),
  undo: vi.fn(),
  cardById: vi.fn((id: string) => ({ id })),
}));
vi.mock('@/stores/responsibilityStore', () => ({ useResponsibilityStore: () => store }));

import { useDealActions, resetDealActionsForTest, UNDO_TOAST_MS } from '../useDealActions';

const TOKEN: UndoToken = {
  action: 'deal',
  before: {},
  afterUpdatedAt: {},
  createdMoveIds: [],
  createdCheckInIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetDealActionsForTest();
  let id = 0;
  toast.show.mockImplementation(() => ++id);
});

describe('useDealActions', () => {
  it('shows one toast with Undo after a successful deal, wired to the token', async () => {
    store.deal.mockResolvedValue({ result: { id: 'laundry' }, undo: TOKEN });
    store.undo.mockResolvedValue(true);
    const { deal } = useDealActions();

    await deal('laundry', 'main', 'sofia');

    expect(store.deal).toHaveBeenCalledWith('laundry', 'main', 'sofia');
    expect(toast.show).toHaveBeenCalledTimes(1);
    const [type, , , opts] = toast.show.mock.calls[0]!;
    expect(type).toBe('success');
    expect(opts).toMatchObject({ actionLabel: 'action.undo', durationMs: UNDO_TOAST_MS });

    await opts.actionFn();
    expect(store.undo).toHaveBeenCalledWith(TOKEN);
    expect(toast.show).toHaveBeenLastCalledWith('success', 'whoOwnsWhat.toast.undone');
  });

  it('never toasts when the store refused or failed (it already told the person)', async () => {
    store.skip.mockResolvedValue(null);
    const { skip } = useDealActions();
    expect(await skip(['car-care'])).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('keeps only one deck undo toast visible at a time', async () => {
    store.keep.mockResolvedValue({ result: { id: 'a' }, undo: TOKEN });
    store.bringBack.mockResolvedValue({ result: { id: 'b' }, undo: TOKEN });
    const actions = useDealActions();

    await actions.keep('a');
    expect(toast.dismiss).not.toHaveBeenCalled();
    await actions.bringBack('b');
    expect(toast.dismiss).toHaveBeenCalledWith(1);
  });

  it('shows a plain toast (no Undo) when nothing changed', async () => {
    store.deal.mockResolvedValue({ result: { id: 'laundry' }, undo: null });
    await useDealActions().deal('laundry', 'main', null);
    expect(toast.show).toHaveBeenCalledWith('success', 'whoOwnsWhat.toast.cleared');
  });

  it('a stale undo resolves falsy and adds no second toast', async () => {
    store.undo.mockResolvedValue(null);
    expect(await useDealActions().undo(TOKEN)).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('calls onUndone only when the toast Undo actually landed', async () => {
    store.skip.mockResolvedValue({ result: ['a'], undo: TOKEN });
    const onUndone = vi.fn();
    await useDealActions().skip(['a'], { onUndone });
    const opts = toast.show.mock.calls[0]![3];

    store.undo.mockResolvedValueOnce(null);
    await opts.actionFn();
    expect(onUndone).not.toHaveBeenCalled();

    store.undo.mockResolvedValueOnce(true);
    await opts.actionFn();
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it('bringBack passes onUndone through to its Undo', async () => {
    store.bringBack.mockResolvedValue({ result: { id: 'laundry' }, undo: TOKEN });
    const onUndone = vi.fn();
    await useDealActions().bringBack('laundry', { onUndone });
    store.undo.mockResolvedValueOnce(true);
    await toast.show.mock.calls[0]![3].actionFn();
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  describe('undoLast', () => {
    it("taps the live toast's Undo, once", async () => {
      store.keep.mockResolvedValue({ result: { id: 'laundry' }, undo: TOKEN });
      expect(useDealActions().hasLiveUndo()).toBe(false);
      await useDealActions().keep('laundry');
      expect(useDealActions().hasLiveUndo()).toBe(true);
      await useDealActions().undoLast();
      expect(toast.invoke).toHaveBeenCalledWith(1);
      expect(useDealActions().hasLiveUndo()).toBe(false);
      await useDealActions().undoLast();
      expect(toast.invoke).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no toast has been shown', async () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      await useDealActions().undoLast();
      expect(toast.invoke).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalled();
      debug.mockRestore();
    });

    it('does nothing when the live toast is a plain one (nothing to undo)', async () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      store.deal.mockResolvedValue({ result: { id: 'laundry' }, undo: null });
      await useDealActions().deal('laundry', 'main', null);
      expect(useDealActions().hasLiveUndo()).toBe(false);
      await useDealActions().undoLast();
      expect(toast.invoke).not.toHaveBeenCalled();
      debug.mockRestore();
    });

    it('an expired toast is left to invokeToastAction, which no-ops', async () => {
      store.skip.mockResolvedValue({ result: ['a'], undo: TOKEN });
      await useDealActions().skip(['a']);
      toast.invoke.mockResolvedValueOnce(undefined);
      await useDealActions().undoLast();
      expect(toast.invoke).toHaveBeenCalledWith(1);
      expect(store.undo).not.toHaveBeenCalled();
    });
  });
});
