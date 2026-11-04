/**
 * `usePublishedHeight` (#141): the one place an element's height becomes a root CSS var
 * and a reactive number.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { publishedHeight, usePublishedHeight } from '@/composables/usePublishedHeight';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

const VAR = '--test-published-h';
const root = document.documentElement;

let offset = 48;
let clientH = 48;

function makeBar(cssVar = VAR) {
  return defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null);
      usePublishedHeight(el, cssVar, 'test-surface');
      return { el };
    },
    render() {
      return h('div', { ref: 'el' }, 'bar');
    },
  });
}

let resizeCb: (() => void) | null = null;
const RealRO = globalThis.ResizeObserver;

beforeEach(() => {
  logEvent.mockClear();
  offset = 48;
  clientH = 48;
  resizeCb = null;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => offset,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => clientH,
  });
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      resizeCb = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  root.style.removeProperty(VAR);
});

afterEach(() => {
  globalThis.ResizeObserver = RealRO;
  vi.restoreAllMocks();
  root.style.removeProperty(VAR);
});

describe('usePublishedHeight', () => {
  it('publishes the offsetHeight on mount, as a CSS var and as a reactive number', async () => {
    const w = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    expect(root.style.getPropertyValue(VAR)).toBe('48px');
    expect(publishedHeight(VAR)).toBe(48);
    w.unmount();
  });

  it('publishes again when the measured height changes', async () => {
    const w = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    offset = 72;
    clientH = 70;
    resizeCb!();
    await nextTick();
    expect(root.style.getPropertyValue(VAR)).toBe('72px');
    expect(publishedHeight(VAR)).toBe(72);
    w.unmount();
  });

  it('publishedHeight() is reactive and 0 when nothing has published', async () => {
    expect(publishedHeight('--never-published')).toBe(0);
    const seen = ref(-1);
    const Reader = defineComponent({
      setup() {
        return () => {
          seen.value = publishedHeight(VAR);
          return h('i');
        };
      },
    });
    const r = mount(Reader);
    expect(seen.value).toBe(0);
    const w = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(seen.value).toBe(48);
    w.unmount();
    r.unmount();
  });

  it('clears the property and the number on unmount', async () => {
    const w = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    w.unmount();
    expect(root.style.getPropertyValue(VAR)).toBe('');
    expect(publishedHeight(VAR)).toBe(0);
  });

  it('a throwing setProperty logs publish_height_failed once per instance, naming the var', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(root.style, 'setProperty').mockImplementation(() => {
      throw new Error('frozen');
    });
    const w = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    offset = 60;
    clientH = 60;
    resizeCb!();
    await nextTick();
    const failures = logEvent.mock.calls.filter(
      ([e]) => (e as { message: string }).message === 'publish_height_failed'
    );
    expect(failures).toHaveLength(1);
    expect(failures[0][0]).toMatchObject({
      level: 'warn',
      surface: 'test-surface',
      context: { action: 'publish_height', detail: VAR },
    });
    spy.mockRestore();
    w.unmount();
  });

  it('overlapping instances: unmounting the older one leaves the newer value in place', async () => {
    const older = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    offset = 80;
    const newer = mount(makeBar(), { attachTo: document.body });
    await nextTick();
    expect(publishedHeight(VAR)).toBe(80);

    older.unmount();
    expect(root.style.getPropertyValue(VAR)).toBe('80px');
    expect(publishedHeight(VAR)).toBe(80);

    newer.unmount();
    expect(root.style.getPropertyValue(VAR)).toBe('');
    expect(publishedHeight(VAR)).toBe(0);
  });
});
