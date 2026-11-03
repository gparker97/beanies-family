/**
 * A start/end pair in one picker. What it must guarantee:
 *   - picks are held: nothing moves on by itself; "End time ›" writes the start and turns the
 *     sheet to the end step (re-anchored on the end pill), Done writes and closes,
 *   - back returns to the start step, Done closes from either step, the other pill switches
 *     step, the open step's pill closes,
 *   - the panel resets per step; Recent and All day on the start only; Lasts, back and Clear on
 *     the end only; the end pill has no ✕,
 *   - the `#label` slot replaces FormFieldGroup,
 *   - `rememberStartTime` runs once per start step left with a written value,
 *   - All day closes first, then emits, leaving no overlay or Escape layer behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick } from 'vue';

const hoisted = vi.hoisted(() => ({
  mobile: null as unknown as { value: boolean },
  logEvent: vi.fn(),
  rememberStartTime: vi.fn(async () => {}),
  recentStartTimes: ['07:30', '16:15'],
}));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  hoisted.mobile = ref(false);
  return { useBreakpoint: () => ({ isMobile: hoisted.mobile }) };
});
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => hoisted.logEvent(...a),
}));
vi.mock('@/composables/useTranslation', () => {
  const en: Record<string, string> = { 'time.backToStart': 'Start {time}' };
  return { useTranslation: () => ({ t: (k: string) => en[k] ?? k }) };
});
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get recentStartTimes() {
      return hoisted.recentStartTimes;
    },
    rememberStartTime: hoisted.rememberStartTime,
  }),
}));

import BeanieTimeRange from '@/components/ui/BeanieTimeRange.vue';
import { __resetEscapeCloseForTests, escapeLayerCount } from '@/composables/useEscapeClose';
import { hasOpenOverlays, resetOverlayStack } from '@/utils/overlayStack';

const card = () => document.querySelector<HTMLElement>('[data-testid="time-picker-card"]');
const inCard = (sel: string) => card()!.querySelector<HTMLElement>(sel);
const steps = () =>
  hoisted.logEvent.mock.calls
    .map(([e]) => e as { context: { action: string; kind?: string } })
    .filter((e) => e.context.action === 'range_step')
    .map((e) => e.context.kind);

let wrapper: VueWrapper | null = null;
const mounted: VueWrapper[] = [];

function mountRange(props: Record<string, unknown>, slots: Record<string, unknown> = {}) {
  wrapper = mount(BeanieTimeRange, {
    props: { start: '09:00', end: '10:00', ...props } as { start: string; end: string },
    attachTo: document.body,
    slots: slots as never,
  });
  mounted.push(wrapper);
  return wrapper;
}

const pill = (w: VueWrapper, which: 'start' | 'end') =>
  w.find(`[data-time-range-column="${which}"] [data-testid="time-picker-trigger"]`);

function rectAt(el: Element, left: number): void {
  const r = {
    top: 100,
    bottom: 130,
    left,
    right: left + 90,
    width: 90,
    height: 30,
    x: left,
    y: 100,
  };
  (el as HTMLElement).getBoundingClientRect = () => ({ ...r, toJSON: () => r }) as DOMRect;
}

async function flush() {
  await nextTick();
  await nextTick();
}

async function tap(sel: string) {
  inCard(sel)!.click();
  await flush();
}

beforeEach(() => {
  hoisted.mobile.value = false;
  hoisted.logEvent.mockReset();
  hoisted.rememberStartTime.mockClear();
  resetOverlayStack();
  __resetEscapeCloseForTests();
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});
afterEach(() => {
  // Every wrapper, not just the last: a leaked one re-renders on the next test's breakpoint
  // change into a DOM this hook has already cleared.
  for (const w of mounted.splice(0)) w.unmount();
  wrapper = null;
  resetOverlayStack();
  __resetEscapeCloseForTests();
  document.body.innerHTML = '';
});

describe('BeanieTimeRange: start step, then End time', () => {
  it('holds the picks, and End time writes the start and turns to the end step', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    rectAt(pill(w, 'start').element, 20);
    rectAt(pill(w, 'end').element, 400);
    await pill(w, 'start').trigger('click');
    await flush();
    expect(card()!.style.left).toBe('20px');
    expect(inCard('[data-testid="time-picker-recent"]')).not.toBeNull();
    expect(inCard('[data-testid="time-picker-durations"]')).toBeNull();

    await tap('[data-hour="16"]');
    await tap('[data-minute="15"]');
    // Nothing moved on and nothing was written: the person sees 4 and :15 in orange.
    expect(w.emitted('update:start')).toBeUndefined();
    expect(inCard('[data-minute="15"]')!.getAttribute('data-state')).toBe('picked');
    expect(steps()).toEqual([]);

    await tap('[data-testid="time-picker-next"]');
    expect(w.emitted('update:start')).toEqual([['16:15']]);
    expect(hoisted.rememberStartTime).toHaveBeenCalledTimes(1);
    expect(hoisted.rememberStartTime).toHaveBeenCalledWith('16:15');
    expect(steps()).toEqual(['advanced']);

    // Still open, now the end step, re-anchored on the end pill.
    expect(card()!.style.left).toBe('400px');
    expect(pill(w, 'end').attributes('aria-expanded')).toBe('true');
    await w.setProps({ start: '16:15', end: '17:15' });
    await flush();
    expect(inCard('[data-testid="time-picker-recent"]')).toBeNull();
    expect(inCard('[data-testid="time-picker-all-day"]')).toBeNull();
    expect(inCard('[data-testid="time-picker-next"]')).toBeNull();
    expect(inCard('[data-testid="time-picker-back"]')!.textContent).toContain('Start 4:15pm');
    // The end that follows the start (1 hr) is suggested, not picked.
    expect(inCard('[data-duration="60"]')!.getAttribute('data-state')).toBe('suggested');

    await tap('[data-duration="90"]');
    expect(w.emitted('update:end')).toBeUndefined();
    await tap('[data-testid="time-picker-done"]');
    expect(w.emitted('update:end')).toEqual([['17:45']]);
    expect(card()).toBeNull();
    expect(hoisted.rememberStartTime).toHaveBeenCalledTimes(1);
  });

  it('End time with nothing picked turns to the end step and writes nothing', async () => {
    const w = mountRange({ start: '09:00', end: '11:30' });
    await pill(w, 'start').trigger('click');
    await flush();
    await tap('[data-testid="time-picker-next"]');
    expect(w.emitted('update:start')).toBeUndefined();
    expect(hoisted.rememberStartTime).not.toHaveBeenCalled();
    expect(inCard('[data-testid="time-picker-durations"]')).not.toBeNull();
  });

  it('a recent time is held until a button writes it', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'start').trigger('click');
    await flush();
    await tap('[data-recent="07:30"] button');
    expect(w.emitted('update:start')).toBeUndefined();
    await tap('[data-testid="time-picker-done"]');
    expect(w.emitted('update:start')).toEqual([['07:30']]);
    expect(steps()).toEqual(['closed']);
  });
});

describe('BeanieTimeRange: moving between steps', () => {
  it('back returns to the start step with its rows; finishing flows forward again', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'end').trigger('click');
    await flush();
    await tap('[data-testid="time-picker-back"]');
    expect(steps()).toEqual(['back']);
    expect(pill(w, 'start').attributes('aria-expanded')).toBe('true');
    expect(inCard('[data-testid="time-picker-recent"]')).not.toBeNull();
    expect(inCard('[data-hour="9"]')!.getAttribute('data-state')).toBe('suggested');
    await tap('[data-minute="15"]');
    await tap('[data-testid="time-picker-next"]');
    expect(w.emitted('update:start')).toEqual([['09:15']]);
    expect(steps()).toEqual(['back', 'advanced']);
  });

  it('Done closes from the start step without advancing, writing a lit hour once', async () => {
    const w = mountRange({ start: '09:30', end: '10:30' });
    await pill(w, 'start').trigger('click');
    await flush();
    await tap('[data-hour="14"]');
    await tap('[data-testid="time-picker-done"]');
    expect(w.emitted('update:start')).toEqual([['14:30']]);
    expect(w.emitted('update:end')).toBeUndefined();
    expect(hoisted.rememberStartTime).toHaveBeenCalledWith('14:30');
    expect(card()).toBeNull();
    expect(steps()).toEqual(['closed']);
  });

  it('Done with nothing picked closes and remembers nothing', async () => {
    const w = mountRange({ start: '09:30', end: '10:30' });
    await pill(w, 'start').trigger('click');
    await flush();
    await tap('[data-testid="time-picker-done"]');
    expect(card()).toBeNull();
    expect(w.emitted('update:start')).toBeUndefined();
    expect(hoisted.rememberStartTime).not.toHaveBeenCalled();
  });

  it('Done closes from the end step', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'end').trigger('click');
    await flush();
    await tap('[data-hour="11"]');
    await tap('[data-testid="time-picker-done"]');
    expect(w.emitted('update:end')).toEqual([['11:00']]);
    expect(card()).toBeNull();
  });

  it("the other pill switches step while open; the open step's pill closes", async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'start').trigger('click');
    await flush();
    await pill(w, 'end').trigger('click');
    await flush();
    expect(card()).not.toBeNull();
    expect(inCard('[data-testid="time-picker-durations"]')).not.toBeNull();
    expect(pill(w, 'end').attributes('aria-expanded')).toBe('true');
    await pill(w, 'end').trigger('click');
    await flush();
    expect(card()).toBeNull();
  });

  it('resets the panel state on a step change', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'start').trigger('click');
    await flush();
    const fine = [...card()!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'time.fiveMinuteSteps'
    )!;
    fine.click();
    await flush();
    expect(card()!.querySelectorAll('[data-minute]')).toHaveLength(12);
    await tap('[data-minute="5"]');
    await tap('[data-testid="time-picker-next"]');
    expect(card()!.querySelectorAll('[data-minute]')).toHaveLength(4);
  });
});

describe('BeanieTimeRange: end step and labels', () => {
  it('has no ✕ on either pill; Clear lives in the end step with clearableEnd', async () => {
    const w = mountRange({ start: '09:00', end: '10:00', clearableEnd: true });
    expect(w.find('[data-testid="time-picker-clear"]').exists()).toBe(false);
    await pill(w, 'start').trigger('click');
    await flush();
    expect(inCard('[data-testid="time-picker-panel-clear"]')).toBeNull();
    await pill(w, 'end').trigger('click');
    await flush();
    await tap('[data-testid="time-picker-panel-clear"]');
    expect(w.emitted('update:end')).toEqual([['']]);
    expect(card()).toBeNull();
  });

  it('offers no Clear on the end without clearableEnd', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'end').trigger('click');
    await flush();
    expect(inCard('[data-testid="time-picker-panel-clear"]')).toBeNull();
  });

  it('labels each column with a FormFieldGroup by default', () => {
    const w = mountRange({});
    const labels = w.findAll('[data-form-label]').map((g) => g.attributes('data-form-label'));
    expect(labels).toEqual(['modal.startTime', 'modal.endTime']);
    const custom = mountRange({ startLabel: 'Starts', endLabel: 'Ends' });
    expect(custom.findAll('[data-form-label]').map((g) => g.attributes('data-form-label'))).toEqual(
      ['Starts', 'Ends']
    );
  });

  it('renders the #label slot above each pill instead of FormFieldGroup', () => {
    const w = mountRange(
      { startLabel: 'Starts', endLabel: 'Ends' },
      { label: ({ text }: { text: string }) => h('div', { class: 'ob-detail-label' }, text) }
    );
    expect(w.findAll('[data-form-label]')).toHaveLength(0);
    expect(w.findAll('.ob-detail-label').map((l) => l.text())).toEqual(['Starts', 'Ends']);
    expect(pill(w, 'start').exists()).toBe(true);
  });

  it('All day closes first, then emits, and leaves no layer behind (phone)', async () => {
    hoisted.mobile.value = true;
    const w = mountRange({ allDayAffordance: true });
    await pill(w, 'start').trigger('click');
    await flush();
    expect(hasOpenOverlays()).toBe(true);
    await tap('[data-testid="time-picker-all-day"]');
    expect(w.emitted('all-day')).toHaveLength(1);
    expect(card()).toBeNull();
    expect(hasOpenOverlays()).toBe(false);
    expect(escapeLayerCount()).toBe(0);
  });

  it('a parent that folds the range away on all-day leaves no layer behind', async () => {
    hoisted.mobile.value = true;
    const w = mountRange({ allDayAffordance: true });
    await pill(w, 'start').trigger('click');
    await flush();
    mounted.splice(mounted.indexOf(w), 1);
    w.unmount();
    wrapper = null;
    expect(hasOpenOverlays()).toBe(false);
    expect(escapeLayerCount()).toBe(0);
  });

  it('end-step writes never touch the recent start times', async () => {
    const w = mountRange({ start: '09:00', end: '10:00' });
    await pill(w, 'end').trigger('click');
    await flush();
    await tap('[data-minute="45"]');
    await tap('[data-testid="time-picker-done"]');
    expect(w.emitted('update:end')).toEqual([['10:45']]);
    expect(hoisted.rememberStartTime).not.toHaveBeenCalled();
  });
});
