/**
 * The FAB-anchored surface's overlay contract (#119): viewport-blocking on phones, non-modal on
 * desktop, keyboard-aware on both.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const h = vi.hoisted(() => ({ mobile: null as unknown as { value: boolean } }));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref: vueRef } = await import('vue');
  h.mobile = vueRef(true);
  return { useBreakpoint: () => ({ isMobile: h.mobile }) };
});

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { useAnchoredOverlay } from '../useAnchoredOverlay';
import {
  __resetEscapeCloseForTests,
  escapeLayerCount,
  hasOpenEscapeLayer,
} from '@/composables/useEscapeClose';
import { hasOpenOverlays, resetOverlayStack } from '@/utils/overlayStack';

function setup(initiallyOpen = false) {
  const isOpen = ref(initiallyOpen);
  const close = vi.fn(() => {
    isOpen.value = false;
  });
  const scope = effectScope();
  const api = scope.run(() => useAnchoredOverlay(isOpen, close, { surface: 'test-surface' }))!;
  return { isOpen, close, scope, api };
}

describe('useAnchoredOverlay', () => {
  beforeEach(() => {
    h.mobile.value = true;
    logEvent.mockReset();
    resetOverlayStack();
    __resetEscapeCloseForTests();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });
  afterEach(() => {
    resetOverlayStack();
    __resetEscapeCloseForTests();
  });

  it('phone: blocks the viewport (overlay stack + scroll lock) and registers Escape once', async () => {
    const { isOpen, scope } = setup();
    isOpen.value = true;
    await nextTick();
    expect(hasOpenOverlays()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(escapeLayerCount()).toBe(1);
    scope.stop();
  });

  it('desktop: non-modal (no overlay registration, no scroll lock) but an Escape layer', async () => {
    h.mobile.value = false;
    const { isOpen, scope } = setup();
    isOpen.value = true;
    await nextTick();
    expect(hasOpenOverlays()).toBe(false);
    expect(document.body.style.overflow).toBe('');
    // isAppQuiet() sees the desktop card through this.
    expect(hasOpenEscapeLayer()).toBe(true);
    expect(escapeLayerCount()).toBe(1);
    scope.stop();
  });

  it('hands the Escape registration across a breakpoint change while open', async () => {
    const { isOpen, scope } = setup();
    isOpen.value = true;
    await nextTick();
    h.mobile.value = false;
    await nextTick();
    expect(escapeLayerCount()).toBe(1);
    expect(hasOpenOverlays()).toBe(false);
    scope.stop();
  });

  it('Escape closes it in either mode', async () => {
    for (const mobile of [true, false]) {
      h.mobile.value = mobile;
      const { isOpen, close, scope } = setup();
      isOpen.value = true;
      await nextTick();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(close).toHaveBeenCalledTimes(1);
      await nextTick();
      scope.stop();
    }
  });

  it('releases everything on close', async () => {
    const { isOpen, scope } = setup();
    isOpen.value = true;
    await nextTick();
    isOpen.value = false;
    await nextTick();
    expect(hasOpenOverlays()).toBe(false);
    expect(hasOpenEscapeLayer()).toBe(false);
    scope.stop();
  });

  it('restores focus to the element that had it at open (the FAB), if still connected', async () => {
    const fab = document.createElement('button');
    document.body.appendChild(fab);
    fab.focus();
    const { isOpen, scope } = setup();
    isOpen.value = true;
    await nextTick();

    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();
    isOpen.value = false;
    await nextTick();
    expect(document.activeElement).toBe(fab);
    fab.remove();
    field.remove();
    scope.stop();
  });

  it('logs keyboard avoidance `unsupported` once per phone open without visualViewport', async () => {
    const { isOpen, scope } = setup();
    isOpen.value = true;
    await nextTick();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0]).toMatchObject({
      surface: 'test-surface',
      message: 'keyboard avoidance',
      context: { action: 'keyboard_avoidance', stage: 'unsupported' },
    });
    scope.stop();
  });

  it('logs keyboard avoidance `applied` once when the inset first crosses the threshold', async () => {
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

    const { isOpen, scope, api } = setup();
    isOpen.value = true;
    await nextTick();
    expect(logEvent).not.toHaveBeenCalled(); // toolbar wobble is not a keyboard

    vv.height = 480;
    listeners.forEach((fn) => fn());
    await nextTick();
    expect(api.inset.value).toBe(320);
    vv.height = 470;
    listeners.forEach((fn) => fn());
    await nextTick();

    const kb = logEvent.mock.calls.filter((c) => c[0].message === 'keyboard avoidance');
    expect(kb).toHaveLength(1);
    expect(kb[0][0].context).toMatchObject({ action: 'keyboard_avoidance', stage: 'applied' });
    expect(kb[0][0].context.viewport_w).toEqual(expect.any(Number));
    expect(kb[0][0].context.viewport_h).toBe(800);
    vi.unstubAllGlobals();
    scope.stop();
  });

  it('the CSS anchor breakpoint and useBreakpoint MOBILE_QUERY agree (768 / 767)', () => {
    // CSS cannot read TS, so the one breakpoint exists twice; this pins them together.
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const css = read('../../style.css');
    const ts = read('../useBreakpoint.ts');
    const media = css.match(
      /@media \(width >= (\d+)px\) \{\s*:root \{\s*--fab-anchor-bottom:[^}]*--fab-anchor-side:[^}]*\}/
    );
    expect(media).not.toBeNull();
    const mobileMax = ts.match(/const MOBILE_QUERY = '\(max-width: (\d+)px\)'/);
    expect(mobileMax).not.toBeNull();
    expect(Number(media![1])).toBe(Number(mobileMax![1]) + 1);
  });
});
