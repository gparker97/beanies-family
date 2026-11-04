/**
 * `useMonthGridFit` (#141): the viewport fit for the month grid's six rows.
 *
 * happy-dom has no layout, so geometry is faked per element through a `data-role`
 * attribute on the prototype getters, and the captured ResizeObserver callbacks are fired
 * by hand (happy-dom never fires one). The point is the arithmetic, the convergence
 * invariant and the failure paths, not a browser's layout.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { useMonthGridFit, type MonthGridFit } from '@/composables/useMonthGridFit';

const settings = reactive({ textSize: 'normal' as 'normal' | 'large' });
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

interface Geom {
  mainClientH: number;
  mainTop: number;
  scrollTop: number;
  cardTop: number;
  bodyTop: number;
  parentClientH: number;
  hidden: boolean;
}
const geom: Geom = {} as Geom;
function resetGeom(): void {
  Object.assign(geom, {
    mainClientH: 940,
    mainTop: 0,
    scrollTop: 0,
    cardTop: 100,
    bodyTop: 140,
    parentClientH: 700,
    hidden: false,
  } satisfies Geom);
}

const observers: Array<() => void> = [];
const fireObservers = () => observers.forEach((cb) => cb());

const RealRO = globalThis.ResizeObserver;
const proto = HTMLElement.prototype;
const realRect = proto.getBoundingClientRect;

const reserve = ref(0);
let minRow = 90;
const minRowPx = vi.fn((rem: number) => (rem === 19 ? 108 : minRow));

type Mounted = { wrapper: VueWrapper; fit: MonthGridFit };

function mountFit(opts: { withMain?: boolean; format?: 'desktop' | 'phone' } = {}): Mounted {
  const host = document.createElement(opts.withMain === false ? 'div' : 'main');
  host.style.paddingBottom = '24px';
  host.dataset.role = 'main';
  document.body.appendChild(host);
  let fit!: MonthGridFit;
  const Comp = defineComponent({
    setup() {
      const card = ref<HTMLElement | null>(null);
      const body = ref<HTMLElement | null>(null);
      fit = useMonthGridFit(card, body, {
        format: opts.format ?? 'desktop',
        reservePx: () => reserve.value,
        minRowPx,
      });
      return { card, body };
    },
    render() {
      return h('div', { 'data-role': 'parent' }, [
        h('section', { ref: 'card', 'data-role': 'card' }, [
          h('div', { ref: 'body', 'data-role': 'body' }),
        ]),
      ]);
    },
  });
  const wrapper = mount(Comp, { attachTo: host });
  return { wrapper, fit };
}

beforeEach(() => {
  resetGeom();
  reserve.value = 0;
  minRow = 90;
  reportError.mockClear();
  minRowPx.mockClear();
  settings.textSize = 'normal';
  observers.length = 0;
  document.documentElement.style.fontSize = '';
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      observers.push(cb);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const role = this.dataset.role;
      return role === 'main' ? geom.mainClientH : role === 'parent' ? geom.parentClientH : 0;
    },
  });
  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get: () => geom.scrollTop,
    set: () => {},
  });
  Object.defineProperty(proto, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.role === 'card' && geom.hidden ? null : document.body;
    },
  });
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const role = this.dataset.role;
    const top =
      role === 'main'
        ? geom.mainTop
        : role === 'card'
          ? geom.cardTop
          : role === 'body'
            ? geom.bodyTop
            : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  };
});

afterEach(() => {
  globalThis.ResizeObserver = RealRO;
  proto.getBoundingClientRect = realRect;
  document.body.innerHTML = '';
  document.documentElement.style.fontSize = '';
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

describe('useMonthGridFit', () => {
  it('floors the available height over six rows to whole pixels', async () => {
    const { fit, wrapper } = mountFit();
    await settle();
    // 940 - (100 - 0 + 0) - 0 reserve - (140 - 100) header = 800; 800 / 6 = 133.33
    expect(fit.rowPx.value).toBe(133);
    expect(Number.isInteger(fit.rowPx.value)).toBe(true);
    expect(fit.degraded.value).toBe(false);
    // The scroller's bottom padding (24px) is how far the card may bleed.
    expect(fit.bleedPx.value).toBe(24);
    wrapper.unmount();
  });

  it('subtracts the reserve, and the bleed shrinks by it (the phone tab bar)', async () => {
    reserve.value = 24;
    const { fit, wrapper } = mountFit({ format: 'phone' });
    await settle();
    // 940 - 100 - 24 - 40 = 776 -> 129
    expect(fit.rowPx.value).toBe(129);
    expect(fit.bleedPx.value).toBe(0);
    wrapper.unmount();
  });

  it('adds the scroller scrollTop to the card offset', async () => {
    geom.scrollTop = 60;
    const { fit, wrapper } = mountFit();
    await settle();
    // top = 100 - 0 + 60 = 160; 940 - 160 - 40 = 740 -> 123
    expect(fit.rowPx.value).toBe(123);
    wrapper.unmount();
  });

  it('never goes below the minimum: degraded, rows at ceil(min), the page scrolls', async () => {
    geom.mainClientH = 400;
    minRow = 89.2;
    const { fit, wrapper } = mountFit();
    await settle();
    // 400 - 100 - 40 = 260 -> 43, under the 89.2 floor
    expect(fit.rowPx.value).toBe(90);
    expect(fit.degraded.value).toBe(true);
    wrapper.unmount();
  });

  it('reads the root font size and hands it to minRowPx', async () => {
    document.documentElement.style.fontSize = '19px';
    const { fit, wrapper } = mountFit();
    await settle();
    expect(fit.remPx.value).toBe(19);
    expect(minRowPx).toHaveBeenCalledWith(19);
    wrapper.unmount();
  });

  it('CONVERGENCE: a taller parent (a day row inserted) leaves rowPx unchanged', async () => {
    const { fit, wrapper } = mountFit();
    await settle();
    const before = fit.rowPx.value;
    geom.parentClientH = 1100; // the phone day row added content; scroller and offsets did not move
    fireObservers();
    await settle();
    expect(fit.rowPx.value).toBe(before);
    expect(reportError).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('re-measures when the scroller height changes (a window resize)', async () => {
    const { fit, wrapper } = mountFit();
    await settle();
    geom.mainClientH = 1060; // +120 -> 920 / 6 = 153
    fireObservers();
    await settle();
    expect(fit.rowPx.value).toBe(153);
    wrapper.unmount();
  });

  it('a hidden card keeps the last value and emits nothing', async () => {
    const { fit, wrapper } = mountFit();
    await settle();
    expect(fit.rowPx.value).toBe(133);
    geom.hidden = true;
    geom.mainClientH = 0;
    geom.cardTop = 0;
    geom.bodyTop = 0;
    fireObservers();
    await settle();
    expect(fit.rowPx.value).toBe(133);
    expect(reportError).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('a textSize flip re-measures', async () => {
    const { fit, wrapper } = mountFit();
    await settle();
    expect(fit.rowPx.value).toBe(133);
    // Large mode moves the header: no observer fires, only the setting changes.
    geom.bodyTop = 160;
    settings.textSize = 'large';
    await settle();
    // 940 - 100 - 60 = 780 -> 130
    expect(fit.rowPx.value).toBe(130);
    wrapper.unmount();
  });

  it('re-measures when the reserve changes', async () => {
    const { fit, wrapper } = mountFit({ format: 'phone' });
    await settle();
    expect(fit.rowPx.value).toBe(133);
    reserve.value = 60; // reactive, as `publishedHeight('--mobile-nav-h')` is in the page
    await settle();
    expect(fit.rowPx.value).toBe(123); // (940 - 100 - 60 - 40) / 6 = 123.33
    wrapper.unmount();
  });

  it('no scroller: rowPx null and fit_measure_failed once, however often it re-measures', async () => {
    const { fit, wrapper } = mountFit({ withMain: false, format: 'phone' });
    await settle();
    expect(fit.rowPx.value).toBeNull();
    expect(fit.degraded.value).toBe(false);
    settings.textSize = 'large';
    await settle();
    settings.textSize = 'normal';
    await settle();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'calendar-month-grid',
        message: 'fit_measure_failed',
        severity: 'warning',
        context: { action: 'fit_measure_failed', format: 'phone', detail: 'no_scroller' },
      })
    );
    wrapper.unmount();
  });

  it('a throwing layout read sets rowPx null and reports measure_threw once', async () => {
    const { fit, wrapper } = mountFit();
    await settle();
    proto.getBoundingClientRect = () => {
      throw new Error('detached');
    };
    settings.textSize = 'large';
    await settle();
    expect(fit.rowPx.value).toBeNull();
    settings.textSize = 'normal';
    await settle();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].context.detail).toBe('measure_threw');
    wrapper.unmount();
  });
});
