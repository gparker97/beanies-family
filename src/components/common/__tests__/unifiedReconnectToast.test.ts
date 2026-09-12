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

// Keys pass through as-is EXCEPT the notice bodies, which carry `{placeholder}`
// tokens — returning a bare key there would make the interpolation assertions
// vacuous (there is nothing to fill).
const TEMPLATES: Record<string, string> = {
  'reconnectPrompt.calendar.noticeBody':
    'New activities are not reaching Google. Ask {name} to reconnect it.',
  'reconnectPrompt.calendar.noticeBodyAccount':
    'New activities are not reaching Google. Ask whoever manages {account} to reconnect it.',
};

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => TEMPLATES[k] ?? k }),
}));

type Audience =
  { mode: 'owner' } | { mode: 'notice'; owner: Record<string, unknown> } | { mode: 'hidden' };

const holder = vi.hoisted(() => ({
  routeName: 'Dashboard' as string | null,
  prompt: null as { titleKey: string; bodyKey: string; variant: string } | null,
  reconnectAll: vi.fn(),
  audience: { mode: 'owner' } as Audience,
  dismiss: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRoute: () => ({ name: holder.routeName }) }));

vi.mock('@/composables/useReconnectCoordinator', () => ({
  useReconnectCoordinator: () => ({
    // `downFeatures` is read by `useCalendarOutageAudience`; a mock without it
    // breaks every test in this file the moment the component asks for it.
    downFeatures: { value: [] },
    activeReconnectPrompt: { value: holder.prompt },
    reconnectAll: holder.reconnectAll,
    isReconnecting: { value: false },
    reconnectError: { value: null },
  }),
}));

// The audience DECISION is covered exhaustively (and mutation-checked) in
// `utils/calendar/__tests__/connectionOwner.test.ts`. What belongs here is the
// component's own job: which props it hands down for each verdict.
// A real `computed`, not a `{ value }` lookalike: the template reads `audience.mode`
// and relies on Vue unwrapping the ref, which only happens for an actual ref.
vi.mock('@/composables/useCalendarOutageAudience', async () => {
  const { computed } = await import('vue');
  return {
    useCalendarOutageAudience: () => ({
      audience: computed(() => holder.audience),
      dismiss: holder.dismiss,
    }),
  };
});

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({ getMemberName: (id: string) => (id === 'm-mum' ? 'Mum' : 'Someone') }),
}));

function mountToast() {
  return mount(UnifiedReconnectToast, {
    global: {
      stubs: {
        // ⚠️ The stub MUST declare every prop under assertion. It used to take only
        // title/subtitle, so "the bystander gets no reconnect button" would have
        // passed vacuously — there is no <button> in this template at all. The real
        // component's two `v-if`s are pinned in `reconnectToast.test.ts`; here we
        // assert on what gets handed down.
        ReconnectToast: {
          name: 'ReconnectToast',
          props: ['title', 'subtitle', 'reconnectLabel', 'dismissLabel', 'busy'],
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
    holder.audience = { mode: 'owner' };
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

/**
 * The second audience (tracker: targeted reconnect prompt).
 *
 * A revoked grant is true on every member's device at once, and the prompt sits
 * over the mobile tab bar. For a member who never set the integration up, its one
 * button opens a consent screen for an account they don't have — so it was an
 * obstruction with no exit. They now get a dismissable notice naming who to ask.
 */
describe('UnifiedReconnectToast — owner vs bystander', () => {
  const CAL = {
    titleKey: 'reconnectPrompt.calendar.title',
    bodyKey: 'reconnectPrompt.calendar.body',
    variant: 'calendar',
  };

  beforeEach(() => {
    holder.routeName = 'Dashboard';
    holder.prompt = CAL;
    holder.audience = { mode: 'owner' };
    vi.clearAllMocks();
  });

  function toast() {
    return mountToast().findComponent({ name: 'ReconnectToast' });
  }

  it('hands the owner an action and NO dismiss', () => {
    const t = toast();
    expect(t.props('reconnectLabel')).toBe('reconnectPrompt.action');
    expect(t.props('dismissLabel')).toBeUndefined();
    expect(t.props('title')).toBe('reconnectPrompt.calendar.title');
  });

  it('🔴 hands a bystander a dismiss and NO action', () => {
    holder.audience = {
      mode: 'notice',
      owner: { kind: 'member', memberId: 'm-mum', via: 'connected-by' },
    };
    const t = toast();
    expect(t.props('reconnectLabel')).toBeUndefined();
    expect(t.props('dismissLabel')).toBe('action.dismiss');
  });

  it('names the person to ask', () => {
    holder.audience = {
      mode: 'notice',
      owner: { kind: 'member', memberId: 'm-mum', via: 'connected-by' },
    };
    expect(toast().props('subtitle')).toContain('Mum');
  });

  it('names the ACCOUNT when no member resolved', () => {
    holder.audience = {
      mode: 'notice',
      owner: { kind: 'managers', accountEmail: 'mum@gmail.com' },
    };
    expect(toast().props('subtitle')).toContain('mum@gmail.com');
  });

  it("🔴 names NEITHER when the account is the 'unknown' sentinel", () => {
    // Otherwise this reads "ask whoever manages unknown to reconnect it".
    holder.audience = { mode: 'notice', owner: { kind: 'managers', accountEmail: null } };
    const subtitle = toast().props('subtitle') as string;
    expect(subtitle).toBe('reconnectPrompt.calendar.noticeBodyUnknown');
    expect(subtitle).not.toContain('unknown@');
  });

  it('renders nothing at all once dismissed', () => {
    holder.audience = { mode: 'hidden' };
    expect(mountToast().find('.toast').exists()).toBe(false);
  });

  it('forwards the dismiss', async () => {
    holder.audience = { mode: 'notice', owner: { kind: 'managers', accountEmail: null } };
    toast().vm.$emit('dismiss');
    expect(holder.dismiss).toHaveBeenCalledOnce();
  });

  it('🔴 a reconnect ERROR never overwrites the bystander notice', () => {
    // The error is about an action the bystander cannot take; showing it instead
    // of "ask Mum" would leave them with a failure and no next step.
    holder.audience = {
      mode: 'notice',
      owner: { kind: 'member', memberId: 'm-mum', via: 'connected-by' },
    };
    expect(toast().props('subtitle')).toContain('Mum');
  });
});
