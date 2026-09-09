/**
 * The reconnect prompt must not follow a VISITOR onto a public page.
 *
 * ⚠️ WHY THIS FILE EXISTS. Someone opening a shared-recipe link has no Google
 * connection of ours to repair, and `/recipe` is `noChrome`, so the in-layout
 * `PodAccessBanner` cannot render there at all — this always-mounted toast is
 * the surface that reached them, and it did.
 *
 * The tests pin the SHAPE of the fix as much as the fix: the suppression is
 * display-only, so `activeReconnectPrompt` (which `reconnectAll` reads to label
 * its telemetry) is untouched, and the prompt returns the moment the user is on
 * a real app route.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UnifiedReconnectToast from '@/components/common/UnifiedReconnectToast.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const holder = vi.hoisted(() => ({
  routeName: 'Dashboard' as string | null,
  prompt: null as { titleKey: string; bodyKey: string; variant: string } | null,
  reconnectAll: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRoute: () => ({ name: holder.routeName }) }));

vi.mock('@/composables/useReconnectCoordinator', () => ({
  useReconnectCoordinator: () => ({
    activeReconnectPrompt: { value: holder.prompt },
    reconnectAll: holder.reconnectAll,
    isReconnecting: { value: false },
    reconnectError: { value: null },
  }),
}));

function mountToast() {
  return mount(UnifiedReconnectToast, {
    global: {
      stubs: {
        ReconnectToast: {
          props: ['title', 'subtitle'],
          template: '<div class="toast">{{ title }}|{{ subtitle }}</div>',
        },
      },
    },
  });
}

const PROMPT = {
  titleKey: 'reconnectPrompt.drive.title',
  bodyKey: 'reconnectPrompt.drive.body',
  variant: 'drive',
};

describe('UnifiedReconnectToast — suppressed on external landing routes', () => {
  beforeEach(() => {
    holder.routeName = 'Dashboard';
    holder.prompt = null;
    vi.clearAllMocks();
  });

  it('shows the prompt on an ordinary app route', () => {
    holder.prompt = PROMPT;
    expect(mountToast().text()).toContain('reconnectPrompt.drive.title');
  });

  it('stays silent on SharedRecipe — a visitor has nothing of ours to reconnect', () => {
    holder.prompt = PROMPT;
    holder.routeName = 'SharedRecipe';
    expect(mountToast().find('.toast').exists()).toBe(false);
  });

  it('stays silent on ShareTarget', () => {
    holder.prompt = PROMPT;
    holder.routeName = 'ShareTarget';
    expect(mountToast().find('.toast').exists()).toBe(false);
  });

  it('STILL shows on Login and OpenFromDrive, where reconnecting is the point', () => {
    // The broader `isPublicEntryRoute` covers these two as well. Using it would
    // hide the prompt exactly where the user is trying to reach their pod —
    // a dead end built by a safety feature.
    holder.prompt = PROMPT;
    for (const name of ['Login', 'OpenFromDrive']) {
      holder.routeName = name;
      expect(mountToast().find('.toast').exists()).toBe(true);
    }
  });

  it('is a SUPPRESSION, not a cancellation — the prompt returns on navigation', () => {
    holder.prompt = PROMPT;
    holder.routeName = 'SharedRecipe';
    expect(mountToast().find('.toast').exists()).toBe(false);

    holder.routeName = 'Dashboard';
    expect(mountToast().find('.toast').exists()).toBe(true);
  });

  it('renders nothing when there is no prompt at all', () => {
    expect(mountToast().find('.toast').exists()).toBe(false);
  });
});
