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
    closeQuickAdd();
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

describe('triggerQuickAddAction — main ↔ picker branching', () => {
  beforeEach(() => {
    mockedHasOpenOverlays.mockReturnValue(false);
    push.mockClear();
    replace.mockClear();
    mockRoute.path = '/dashboard';
    mockRoute.params = {};
    closeQuickAdd();
    openQuickAdd();
  });

  it('item with no contextKey navigates and closes sheet', () => {
    const { isOpen, stage } = useQuickAdd();
    triggerQuickAddAction(
      item({ contextKey: undefined, route: '/transactions', action: 'add-transaction' })
    );
    expect(isOpen.value).toBe(false);
    expect(stage.value.mode).toBe('main');
    expect(push).toHaveBeenCalledWith({
      path: '/transactions',
      query: { action: 'add-transaction' },
    });
  });

  it('item with contextKey PRESENT in route params navigates with context', () => {
    mockRoute.path = '/pod/bean-alice/overview';
    mockRoute.params = { memberId: 'bean-alice' };

    const { isOpen } = useQuickAdd();
    triggerQuickAddAction(item({ contextKey: 'memberId' }));

    expect(isOpen.value).toBe(false);
    expect(push).toHaveBeenCalledWith({
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

  it('same-route tap uses replace, cross-route tap uses push', () => {
    mockRoute.path = '/transactions';
    triggerQuickAddAction(
      item({ route: '/transactions', action: 'add-transaction', contextKey: undefined })
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    push.mockClear();
    replace.mockClear();

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
    closeQuickAdd();
    openQuickAdd();
    triggerQuickAddAction(item({ contextKey: 'memberId' }));
  });

  it('commitPickerSelection navigates with the resolved context id', () => {
    const { isOpen, stage } = useQuickAdd();
    commitPickerSelection('bean-bob');

    expect(isOpen.value).toBe(false);
    expect(stage.value.mode).toBe('main');
    expect(push).toHaveBeenCalledWith({
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
