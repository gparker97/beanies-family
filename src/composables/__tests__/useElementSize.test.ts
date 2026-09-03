/**
 * The one guarded ResizeObserver.
 *
 * Both hand-rolled observers this replaces had the same latent bug: a throw out
 * of the callback kills the observer permanently and silently.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { useElementSize } from '@/composables/useElementSize';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

const RealResizeObserver = globalThis.ResizeObserver;

function harness(size = 240) {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => size,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => size * 2,
  });
  const seen: { width: number; height: number } = { width: 0, height: 0 };
  const Comp = defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null);
      const { width, height, measure } = useElementSize(el, { surface: 'test-surface' });
      return { el, width, height, measure, seen };
    },
    render() {
      seen.width = this.width;
      seen.height = this.height;
      return h('div', { ref: 'el' }, 'x');
    },
  });
  return { Comp, seen };
}

beforeEach(() => {
  logEvent.mockClear();
  globalThis.ResizeObserver = RealResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
});

describe('useElementSize', () => {
  it('measures the element on mount', async () => {
    const { Comp, seen } = harness(240);
    mount(Comp, { attachTo: document.body });
    await nextTick();
    expect(seen.height).toBe(240);
    expect(seen.width).toBe(480);
  });

  it('⭐ falls back and says so when ResizeObserver is unavailable', async () => {
    // An old iPad is the exact device this feature is built for. A silent
    // fallback would mean a stale layout nobody could diagnose.
    // @ts-expect-error — deliberately removing the global for this test
    delete globalThis.ResizeObserver;
    const { Comp, seen } = harness(300);
    mount(Comp, { attachTo: document.body });
    await nextTick();
    expect(seen.height).toBe(300);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'test-surface',
        message: 'element_size_unobservable',
      })
    );
  });

  it('⭐ survives a throw inside the OBSERVER CALLBACK, not just in measure()', async () => {
    // ⚠️ The earlier version of this test called the exposed `measure()`, whose
    // own try/catch swallows the throw — so deleting the guard INSIDE the
    // observer callback (the documented CalendarCommandBar lesson, and the whole
    // reason this composable exists) left it passing. happy-dom never fires a
    // real observer callback, so the guard had zero coverage. Capture the
    // callback and invoke it directly.
    let fire: (() => void) | null = null;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    const { Comp } = harness(200);
    mount(Comp, { attachTo: document.body });
    await nextTick();
    expect(fire).toBeTypeOf('function');

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        throw new Error('detached');
      },
    });
    // An uncaught throw out of a ResizeObserver callback kills the observer
    // permanently and silently — the element then never resizes again.
    expect(() => fire!()).not.toThrow();
  });

  it('disconnects on unmount', async () => {
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {
        disconnect();
      }
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const { Comp } = harness(150);
    const wrapper = mount(Comp, { attachTo: document.body });
    await nextTick();
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
