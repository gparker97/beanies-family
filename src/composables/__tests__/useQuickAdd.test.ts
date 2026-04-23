/**
 * Tests for the module-level singleton state + stage machine.
 * Pure-function navigation logic is covered in buildIntentQuery.test.ts;
 * here we verify the state transitions and the main ↔ picker branching
 * in `triggerQuickAddAction`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

// --- Mocks must be set up BEFORE importing the module under test ---------
//
// Both `vi.mock` factories and the shared state they reference must live
// inside `vi.hoisted` — vitest hoists mock calls above regular top-level
// code at transform time, so plain `const` declarations outside hoisted()
// aren't in scope when the factory runs.

const hoisted = vi.hoisted(() => {
  const mockRoute: Partial<RouteLocationNormalizedLoaded> = {
    path: '/dashboard',
    params: {},
  };
  return {
    mockRoute,
    push: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
    hasOpenOverlays: vi.fn(() => false),
  };
});

vi.mock('@/utils/overlayStack', () => ({
  hasOpenOverlays: hoisted.hasOpenOverlays,
}));

vi.mock('@/router', () => ({
  default: {
    get currentRoute() {
      return { value: hoisted.mockRoute };
    },
    push: hoisted.push,
    replace: hoisted.replace,
  },
}));

const mockRoute = hoisted.mockRoute;
const push = hoisted.push;
const replace = hoisted.replace;
const mockedHasOpenOverlays = hoisted.hasOpenOverlays;

import {
  useQuickAdd,
  openQuickAdd,
  closeQuickAdd,
  toggleQuickAdd,
  triggerQuickAddAction,
  commitPickerSelection,
  cancelPicker,
} from '../useQuickAdd';
import type { QuickAddItem } from '@/constants/quickAddItems';

function item(overrides: Partial<QuickAddItem> = {}): QuickAddItem {
  return {
    id: 'saying',
    group: 'everyday',
    order: 1,
    emoji: '💬',
    labelKey: 'quickAdd.saying.label',
    hintKey: 'quickAdd.saying.hint',
    route: '/pod/scrapbook',
    action: 'add-saying',
    ...overrides,
  } as QuickAddItem;
}

describe('useQuickAdd — open/close singleton state', () => {
  beforeEach(() => {
    mockedHasOpenOverlays.mockReturnValue(false);
    push.mockClear();
    replace.mockClear();
    mockRoute.path = '/dashboard';
    mockRoute.params = {};
    // Reset jsdom history so the sheet-marker from a previous test doesn't
    // leak into this one. replaceState wipes any state without triggering
    // popstate or changing the URL.
    window.history.replaceState(null, '');
    closeQuickAdd();
    window.history.replaceState(null, '');
  });

  it('isOpen starts closed', () => {
    const { isOpen } = useQuickAdd();
    expect(isOpen.value).toBe(false);
  });

  it('open() → close() round-trips', () => {
    const { isOpen } = useQuickAdd();
    openQuickAdd();
    expect(isOpen.value).toBe(true);
    closeQuickAdd();
    expect(isOpen.value).toBe(false);
  });

  it('toggle() flips state', () => {
    const { isOpen } = useQuickAdd();
    toggleQuickAdd();
    expect(isOpen.value).toBe(true);
    toggleQuickAdd();
    expect(isOpen.value).toBe(false);
  });

  it('state is shared across calls to useQuickAdd()', () => {
    const a = useQuickAdd();
    const b = useQuickAdd();
    openQuickAdd();
    expect(a.isOpen.value).toBe(true);
    expect(b.isOpen.value).toBe(true);
  });

  it('open() is a no-op when another overlay is already open', () => {
    mockedHasOpenOverlays.mockReturnValue(true);
    const { isOpen } = useQuickAdd();
    openQuickAdd();
    expect(isOpen.value).toBe(false);
  });

  it('toggle() skips open when another overlay is open, but still closes', () => {
    const { isOpen } = useQuickAdd();

    mockedHasOpenOverlays.mockReturnValue(false);
    toggleQuickAdd();
    expect(isOpen.value).toBe(true);

    mockedHasOpenOverlays.mockReturnValue(true);
    toggleQuickAdd();
    expect(isOpen.value).toBe(false);

    toggleQuickAdd();
    expect(isOpen.value).toBe(false);
  });

  it('close resets stage to main even if we were in picker mode', () => {
    const { stage } = useQuickAdd();
    openQuickAdd();
    triggerQuickAddAction(item({ contextKey: 'memberId' }));
    expect(stage.value.mode).toBe('picker');
    closeQuickAdd();
    expect(stage.value.mode).toBe('main');
  });
});

describe('useQuickAdd — history integration (back gesture)', () => {
  beforeEach(() => {
    mockedHasOpenOverlays.mockReturnValue(false);
    push.mockClear();
    replace.mockClear();
    mockRoute.path = '/dashboard';
    mockRoute.params = {};
    window.history.replaceState(null, '');
    closeQuickAdd();
    window.history.replaceState(null, '');
  });

  it('open() pushes a marker onto window.history', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    openQuickAdd();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [state] = pushSpy.mock.calls[0] ?? [];
    expect(state).toMatchObject({ __beanieQuickAddOpen: true });
    pushSpy.mockRestore();
  });

  it('close() pops the marker via history.back when the marker is on the stack', () => {
    openQuickAdd();
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    closeQuickAdd();
    expect(backSpy).toHaveBeenCalledTimes(1);
    backSpy.mockRestore();
  });

  it('close() does not call history.back when there is no marker', () => {
    // Sheet was never opened, or marker was wiped externally.
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    closeQuickAdd();
    expect(backSpy).not.toHaveBeenCalled();
    backSpy.mockRestore();
  });

  it('popstate closes the sheet without re-popping history', () => {
    const { isOpen } = useQuickAdd();
    openQuickAdd();
    expect(isOpen.value).toBe(true);

    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    // Simulate the back gesture — jsdom fires popstate when navigating but
    // we also need to clear the marker so the popstate handler's "were we
    // our own entry?" check is consistent. jsdom dispatches popstate; we
    // wipe the state first so the handler sees a non-marker state.
    window.history.replaceState(null, '');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(isOpen.value).toBe(false);
    expect(backSpy).not.toHaveBeenCalled();
    backSpy.mockRestore();
  });
});

describe('triggerQuickAddAction — main ↔ picker branching', () => {
  beforeEach(() => {
    mockedHasOpenOverlays.mockReturnValue(false);
    push.mockClear();
    replace.mockClear();
    mockRoute.path = '/dashboard';
    mockRoute.params = {};
    window.history.replaceState(null, '');
    closeQuickAdd();
    window.history.replaceState(null, '');
    openQuickAdd();
  });

  it('item with no contextKey navigates and closes sheet', () => {
    const { isOpen, stage } = useQuickAdd();
    triggerQuickAddAction(
      item({ contextKey: undefined, route: '/transactions', action: 'add-transaction' })
    );
    expect(isOpen.value).toBe(false);
    expect(stage.value.mode).toBe('main');
    // Sheet pushed a history marker on open, so navigation replaces the
    // marker entry with the target — back from target goes to pre-sheet.
    expect(replace).toHaveBeenCalledWith({
      path: '/transactions',
      query: { action: 'add-transaction' },
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('item with contextKey PRESENT in route params navigates with context', () => {
    mockRoute.path = '/pod/bean-alice/overview';
    mockRoute.params = { memberId: 'bean-alice' };

    const { isOpen } = useQuickAdd();
    triggerQuickAddAction(item({ contextKey: 'memberId' }));

    expect(isOpen.value).toBe(false);
    expect(replace).toHaveBeenCalledWith({
      path: '/pod/scrapbook',
      query: { action: 'add-saying', memberId: 'bean-alice' },
    });
  });

  it('item with contextKey MISSING from route transitions to picker, sheet stays open', () => {
    const { isOpen, stage } = useQuickAdd();
    triggerQuickAddAction(item({ contextKey: 'memberId' }));

    expect(isOpen.value).toBe(true);
    expect(stage.value.mode).toBe('picker');
    if (stage.value.mode === 'picker') {
      expect(stage.value.pending.action).toBe('add-saying');
    }
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces when marker is on the history stack, regardless of same/cross-route', () => {
    // Marker present (opened via FAB). Cross-route goes replace — not push —
    // so the marker entry gets overwritten by the target.
    mockRoute.path = '/dashboard';
    triggerQuickAddAction(
      item({ route: '/transactions', action: 'add-transaction', contextKey: undefined })
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('pushes when no marker is present and route differs (defensive fallback)', () => {
    // Reset history so the open marker is gone before we navigate.
    push.mockClear();
    replace.mockClear();
    window.history.replaceState(null, '');

    mockRoute.path = '/dashboard';
    triggerQuickAddAction(
      item({ route: '/transactions', action: 'add-transaction', contextKey: undefined })
    );
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('picker commit + cancel', () => {
  beforeEach(() => {
    mockedHasOpenOverlays.mockReturnValue(false);
    push.mockClear();
    replace.mockClear();
    mockRoute.path = '/dashboard';
    mockRoute.params = {};
    window.history.replaceState(null, '');
    closeQuickAdd();
    window.history.replaceState(null, '');
    openQuickAdd();
    triggerQuickAddAction(item({ contextKey: 'memberId' }));
  });

  it('commitPickerSelection navigates with the resolved context id', () => {
    const { isOpen, stage } = useQuickAdd();
    commitPickerSelection('bean-bob');

    expect(isOpen.value).toBe(false);
    expect(stage.value.mode).toBe('main');
    // Marker is on the stack (openQuickAdd ran in beforeEach), so the
    // target route replaces the marker entry rather than stacking on top.
    expect(replace).toHaveBeenCalledWith({
      path: '/pod/scrapbook',
      query: { action: 'add-saying', memberId: 'bean-bob' },
    });
  });

  it('cancelPicker returns to main without navigating; sheet stays open', () => {
    const { isOpen, stage } = useQuickAdd();
    cancelPicker();

    expect(stage.value.mode).toBe('main');
    expect(isOpen.value).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('commitPickerSelection while in main mode is a no-op (defensive)', () => {
    cancelPicker(); // back to main
    commitPickerSelection('irrelevant');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
