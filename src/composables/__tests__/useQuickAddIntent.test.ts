/**
 * Orchestration tests for `useQuickAddIntent`. Pure helpers are tested
 * separately; this file only covers the gluing logic — query stripping
 * order, unknown-action boundary guard, handler try/catch.
 *
 * The composable uses `useRoute`/`useRouter`/`useTranslation`/
 * `showToast`. We mock all of them at the module boundary so we can
 * simulate query changes and observe router.replace + toast calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// Shared mock state — swap values between tests to simulate different
// route queries / action payloads.
const mockRoute = {
  query: {} as Record<string, string | string[] | null>,
};
const mockRouter = {
  replace: vi.fn().mockResolvedValue(undefined),
};

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useRouter: () => mockRouter,
  };
});

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const toastSpy = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => toastSpy(...args),
}));

import { useQuickAddIntent, type QuickAddIntentHandler } from '../useQuickAddIntent';

/**
 * Mount a trivial component that wires `useQuickAddIntent(handler)`
 * in its setup so we exercise the composable's onMounted + watch
 * lifecycle. The handler spy is returned so tests can assert calls.
 */
function mountWith(handler: QuickAddIntentHandler) {
  const Harness = defineComponent({
    setup() {
      useQuickAddIntent(handler);
      return () => null;
    },
  });
  return mount(Harness);
}

describe('useQuickAddIntent', () => {
  beforeEach(() => {
    mockRoute.query = {};
    mockRouter.replace.mockClear();
    toastSpy.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('no-ops when the route has no action query', async () => {
    const handler = vi.fn();
    mountWith(handler);
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('dispatches handler with typed action + empty context', async () => {
    mockRoute.query = { action: 'add-activity' };
    const handler = vi.fn();
    mountWith(handler);
    await nextTick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('add-activity', {});
  });

  it('dispatches handler with context ids extracted from the query', async () => {
    mockRoute.query = { action: 'add-saying', memberId: 'bean-42' };
    const handler = vi.fn();
    mountWith(handler);
    await nextTick();

    expect(handler).toHaveBeenCalledWith('add-saying', { memberId: 'bean-42' });
  });

  it('strips the consumed keys BEFORE calling the handler', async () => {
    mockRoute.query = { action: 'add-activity', memberId: 'x', goal: 'g' };
    const callOrder: string[] = [];
    mockRouter.replace.mockImplementationOnce(async () => {
      callOrder.push('replace');
    });
    mountWith(() => {
      callOrder.push('handler');
    });
    await nextTick();

    expect(callOrder).toEqual(['replace', 'handler']);
    // The replace call strips action + memberId but preserves goal.
    expect(mockRouter.replace).toHaveBeenCalledWith({ query: { goal: 'g' } });
  });

  it('blocks unknown action at the boundary — handler is NOT called', async () => {
    mockRoute.query = { action: 'add-definitely-not-real' };
    const handler = vi.fn();
    mountWith(handler);
    await nextTick();

    expect(handler).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      'quickAdd.error.unknown.title',
      'quickAdd.error.unknown.message'
    );
    // console.error tagged with the failing action for diagnostics
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('add-definitely-not-real'));
    // Query is still cleared so refresh doesn't re-fire the bad intent
    expect(mockRouter.replace).toHaveBeenCalled();
  });

  it('catches handler exceptions and surfaces a toast + console.error', async () => {
    mockRoute.query = { action: 'add-activity' };
    const boom = new Error('something blew up');
    mountWith(() => {
      throw boom;
    });
    await nextTick();
    // Allow the catch-branch microtask to flush
    await Promise.resolve();

    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      'quickAdd.error.handler.title',
      'something blew up'
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('add-activity'), boom);
    // Query already cleared before the handler ran → safe from re-entry
    expect(mockRouter.replace).toHaveBeenCalled();
  });

  it('surfaces the fallback message when handler throws a non-Error value', async () => {
    mockRoute.query = { action: 'add-activity' };
    mountWith(() => {
      throw 'just a string';
    });
    await nextTick();
    await Promise.resolve();

    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      'quickAdd.error.handler.title',
      'quickAdd.error.handler.message'
    );
  });

  it('ignores arrays and empty strings as the action', async () => {
    mockRoute.query = { action: [] as unknown as string };
    const handler = vi.fn();
    mountWith(handler);
    await nextTick();
    expect(handler).not.toHaveBeenCalled();

    mockRoute.query = { action: '' };
    mountWith(handler);
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });
});
