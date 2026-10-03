/**
 * The quick-add surface the FAB opens in place (#119). First test for this component.
 *
 * The real `useQuickAdd` state machine drives it (only the router singleton is mocked), so the
 * latch, the history marker and the overlay contract are exercised as they run in the app. The
 * door is a stub exposing the inline API: its protocol is covered by `MagicBeansDoor.test.ts`.
 * The funnel denominator assertions that used to live in `MagicReaderCard.test.ts` are here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import type { NavigationFailure, RouteLocationNormalized } from 'vue-router';

const hoisted = vi.hoisted(() => ({
  route: { path: '/dashboard', params: {} as Record<string, string>, query: {} },
  push: vi.fn().mockResolvedValue(undefined),
  replace: vi.fn().mockResolvedValue(undefined),
  removeAfterHook: vi.fn(),
  afterEach: vi.fn(),
  mobile: null as unknown as { value: boolean },
  canReadAny: null as unknown as { value: boolean },
  logEvent: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  door: {
    open: vi.fn(),
    send: vi.fn(),
    camera: vi.fn(),
    file: vi.fn(),
  },
}));

vi.mock('@/router', () => ({
  default: {
    get currentRoute() {
      return { value: hoisted.route };
    },
    push: hoisted.push,
    replace: hoisted.replace,
  },
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ afterEach: hoisted.afterEach }),
}));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  hoisted.mobile = ref(true);
  return { useBreakpoint: () => ({ isMobile: hoisted.mobile }) };
});
vi.mock('@/composables/useMagicReader', async () => {
  const { ref } = await import('vue');
  hoisted.canReadAny = ref(true);
  return { useMagicReader: () => ({ canReadAny: hoisted.canReadAny }) };
});
vi.mock('@/composables/useQuickAddAvailability', () => ({
  useQuickAddAvailability: () => ({ itemAllowedForMember: () => true }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: hoisted.showToast }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => hoisted.logEvent(...a),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => hoisted.reportError(...a),
}));

import QuickAddSheet from '../QuickAddSheet.vue';
import {
  closeQuickAdd,
  openQuickAdd,
  startQuickAddItem,
  useQuickAdd,
  cancelPicker,
} from '@/composables/useQuickAdd';
import {
  __resetEscapeCloseForTests,
  escapeLayerCount,
  hasOpenEscapeLayer,
} from '@/composables/useEscapeClose';
import { hasOpenOverlays, resetOverlayStack } from '@/utils/overlayStack';

/** Stands in for the door: the inline API as spies, and a way to emit `handoff` / `closed`. */
const DoorStub = defineComponent({
  name: 'MagicBeansDoor',
  props: { inline: { type: Boolean, default: false } },
  emits: ['handoff', 'closed'],
  setup(_, { expose }) {
    expose(hoisted.door);
    return () => h('div', { 'data-test': 'door' });
  },
});

const stubs = {
  MagicBeansDoor: DoorStub,
  AllowanceMeter: { name: 'AllowanceMeter', template: '<div />' },
  QuickAddPicker: { name: 'QuickAddPicker', template: '<div data-test="swap-picker" />' },
  QuickAddMemberPicker: {
    name: 'QuickAddMemberPicker',
    template: '<div data-test="member-picker" />',
  },
  teleport: true,
};

let wrapper: VueWrapper | null = null;
function mountSheet() {
  wrapper = mount(QuickAddSheet, { global: { stubs }, attachTo: document.body });
  return wrapper;
}

/** What the FAB tap does, then let the pre-flush watchers and the focus nextTick settle. */
async function fabOpen() {
  openQuickAdd();
  await flushPromises();
  await nextTick();
}

const events = (message: string) =>
  hoisted.logEvent.mock.calls.map((c) => c[0]).filter((e) => e.message === message);

const card = (w: VueWrapper) => w.find('[data-testid="quick-add-sheet"]');
const composer = (w: VueWrapper) => w.find('[data-testid="magic-composer"]');

