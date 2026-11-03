import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavItemDef } from '@/constants/navigation';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), currentRoute: {} }));
vi.mock('vue-router', () => ({ useRouter: () => router }));
const openFeedback = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useFeedbackModal', () => ({ useFeedbackModal: () => ({ openFeedback }) }));
const openExternal = vi.hoisted(() => vi.fn());
vi.mock('@/utils/openExternal', () => ({ openExternal }));
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock('@/composables/usePlannerToday', () => ({ navigateTo }));

import { useNavSelect } from '@/composables/useNavSelect';

const item = (over: Partial<NavItemDef>): NavItemDef => over as NavItemDef;

describe('useNavSelect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the calendar through navigateTo, so choosing it while on it still lands on today', () => {
    useNavSelect().selectItem(item({ path: '/activities' }));
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(router, '/activities');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sends every other in-app path through navigateTo too', () => {
    useNavSelect().selectItem(item({ path: '/todo' }));
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(router, '/todo');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens an external item in the browser and does not navigate', () => {
    useNavSelect().selectItem(
      item({ path: '/help', external: true, externalUrl: 'https://beanies.family/help' })
    );
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://beanies.family/help');
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('selectFeedback opens the feedback modal from the nav', () => {
    useNavSelect().selectFeedback();
    expect(openFeedback).toHaveBeenCalledExactlyOnceWith('nav');
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
