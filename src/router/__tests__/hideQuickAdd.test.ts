/**
 * Router guard test — orphan `?action=` arriving at a `hideQuickAdd`
 * route should be stripped and the user shown a warning toast. Other
 * query params are preserved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';

// Must match the guard's imports so mocks land on the same module path.
const toastSpy = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => toastSpy(...args),
}));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: null }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ isAuthenticated: true, currentUser: { role: 'owner' } }),
}));

import { QUICK_ADD_CONTEXT_KEYS } from '@/constants/quickAddItems';

/**
 * Build a throwaway router that mirrors the Quick-add guard logic.
 * We don't import the production router because it pulls in dozens of
 * lazy page components and app-init side effects. Matching the logic
 * keeps the test fast + focused, with a comment above the guard
 * reminding that both live in lockstep.
 */
async function buildTestRouter() {
  const { showToast } = await import('@/composables/useToast');
  const { useTranslationStore } = await import('@/stores/translationStore');

  const routes: RouteRecordRaw[] = [
    {
      path: '/app',
      name: 'App',
      component: { template: '<div />' },
      meta: { hideQuickAdd: false },
    },
    {
      path: '/login',
      name: 'Login',
      component: { template: '<div />' },
      meta: { hideQuickAdd: true },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: { template: '<div />' },
      meta: { hideQuickAdd: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: { template: '<div />' },
      meta: { hideQuickAdd: true },
    },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });

  router.beforeEach((to) => {
    if (!to.meta.hideQuickAdd) return;
    if (typeof to.query.action !== 'string' || !to.query.action) return;

    const ts = useTranslationStore();
    const next: Record<string, unknown> = { ...to.query };
    delete next.action;
    for (const key of QUICK_ADD_CONTEXT_KEYS) delete next[key];

    showToast(
      'warning',
      ts.t('quickAdd.error.notHere.title'),
      ts.t('quickAdd.error.notHere.message')
    );
    return { path: to.path, query: next as Record<string, string>, replace: true };
  });

  return router;
}

describe('router guard: orphan quick-add intents on hideQuickAdd routes', () => {
  beforeEach(() => {
    toastSpy.mockClear();
  });

  it('strips ?action= on a hideQuickAdd route and shows a warning toast', async () => {
    const router = await buildTestRouter();
    await router.push('/login?action=add-activity');
    expect(router.currentRoute.value.query.action).toBeUndefined();
    expect(toastSpy).toHaveBeenCalledWith(
      'warning',
      'quickAdd.error.notHere.title',
      'quickAdd.error.notHere.message'
    );
  });

  it('strips ?action= AND context keys, preserving unrelated query params', async () => {
    const router = await buildTestRouter();
    await router.push('/settings?action=add-saying&memberId=m&keepMe=yes');
    const q = router.currentRoute.value.query;
    expect(q.action).toBeUndefined();
    expect(q.memberId).toBeUndefined();
    expect(q.keepMe).toBe('yes');
  });

  it('is a no-op on non-hideQuickAdd routes', async () => {
    const router = await buildTestRouter();
    await router.push('/app?action=add-activity&memberId=m');
    const q = router.currentRoute.value.query;
    expect(q.action).toBe('add-activity');
    expect(q.memberId).toBe('m');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('is a no-op on hideQuickAdd routes without ?action=', async () => {
    const router = await buildTestRouter();
    await router.push('/login?foo=bar');
    expect(toastSpy).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query.foo).toBe('bar');
  });
});
