/**
 * Keyboard avoidance (#119): how far the on-screen keyboard overlaps the layout viewport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { KEYBOARD_INSET_MIN_PX, useVisualViewportInset } from '../useVisualViewportInset';

type Listener = () => void;

/** A minimal `visualViewport`: settable geometry plus a listener registry we can fire. */
function fakeViewport(init: { height: number; offsetTop?: number; scale?: number }) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    height: init.height,
    offsetTop: init.offsetTop ?? 0,
    scale: init.scale ?? 1,
    addEventListener: vi.fn((type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    }),
    fire(type: string) {
      listeners.get(type)?.forEach((fn) => fn());
    },
    count() {
      let n = 0;
      listeners.forEach((set) => (n += set.size));
      return n;
    },
  };
}

let frames: FrameRequestCallback[] = [];
function flushFrames() {
  const queued = frames;
  frames = [];
  queued.forEach((cb) => cb(0));
}

function install(vv: unknown) {
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
}

describe('useVisualViewportInset', () => {
  beforeEach(() => {
    logEvent.mockReset();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    install(undefined);
  });

  it('names its keyboard threshold for hosts', () => {
    expect(KEYBOARD_INSET_MIN_PX).toBe(120);
  });

  it('is unsupported, with inset 0, when there is no visualViewport', () => {
    install(undefined);
    const scope = effectScope();
    const r = scope.run(() => useVisualViewportInset(ref(true), { surface: 's' }))!;
    expect(r.supported).toBe(false);
    expect(r.inset.value).toBe(0);
    scope.stop();
  });

  it('measures once on activation and recomputes on resize and scroll (rAF-throttled)', async () => {
    const vv = fakeViewport({ height: 800 });
    install(vv);
    const active = ref(false);
    const scope = effectScope();
    const r = scope.run(() => useVisualViewportInset(active, { surface: 's' }))!;
    expect(r.supported).toBe(true);
    expect(vv.count()).toBe(0);

    vv.height = 500; // keyboard already up when the surface opens
    active.value = true;
    await nextTick();
    expect(r.inset.value).toBe(300);

    vv.height = 460;
    vv.fire('resize');
    vv.fire('resize');
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(r.inset.value).toBe(340);

    vv.height = 480;
    vv.offsetTop = 20;
    vv.fire('scroll');
    flushFrames();
    expect(r.inset.value).toBe(300);
    scope.stop();
  });

  it('reads 0 while pinch-zoomed, however small the visual viewport', async () => {
    const vv = fakeViewport({ height: 400, scale: 2 });
    install(vv);
    const scope = effectScope();
    const r = scope.run(() => useVisualViewportInset(ref(true), { surface: 's' }))!;
    await nextTick();
    expect(r.inset.value).toBe(0);
    scope.stop();
  });

  it('detaches and resets to 0 when deactivated', async () => {
    const vv = fakeViewport({ height: 500 });
    install(vv);
    const active = ref(true);
    const scope = effectScope();
    const r = scope.run(() => useVisualViewportInset(active, { surface: 's' }))!;
    await nextTick();
    expect(r.inset.value).toBe(300);
    expect(vv.count()).toBe(2);

    active.value = false;
    await nextTick();
    expect(r.inset.value).toBe(0);
    expect(vv.count()).toBe(0);
    scope.stop();
  });

  it('cleans up on scope dispose while still active', async () => {
    const vv = fakeViewport({ height: 500 });
    install(vv);
    const scope = effectScope();
    scope.run(() => useVisualViewportInset(ref(true), { surface: 's' }));
    await nextTick();
    expect(vv.count()).toBe(2);
    scope.stop();
    expect(vv.count()).toBe(0);
  });

  it('logs and degrades to 0 when the listener cannot attach', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vv = fakeViewport({ height: 500 });
    vv.addEventListener.mockImplementation(() => {
      throw new Error('sandboxed');
    });
    install(vv);
    const scope = effectScope();
    const r = scope.run(() =>
      useVisualViewportInset(ref(true), { surface: 'quick-add-composer' })
    )!;
    await nextTick();
    expect(r.inset.value).toBe(0);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'quick-add-composer',
        context: { action: 'viewport_listen_failed' },
      })
    );
    expect(warn).toHaveBeenCalled();
    scope.stop();
    warn.mockRestore();
  });
});
