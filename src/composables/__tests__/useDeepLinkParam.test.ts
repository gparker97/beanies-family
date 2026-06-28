/**
 * Tests for `useDeepLinkParam` — the deep-link opener that survives the
 * cold-start race (param read before the backing store has hydrated).
 *
 * The composable uses `useRoute`/`useRouter`; we mock them at the module
 * boundary so we can observe `router.replace` and feed query values. The
 * `ready` signal is a real reactive ref the tests flip to simulate the store
 * hydrating after mount.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

const mockRoute = {
  query: {} as Record<string, string | string[] | null | undefined>,
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

import { useDeepLinkParam } from '../useDeepLinkParam';

/**
 * Mount a trivial component wiring `useDeepLinkParam` against a fake store
 * (`items`). `open` resolves the id out of `items` exactly like the real page
 * handlers do, so a miss (store not loaded) returns false.
 */
function mountWith(param: string) {
  const items = ref<Array<{ id: string }>>([]);
  const opened: string[] = [];
  const Harness = defineComponent({
    setup() {
      useDeepLinkParam({
        param,
        open: (id) => {
          const found = items.value.find((i) => i.id === id);
          if (!found) return false;
          opened.push(id);
          return true;
        },
        ready: () => items.value.length,
      });
      return () => null;
    },
  });
  const wrapper = mount(Harness);
  return { items, opened, wrapper };
}

describe('useDeepLinkParam', () => {
  beforeEach(() => {
    mockRoute.query = {};
    mockRouter.replace.mockClear();
  });

  it('does nothing when the param is absent', async () => {
    const { opened } = mountWith('activity');
    await nextTick();
    expect(opened).toEqual([]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('warm start: opens on mount and clears the consumed param', async () => {
    mockRoute.query = { activity: 'a1' };
    const items = ref<Array<{ id: string }>>([{ id: 'a1' }]);
    const opened: string[] = [];
    const Harness = defineComponent({
      setup() {
        useDeepLinkParam({
          param: 'activity',
          open: (id) => {
            if (!items.value.find((i) => i.id === id)) return false;
            opened.push(id);
            return true;
          },
          ready: () => items.value.length,
        });
        return () => null;
      },
    });
    mount(Harness);
    await nextTick();
    expect(opened).toEqual(['a1']);
    expect(mockRouter.replace).toHaveBeenCalledWith({ query: {} });
  });

  it('cold start: does NOT clear the param when the item is not found yet, then opens + clears once the store hydrates', async () => {
    mockRoute.query = { activity: 'a1' };
    const { items, opened } = mountWith('activity');
    await nextTick();

    // Store still empty → miss → must NOT have cleared the link (so it can retry).
    expect(opened).toEqual([]);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    // Data arrives → ready flips → retry succeeds.
    items.value = [{ id: 'a1' }];
    await nextTick();

    expect(opened).toEqual(['a1']);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ query: {} });
  });

  it('clears only the consumed param, preserving the rest of the query', async () => {
    mockRoute.query = { activity: 'a1', foo: 'bar' };
    const items = ref<Array<{ id: string }>>([{ id: 'a1' }]);
    const Harness = defineComponent({
      setup() {
        useDeepLinkParam({
          param: 'activity',
          open: (id) => Boolean(items.value.find((i) => i.id === id)),
          ready: () => items.value.length,
        });
        return () => null;
      },
    });
    mount(Harness);
    await nextTick();
    expect(mockRouter.replace).toHaveBeenCalledWith({ query: { foo: 'bar' } });
  });

  it('does not clear the param if the id never resolves (e.g. deleted item)', async () => {
    mockRoute.query = { activity: 'gone' };
    const { items, opened } = mountWith('activity');
    await nextTick();
    // Store hydrates but the id isn't among the items → stays a no-op, link kept.
    items.value = [{ id: 'something-else' }];
    await nextTick();
    expect(opened).toEqual([]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
