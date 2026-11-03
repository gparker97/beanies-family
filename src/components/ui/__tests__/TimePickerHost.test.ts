/**
 * The shell both time pickers share. What it must guarantee:
 *   - under the breakpoint a bottom sheet over a dim that holds the overlay stack; above it a
 *     popover with no scroll lock; both (dim included) at the popover z tier,
 *   - exactly one Escape layer in each shape,
 *   - the dim and any outside click close through the one outside-click handler,
 *   - `open(el)` while open re-anchors without a second `open` log,
 *   - call-site attributes fall through to the single root,
 *   - unmounting while open leaves the overlay and Escape stacks empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick } from 'vue';

const hoisted = vi.hoisted(() => ({
  mobile: null as unknown as { value: boolean },
  logEvent: vi.fn(),
}));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  hoisted.mobile = ref(false);
  return { useBreakpoint: () => ({ isMobile: hoisted.mobile }) };
});
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => hoisted.logEvent(...a),
}));

import TimePickerHost from '../TimePickerHost.vue';
import { ANCHORED_POPOVER_Z_INDEX } from '@/composables/useAnchoredPopover';
import { __resetEscapeCloseForTests, escapeLayerCount } from '@/composables/useEscapeClose';
import { hasOpenOverlays, resetOverlayStack } from '@/utils/overlayStack';

type HostApi = { open: (el: HTMLElement) => void; close: () => void; isOpen: boolean };

function rectAt(el: HTMLElement, left: number, top = 100): void {
  const r = {
    top,
    bottom: top + 30,
    left,
    right: left + 90,
    width: 90,
    height: 30,
    x: left,
    y: top,
  };
  el.getBoundingClientRect = () => ({ ...r, toJSON: () => r }) as DOMRect;
}

let wrapper: VueWrapper | null = null;

function mountHost(attrs: Record<string, string> = {}) {
  wrapper = mount(TimePickerHost, {
    attachTo: document.body,
    props: { title: 'Start Time', subtitle: '4:15pm' },
    attrs,
    slots: {
      default: (p: { open: (el: HTMLElement) => void }) =>
        h('button', {
          'data-testid': 'pill',
          onClick: (e: MouseEvent) => p.open(e.currentTarget as HTMLElement),
        }),
      panel: () => h('div', { 'data-testid': 'panel-body' }, [h('button', { id: 'inside' })]),
    },
  });
  return wrapper;
}

async function openHost(w: VueWrapper) {
  await w.find('[data-testid="pill"]').trigger('click');
  await nextTick();
  await nextTick();
}

const card = () => document.querySelector<HTMLElement>('[data-testid="time-picker-card"]');
const dim = () => document.querySelector<HTMLElement>('[data-testid="time-picker-dim"]');
const openLogs = () =>
  hoisted.logEvent.mock.calls.filter(
    ([e]) => (e as { context?: { action?: string } }).context?.action === 'open'
  );

beforeEach(() => {
  hoisted.mobile.value = false;
  hoisted.logEvent.mockReset();
  resetOverlayStack();
  __resetEscapeCloseForTests();
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  resetOverlayStack();
  __resetEscapeCloseForTests();
  document.body.innerHTML = '';
});

describe('TimePickerHost: phone sheet', () => {
  beforeEach(() => {
    hoisted.mobile.value = true;
  });

  it('opens a sheet over a dim, both at the popover tier, holding the overlay stack', async () => {
    const w = mountHost();
    await openHost(w);
    expect(card()).not.toBeNull();
    expect(card()!.getAttribute('role')).toBe('dialog');
    expect(card()!.getAttribute('aria-modal')).toBe('true');
    expect(card()!.getAttribute('aria-label')).toBe('Start Time');
    expect(card()!.textContent).toContain('4:15pm');
    expect(card()!.style.zIndex).toBe(String(ANCHORED_POPOVER_Z_INDEX));
    expect(card()!.style.bottom).toBe('0px');
    expect(dim()!.style.zIndex).toBe(String(ANCHORED_POPOVER_Z_INDEX));
    expect(hasOpenOverlays()).toBe(true);
    expect(escapeLayerCount()).toBe(1);
    expect(document.activeElement).toBe(card());
    expect(openLogs()).toHaveLength(1);
    expect(openLogs()[0]![0]).toMatchObject({
      level: 'debug',
      surface: 'time-picker',
      context: { action: 'open', kind: 'sheet' },
    });
  });

  it('closes when the dim is tapped (through the outside-click handler)', async () => {
    const w = mountHost();
    await openHost(w);
    dim()!.click();
    await nextTick();
    expect(card()).toBeNull();
    expect(hasOpenOverlays()).toBe(false);
    expect(escapeLayerCount()).toBe(0);
  });

  it('closes on Escape', async () => {
    const w = mountHost();
    await openHost(w);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(card()).toBeNull();
  });

  it('leaves both stacks empty when unmounted while open', async () => {
    const w = mountHost();
    await openHost(w);
    expect(hasOpenOverlays()).toBe(true);
    w.unmount();
    wrapper = null;
    expect(hasOpenOverlays()).toBe(false);
    expect(escapeLayerCount()).toBe(0);
    expect(card()).toBeNull();
  });
});

describe('TimePickerHost: desktop popover', () => {
  it('opens a fixed popover at the popover tier, without a dim or scroll lock', async () => {
    const w = mountHost();
    rectAt(w.find('[data-testid="pill"]').element as HTMLElement, 40);
    await openHost(w);
    expect(card()!.style.position).toBe('fixed');
    expect(card()!.style.zIndex).toBe(String(ANCHORED_POPOVER_Z_INDEX));
    expect(card()!.style.left).toBe('40px');
    expect(card()!.hasAttribute('aria-modal')).toBe(false);
    expect(dim()).toBeNull();
    expect(hasOpenOverlays()).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(escapeLayerCount()).toBe(1);
    expect(openLogs()[0]![0]).toMatchObject({ context: { action: 'open', kind: 'popover' } });
  });

  it('closes on an outside click, but not on a click inside the card or the root', async () => {
    const w = mountHost();
    await openHost(w);
    document.getElementById('inside')!.click();
    await nextTick();
    expect(card()).not.toBeNull();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.click();
    await nextTick();
    expect(card()).toBeNull();
    expect(escapeLayerCount()).toBe(0);
  });

  it('leaves focus on a field the outside click moved it to', async () => {
    const w = mountHost();
    const pill = w.find('[data-testid="pill"]').element as HTMLElement;
    pill.focus();
    await openHost(w);
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus(); // the mousedown on the field focuses it before the click closes the picker
    field.click();
    await nextTick();
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('returns focus to the pill when the picker closes with focus inside it', async () => {
    const w = mountHost();
    const pill = w.find('[data-testid="pill"]').element as HTMLElement;
    pill.focus();
    await openHost(w);
    document.getElementById('inside')!.focus();
    (w.vm as unknown as HostApi).close();
    await nextTick();
    expect(document.activeElement).toBe(pill);
  });

  it('re-anchors on open(el) while open, without closing or logging a second open', async () => {
    const w = mountHost();
    rectAt(w.find('[data-testid="pill"]').element as HTMLElement, 40);
    await openHost(w);
    const other = document.createElement('button');
    rectAt(other, 300);
    document.body.appendChild(other);
    (w.vm as unknown as HostApi).open(other);
    await nextTick();
    await nextTick();
    expect(card()).not.toBeNull();
    expect(card()!.style.left).toBe('300px');
    expect(openLogs()).toHaveLength(1);
    expect(escapeLayerCount()).toBe(1);
  });

  it('passes call-site attributes through to its single root', () => {
    const w = mountHost({ class: 'min-w-0 flex-1', 'data-testid': 'magic-todo-time' });
    expect(w.classes()).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
    expect(w.attributes('data-testid')).toBe('magic-todo-time');
  });

  it('leaves the Escape stack empty when unmounted while open', async () => {
    const w = mountHost();
    await openHost(w);
    w.unmount();
    wrapper = null;
    expect(escapeLayerCount()).toBe(0);
    expect(card()).toBeNull();
  });
});