describe('QuickAddSheet', () => {
  beforeEach(() => {
    hoisted.mobile.value = true;
    hoisted.canReadAny.value = true;
    hoisted.route.path = '/dashboard';
    hoisted.route.params = {};
    hoisted.logEvent.mockReset();
    hoisted.reportError.mockReset();
    hoisted.showToast.mockReset();
    hoisted.removeAfterHook.mockReset();
    hoisted.afterEach.mockReset().mockReturnValue(hoisted.removeAfterHook);
    Object.values(hoisted.door).forEach((fn) => fn.mockReset());
    resetOverlayStack();
    __resetEscapeCloseForTests();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    window.history.replaceState(null, '');
    closeQuickAdd();
    window.history.replaceState(null, '');
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    closeQuickAdd();
  });

  describe('an unscoped FAB open', () => {
    it('shows the composer under the Magic beans header and focuses the field', async () => {
      const w = mountSheet();
      await fabOpen();
      expect(card(w).exists()).toBe(true);
      expect(composer(w).exists()).toBe(true);
      expect(w.find('#quick-add-title').text()).toBe('ai.capture.title');
      expect(w.text()).toContain('ai.capture.taglineShort');
      expect(w.text()).toContain('quickAdd.groups.everyday.byHand');
      expect(document.activeElement).toBe(w.find('[data-testid="magic-composer-field"]').element);
    });

    it('records the funnel denominator once, at the tap, with the composer context', async () => {
      mountSheet();
      await fabOpen();
      expect(hoisted.door.open).toHaveBeenCalledTimes(1);
      expect(hoisted.door.open).toHaveBeenCalledWith({ stage: 'composer', format: 'phone' });
    });

    it('segments the denominator as desktop at 768px and up', async () => {
      hoisted.mobile.value = false;
      mountSheet();
      await fabOpen();
      expect(hoisted.door.open).toHaveBeenCalledWith({ stage: 'composer', format: 'desktop' });
    });

    it('mounts the door outside the surface, in inline mode, even while closed', () => {
      const w = mountSheet();
      const door = w.findComponent({ name: 'MagicBeansDoor' });
      expect(door.exists()).toBe(true);
      expect(door.props('inline')).toBe(true);
      expect(card(w).exists()).toBe(false);
    });
  });

  describe('tiles-only opens', () => {
    it('a scoped open shows the tiles only, under the quick-add title, with no denominator', async () => {
      const w = mountSheet();
      openQuickAdd({ filter: ['add-saying', 'add-milestone'] });
      await flushPromises();
      expect(composer(w).exists()).toBe(false);
      expect(w.find('#quick-add-title').text()).toBe('quickAdd.title');
      expect(hoisted.door.open).not.toHaveBeenCalled();
      expect(w.find('[data-testid="quick-add-item-saying"]').exists()).toBe(true);
      // Forced open: no toggle hiding what the page asked for.
      expect(w.find('[data-testid="quick-add-more"]').exists()).toBe(false);
    });

    it('a member who cannot read gets the tiles only', async () => {
      hoisted.canReadAny.value = false;
      const w = mountSheet();
      await fabOpen();
      expect(composer(w).exists()).toBe(false);
      expect(hoisted.door.open).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(card(w).element);
    });

    it.each([
      ['add-allergy', 'member-picker'],
      ['add-dose-log', 'swap-picker'],
    ])(
      'a startItem(%s) picker open shows no composer, steals no focus, logs no denominator',
      async (action, picker) => {
        const w = mountSheet();
        startQuickAddItem(action as Parameters<typeof startQuickAddItem>[0]);
        await flushPromises();
        await nextTick();
        expect(composer(w).exists()).toBe(false);
        expect(w.find(`[data-test="${picker}"]`).exists()).toBe(true);
        expect(hoisted.door.open).not.toHaveBeenCalled();
        expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
      }
    );
  });

  describe('the latch holds for the whole open', () => {
    it('a member tile after a FAB open keeps the composer and its draft', async () => {
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('half typed');
      await w.find('[data-testid="quick-add-more"] button').trigger('click');
      await w.find('[data-testid="quick-add-item-saying"]').trigger('click');
      await flushPromises();
      expect(w.find('[data-test="member-picker"]').exists()).toBe(true);
      expect(composer(w).exists()).toBe(true);
      expect(
        (w.find('[data-testid="magic-composer-field"]').element as HTMLTextAreaElement).value
      ).toBe('half typed');
    });

    it('the swap picker hides the composer and the draft survives the round-trip', async () => {
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('keep me');
      await w.find('[data-testid="quick-add-item-cook-log"]').trigger('click');
      await flushPromises();
      expect(w.find('[data-test="swap-picker"]').exists()).toBe(true);
      expect(composer(w).isVisible()).toBe(false);
      cancelPicker();
      await flushPromises();
      expect(composer(w).isVisible()).toBe(true);
      expect(
        (w.find('[data-testid="magic-composer-field"]').element as HTMLTextAreaElement).value
      ).toBe('keep me');
    });
  });

  describe('Send, attach and camera go through the door', () => {
    it('Send hands the trimmed text to the door', async () => {
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('  Swim Tue 4pm ');
      await w.find('[data-testid="magic-composer-send"]').trigger('click');
      expect(hoisted.door.send).toHaveBeenCalledWith('Swim Tue 4pm');
    });

    it('attach and camera call the door', async () => {
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-file"]').trigger('click');
      await w.find('[data-testid="magic-composer-camera"]').trigger('click');
      expect(hoisted.door.file).toHaveBeenCalledTimes(1);
      expect(hoisted.door.camera).toHaveBeenCalledTimes(1);
    });

    it('handoff logs `sent` and closes the surface synchronously, with no dismissal', async () => {
      const w = mountSheet();
      const { isOpen } = useQuickAdd();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('text');
      w.findComponent({ name: 'MagicBeansDoor' }).vm.$emit('handoff', 'paste');
      // Synchronous: closed before the door's next line starts the ingest.
      expect(isOpen.value).toBe(false);
      await flushPromises();
      expect(events('composer sent').map((e) => e.context)).toEqual([
        { action: 'sent', kind: 'paste' },
      ]);
      expect(events('composer sent')[0].surface).toBe('quick-add-composer');
      expect(events('composer dismissed')).toHaveLength(0);
      expect(card(w).exists()).toBe(false);
    });

    it('a refusal (`closed`, no handoff) leaves it open with the draft and logs nothing', async () => {
      const w = mountSheet();
      const { isOpen } = useQuickAdd();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('still here');
      hoisted.logEvent.mockReset();
      w.findComponent({ name: 'MagicBeansDoor' }).vm.$emit('closed');
      await flushPromises();
      expect(isOpen.value).toBe(true);
      expect(
        (w.find('[data-testid="magic-composer-field"]').element as HTMLTextAreaElement).value
      ).toBe('still here');
      expect(hoisted.logEvent).not.toHaveBeenCalled();
    });

    it('closing unsent logs `dismissed` with had_text, then empty', async () => {
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('draft');
      await w.find('[data-testid="quick-add-close-x"]').trigger('click');
      await flushPromises();
      await fabOpen();
      closeQuickAdd();
      await flushPromises();
      expect(events('composer dismissed').map((e) => e.context)).toEqual([
        { action: 'dismissed', detail: 'had_text' },
        { action: 'dismissed', detail: 'empty' },
      ]);
    });
  });

  describe('phone vs desktop', () => {
    it('phone: a dim that closes on tap, and the surface blocks the viewport', async () => {
      const w = mountSheet();
      const { isOpen } = useQuickAdd();
      await fabOpen();
      expect(card(w).attributes('aria-modal')).toBe('true');
      expect(hasOpenOverlays()).toBe(true);
      expect(escapeLayerCount()).toBe(1);
      await w.find('[data-testid="quick-add-dim"]').trigger('click');
      expect(isOpen.value).toBe(false);
    });

    it('desktop: no dim, non-modal, but an Escape layer (so isAppQuiet defers)', async () => {
      hoisted.mobile.value = false;
      const w = mountSheet();
      await fabOpen();
      expect(w.find('[data-testid="quick-add-dim"]').exists()).toBe(false);
      expect(card(w).attributes('aria-modal')).toBe('false');
      expect(hasOpenOverlays()).toBe(false);
      expect(hasOpenEscapeLayer()).toBe(true);
      expect(escapeLayerCount()).toBe(1);
    });

    it.each([true, false])('Escape closes it (mobile=%s)', async (mobile) => {
      hoisted.mobile.value = mobile;
      mountSheet();
      const { isOpen } = useQuickAdd();
      await fabOpen();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(isOpen.value).toBe(false);
    });

    it('a scoped re-open while the desktop composer is shown ends that session, tiles only', async () => {
      hoisted.mobile.value = false;
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('typed');
      openQuickAdd({ filter: ['add-saying'] }); // the Scrapbook add, page still usable
      await flushPromises();
      expect(composer(w).exists()).toBe(false);
      expect(w.find('#quick-add-title').text()).toBe('quickAdd.title');
      expect(events('composer dismissed').map((e) => e.context)).toEqual([
        { action: 'dismissed', detail: 'had_text' },
      ]);
    });
  });

  describe('history and navigation', () => {
    type AfterHook = (
      to: RouteLocationNormalized,
      from: RouteLocationNormalized,
      failure?: NavigationFailure
    ) => void;
    /** The close-on-path-change hook the sheet registered with `router.afterEach`. */
    const afterHook = () => hoisted.afterEach.mock.calls[0]?.[0] as AfterHook;
    const loc = (path: string, query: Record<string, string> = {}) =>
      ({ path, fullPath: path, query, hash: '' }) as unknown as RouteLocationNormalized;
    const field = (w: VueWrapper) =>
      w.find('[data-testid="magic-composer-field"]').element as HTMLTextAreaElement;

    afterEach(() => vi.restoreAllMocks());

    it('registers one afterEach hook on mount and removes it on unmount', () => {
      const w = mountSheet();
      expect(hoisted.afterEach).toHaveBeenCalledTimes(1);
      expect(hoisted.removeAfterHook).not.toHaveBeenCalled();
      w.unmount();
      wrapper = null;
      expect(hoisted.removeAfterHook).toHaveBeenCalledTimes(1);
    });

    it.each(['escape', 'x'])(
      'desktop: open pushes no marker and %s closes without history.back()',
      async (how) => {
        hoisted.mobile.value = false;
        const pushSpy = vi.spyOn(window.history, 'pushState');
        const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
        const w = mountSheet();
        const { isOpen } = useQuickAdd();
        await fabOpen();
        expect(pushSpy).not.toHaveBeenCalled();
        if (how === 'escape') {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        } else {
          await w.find('[data-testid="quick-add-close-x"]').trigger('click');
        }
        expect(isOpen.value).toBe(false);
        expect(backSpy).not.toHaveBeenCalled();
      }
    );

    it('phone: open pushes the marker and the back gesture closes it', async () => {
      const pushSpy = vi.spyOn(window.history, 'pushState');
      const w = mountSheet();
      await fabOpen();
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(window.history.state).toMatchObject({ __beanieQuickAddOpen: true });
      window.history.replaceState(null, ''); // Back leaves the marker entry
      window.dispatchEvent(new PopStateEvent('popstate'));
      await flushPromises();
      expect(card(w).exists()).toBe(false);
    });

    it('desktop: a query-only replace from the page behind keeps the card and the draft', async () => {
      hoisted.mobile.value = false;
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('dentist friday 3pm');
      // e.g. a list page writing its filter, or useDeepLinkParam consuming its param.
      afterHook()(loc('/dashboard', { list: 'groceries' }), loc('/dashboard'));
      await flushPromises();
      expect(card(w).exists()).toBe(true);
      expect(field(w).value).toBe('dentist friday 3pm');
      expect(events('composer dismissed')).toEqual([]);
    });

    it('a path change while open closes it', async () => {
      hoisted.mobile.value = false;
      const w = mountSheet();
      await fabOpen();
      afterHook()(loc('/planner'), loc('/dashboard'));
      await flushPromises();
      expect(card(w).exists()).toBe(false);
      expect(events('navigation landed over the history marker')).toEqual([]);
    });

    it('a cancelled navigation (failure set) leaves it open with the draft', async () => {
      hoisted.mobile.value = false;
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="magic-composer-field"]').setValue('keep me');
      const to = loc('/planner');
      const from = loc('/dashboard');
      afterHook()(to, from, { type: 4, to, from } as unknown as NavigationFailure);
      await flushPromises();
      expect(card(w).exists()).toBe(true);
      expect(field(w).value).toBe('keep me');
      expect(events('composer dismissed')).toEqual([]);
    });

    it('phone: a navigation that landed over the marker logs marker_orphaned and still closes', async () => {
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      const w = mountSheet();
      await fabOpen();
      // A navigation started before the open lands after it: its push replaces the current
      // entry's state, so the marker is gone from the entry the user now sits on.
      window.history.replaceState(null, '');
      afterHook()(loc('/planner'), loc('/dashboard'));
      await flushPromises();
      expect(card(w).exists()).toBe(false);
      expect(backSpy).not.toHaveBeenCalled(); // history is not repaired
      expect(events('navigation landed over the history marker')).toEqual([
        expect.objectContaining({
          level: 'warn',
          surface: 'quick-add-composer',
          context: { action: 'marker_orphaned' },
        }),
      ]);
    });
  });

  describe('the disclosure row', () => {
    it('expands Family · Money · Care in place and collapses again', async () => {
      const w = mountSheet();
      await fabOpen();
      expect(w.find('[data-testid="quick-add-item-saying"]').exists()).toBe(false);
      const more = w.find('[data-testid="quick-add-more"]');
      expect(more.text()).toContain(
        'quickAdd.groups.family.title · quickAdd.groups.money.title · quickAdd.groups.care.title'
      );
      await more.find('button').trigger('click');
      expect(w.find('[data-testid="quick-add-item-saying"]').exists()).toBe(true);
      expect(w.find('[data-testid="quick-add-item-goal"]').exists()).toBe(true);
      await w.find('[data-testid="quick-add-more"] button').trigger('click');
      expect(w.find('[data-testid="quick-add-item-saying"]').exists()).toBe(false);
    });

    it('starts collapsed again on the next open', async () => {
      const w = mountSheet();
      await fabOpen();
      await w.find('[data-testid="quick-add-more"] button').trigger('click');
      closeQuickAdd();
      await flushPromises();
      await fabOpen();
      expect(w.find('[data-testid="quick-add-item-saying"]').exists()).toBe(false);
    });

    it('keeps the Everyday tiles and their testids', async () => {
      const w = mountSheet();
      await fabOpen();
      for (const id of ['activity', 'todo', 'transaction', 'trip', 'cook-log']) {
        expect(w.find(`[data-testid="quick-add-item-${id}"]`).exists()).toBe(true);
      }
      expect(w.find('[data-testid="quick-add-close-x"]').exists()).toBe(true);
    });
  });

  describe('keyboard avoidance', () => {
    it('binds --kb-inset from visualViewport and logs `applied` once per open', async () => {
      Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
      const listeners: Array<() => void> = [];
      const vv = {
        height: 800,
        offsetTop: 0,
        scale: 1,
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: () => {},
      };
      Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

      const w = mountSheet();
      await fabOpen();
      vv.height = 460;
      listeners.forEach((fn) => fn());
      await nextTick();
      expect(card(w).attributes('style')).toContain('--kb-inset: 340px');
      vv.height = 450;
      listeners.forEach((fn) => fn());
      await nextTick();
      const kb = events('keyboard avoidance');
      expect(kb).toHaveLength(1);
      expect(kb[0]).toMatchObject({
        surface: 'quick-add-composer',
        context: { action: 'keyboard_avoidance', stage: 'applied' },
      });
      vi.unstubAllGlobals();
    });
  });
});
