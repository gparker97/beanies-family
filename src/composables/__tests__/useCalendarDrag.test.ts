/**
 * The calendar drag binding (#142). Only the binding's own cases: the gesture rules are
 * `dragGesture.test.ts`, the patch math `dragMath.test.ts`, the writes `useCalendarMove.test.ts`.
 *
 * jsdom has no layout, so `elementFromPoint` / `elementsFromPoint` are stubbed by x: the
 * Wednesday cell is x 0-99, Thursday 100-199, empty grid beyond.
 */
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, nextTick, ref } from 'vue';
import type { FamilyActivity } from '@/types/models';
import type { DragSourceRef } from '@/utils/calendar/dragDom';
import type { DropTarget } from '@/utils/calendar/dragMath';
import { pointer } from '@/test/pointerSwipe';

const commitCalendarMove = vi.fn();
const logDrop = vi.fn();
const activity = {
  id: 'piano',
  title: 'Piano',
  date: '2026-11-11',
  startTime: '16:00',
  endTime: '17:00',
  recurrence: 'none',
  isActive: true,
} as FamilyActivity;
vi.mock('@/composables/useCalendarMove', () => ({
  commitCalendarMove: (...args: unknown[]) => commitCalendarMove(...args),
  logDrop: (...args: unknown[]) => logDrop(...args),
  dropWhenLabel: (t: DropTarget) => t.date,
  resolveDragSource: (r: DragSourceRef | null, grab: DropTarget | null) =>
    r ? { activity, seriesDate: '2026-11-11', grabDate: grab?.date ?? r.occurrenceDate } : null,
}));

const perms = vi.hoisted(() => ({ canEdit: true }));
vi.mock('@/composables/usePermissions', async () => {
  const { computed } = await import('vue');
  return { usePermissions: () => ({ canEditActivities: computed(() => perms.canEdit) }) };
});

const logEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...args: unknown[]) => logEvent(...args) }));
vi.mock('@/utils/haptics', () => ({ hapticTick: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn(), UNDO_TOAST_MS: 6000 }));

import { useCalendarDrag } from '@/composables/useCalendarDrag';
import { useHorizontalSwipe } from '@/composables/useHorizontalSwipe';
import { __resetEscapeCloseForTests } from '@/composables/useEscapeClose';
import { setWriteGate } from '@/services/automerge/worker/writeGate';
import { dayDropAttrs, dragSourceAttrs, timeDropAttrs } from '@/utils/calendar/dragDom';
import { timelineSlot } from '@/composables/drag/timelineSlot';

type Drag = ReturnType<typeof useCalendarDrag>;

let drag: Drag;
let wrapper: VueWrapper;
const swipeLeft = vi.fn();
const progress = vi.fn();
const chipClick = vi.fn();
const bubbleSeen: string[] = [];

const Harness = defineComponent({
  setup() {
    const root = ref<HTMLElement | null>(null);
    drag = useCalendarDrag(root, { view: 'month' });
    // The view's swipe, bubble phase on the same root, exactly as `useCalendarSlide` binds it.
    useHorizontalSwipe(root, { name: 'month-grid', onSwipeLeft: swipeLeft, onProgress: progress });
    return () =>
      h(
        'div',
        {
          ref: root,
          'data-testid': 'root',
          onKeydown: drag.onKeydown,
          onKeyup: drag.onKeyup,
          onPointerdown: () => bubbleSeen.push('down'),
          onPointermove: () => bubbleSeen.push('move'),
        },
        [
          h('div', { ...dayDropAttrs('2026-11-11'), 'data-testid': 'wed' }, [
            h(
              'button',
              {
                ...dragSourceAttrs('move'),
                'data-activity-id': 'piano',
                'data-occurrence-date': '2026-11-11',
                'data-testid': 'chip',
                onClick: chipClick,
              },
              'Piano'
            ),
          ]),
          h('div', { ...dayDropAttrs('2026-11-12'), 'data-testid': 'thu' }),
          h('div', { 'data-testid': 'empty' }),
        ]
      );
  },
});

const el = (id: string) => wrapper.get(`[data-testid="${id}"]`).element as HTMLElement;

function hitAt(x: number): HTMLElement {
  if (x < 100) return el('chip');
  if (x < 200) return el('thu');
  return el('empty');
}

function click(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function key(type: 'keydown' | 'keyup', k: string, target = el('chip')): KeyboardEvent {
  const e = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe('useCalendarDrag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    __resetEscapeCloseForTests();
    setWriteGate(null);
    perms.canEdit = true;
    commitCalendarMove.mockReset().mockResolvedValue({ kind: 'saved' });
    logDrop.mockReset();
    logEvent.mockReset();
    swipeLeft.mockReset();
    progress.mockReset();
    chipClick.mockReset();
    bubbleSeen.length = 0;
    document.elementFromPoint = (x: number) => hitAt(x);
    document.elementsFromPoint = (x: number) => {
      const top = hitAt(x);
      return top === el('chip') ? [top, el('wed')] : [top];
    };
    wrapper = mount(Harness, { attachTo: document.body });
  });
  afterEach(() => {
    wrapper.unmount();
    vi.useRealTimers();
  });

  const lifts = () => logEvent.mock.calls.filter(([e]) => e.message === 'lift');

  it('mouse: a drag on a chip lifts, rings the target, drops, and the swipe never sees it', async () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
    expect(drag.overTarget.value).toEqual({ kind: 'day', date: '2026-11-12' });
    expect(lifts()[0]![0].context).toMatchObject({
      action: 'lift',
      format: 'month',
      kind: 'timed',
      detail: 'mouse',
      recur_outcome: 'move',
      stage: 'lifted',
      activity_id: 'piano',
    });
    pointer('pointermove', el('root'), { x: 160, y: 10, pointerType: 'mouse' });
    pointer('pointerup', el('root'), { x: 160, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(false);
    await flushPromises();

    expect(bubbleSeen).toEqual([]);
    expect(progress).not.toHaveBeenCalled();
    expect(commitCalendarMove).toHaveBeenCalledWith(
      expect.objectContaining({
        view: 'month',
        input: 'mouse',
        gesture: 'move',
        patch: { date: '2026-11-12' },
      })
    );
    expect(drag.liveLabel.value).toContain('Piano');
    // The click the gesture ends with never opens the drawer; the next one does.
    click(el('chip'));
    expect(chipClick).not.toHaveBeenCalled();
    click(el('chip'));
    expect(chipClick).toHaveBeenCalledTimes(1);
  });

  it('mouse: a drag on empty grid still swipes', () => {
    const empty = el('empty');
    pointer('pointerdown', empty, { x: 400, y: 10, pointerType: 'mouse' });
    pointer('pointermove', empty, { x: 330, y: 12, pointerType: 'mouse' });
    pointer('pointermove', empty, { x: 300, y: 12, pointerType: 'mouse' });
    pointer('pointerup', empty, { x: 300, y: 12, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(false);
    expect(swipeLeft).toHaveBeenCalledTimes(1);
  });

  it('a plain tap keeps its click', () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointerup', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    click(el('chip'));
    expect(chipClick).toHaveBeenCalledTimes(1);
    expect(commitCalendarMove).not.toHaveBeenCalled();
  });

  it('touch: nothing is stopped before the long-press; after it, the swipe and scroll stand down', async () => {
    const touchmove = () => {
      const e = new Event('touchmove', { bubbles: true, cancelable: true });
      el('chip').dispatchEvent(e);
      return e.defaultPrevented;
    };
    pointer('pointerdown', el('chip'), { x: 50, y: 10 });
    pointer('pointermove', el('chip'), { x: 52, y: 11 });
    expect(bubbleSeen).toEqual(['down', 'move']);
    expect(touchmove()).toBe(false);
    vi.advanceTimersByTime(300);
    expect(drag.isLifted.value).toBe(true);
    expect(touchmove()).toBe(true);

    pointer('pointermove', el('root'), { x: 150, y: 12 });
    pointer('pointermove', el('root'), { x: 160, y: 12 });
    pointer('pointerup', el('root'), { x: 160, y: 12 });
    await flushPromises();
    expect(bubbleSeen).toEqual(['down', 'move']);
    expect(progress).not.toHaveBeenCalled();
    expect(swipeLeft).not.toHaveBeenCalled();
    expect(commitCalendarMove).toHaveBeenCalledWith(expect.objectContaining({ input: 'touch' }));

    // The swipe's residual state (it saw a press but no release) resets on the next press.
    const empty = el('empty');
    pointer('pointerdown', empty, { x: 400, y: 10 });
    pointer('pointermove', empty, { x: 360, y: 11 });
    pointer('pointermove', empty, { x: 300, y: 11 });
    pointer('pointerup', empty, { x: 300, y: 11 });
    expect(swipeLeft).toHaveBeenCalledTimes(1);
  });

  it('touch: moving before the long-press hands the gesture back (a scroll or a swipe)', () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10 });
    pointer('pointermove', el('chip'), { x: 50, y: 30 });
    vi.advanceTimersByTime(400);
    expect(drag.isLifted.value).toBe(false);
    expect(lifts()).toHaveLength(0);
  });

  it('touch: a second finger cancels the lift and reaches the swipe (the pinch still works)', () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10 });
    vi.advanceTimersByTime(300);
    bubbleSeen.length = 0;
    pointer('pointerdown', el('root'), { x: 250, y: 10, pointerId: 2 });
    expect(drag.isLifted.value).toBe(false);
    expect(bubbleSeen).toEqual(['down']);
    pointer('pointermove', el('root'), { x: 60, y: 10 });
    expect(bubbleSeen).toEqual(['down', 'move']);
    expect(logEvent.mock.calls.map(([e]) => e.context?.detail)).toContain('second-pointer');
  });

  it('Escape cancels mid-drag with no write', async () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(drag.isLifted.value).toBe(false);
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse' });
    await flushPromises();
    expect(commitCalendarMove).not.toHaveBeenCalled();
    const cancel = logEvent.mock.calls.find(([e]) => e.message === 'cancel')![0];
    expect(cancel.context).toEqual({ action: 'cancel', format: 'month', detail: 'escape' });
  });

  it('a drop where it was writes nothing and logs a noop', async () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 60, y: 10, pointerType: 'mouse' });
    pointer('pointerup', el('chip'), { x: 60, y: 10, pointerType: 'mouse' });
    await flushPromises();
    expect(commitCalendarMove).not.toHaveBeenCalled();
    expect(logDrop).toHaveBeenCalledWith(expect.anything(), 'noop');
  });

  it.each([
    ['read-only', () => setWriteGate(() => ({ block: true }) as never)],
    ['no-permission', () => (perms.canEdit = false)],
  ])('%s: nothing lifts', (detail, setup) => {
    setup();
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(false);
    expect(lifts()).toHaveLength(0);
    expect(bubbleSeen).toEqual(['down', 'move']); // not ours: the swipe keeps it
    const ineligible = logEvent.mock.calls.find(([e]) => e.message === 'ineligible')![0];
    expect(ineligible).toMatchObject({ level: 'debug', context: { action: 'ineligible', detail } });
  });

  it('keyboard: Space lifts without opening the chip, arrows step, Enter drops', async () => {
    expect(key('keydown', ' ').defaultPrevented).toBe(true);
    expect(drag.isLifted.value).toBe(true);
    expect(drag.liveLabel.value).toContain('Piano');
    expect(key('keyup', ' ').defaultPrevented).toBe(true);
    expect(chipClick).not.toHaveBeenCalled();
    key('keydown', 'ArrowRight');
    expect(drag.overTarget.value).toEqual({ kind: 'day', date: '2026-11-12' });
    expect(key('keydown', 'Enter').defaultPrevented).toBe(true);
    await flushPromises();
    expect(commitCalendarMove).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'keyboard', patch: { date: '2026-11-12' } })
    );
    // Not lifted any more: Space is the chip's own again.
    expect(key('keyup', ' ').defaultPrevented).toBe(false);
  });

  it('keyboard: Space on a chip it may not move activates the chip as before', () => {
    perms.canEdit = false;
    expect(key('keydown', ' ').defaultPrevented).toBe(false);
    expect(key('keyup', ' ').defaultPrevented).toBe(false);
    expect(drag.isLifted.value).toBe(false);
  });

  it('single flight: no lift while a drop is still committing', async () => {
    let settle: (v: unknown) => void = () => {};
    commitCalendarMove.mockReturnValue(new Promise((r) => (settle = r)));
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse' });
    await flushPromises();
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse', pointerId: 3 });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse', pointerId: 3 });
    expect(drag.isLifted.value).toBe(false);
    settle({ kind: 'saved' });
    await flushPromises();
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse', pointerId: 3 });
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
  });

  it('a lost pointerup never wedges the drag: the same mouse pressing again starts afresh', async () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
    // The up was lost (released over the browser's chrome); the next press is the same id.
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(false);
    const cancel = logEvent.mock.calls.find(([e]) => e.message === 'cancel')![0];
    expect(cancel.context).toMatchObject({ action: 'cancel', detail: 'lost-up' });
    expect(commitCalendarMove).not.toHaveBeenCalled();
    // ...and that press is a real one: it lifts and drops exactly once.
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse' });
    await flushPromises();
    expect(commitCalendarMove).toHaveBeenCalledTimes(1);
  });

  it('a touch re-press after a lost up is not stopped: the swipe still sees it', () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10 });
    vi.advanceTimersByTime(300);
    expect(drag.isLifted.value).toBe(true);
    bubbleSeen.length = 0;
    // The finger's up was lost; the browser reuses its id for the next touch.
    pointer('pointerdown', el('chip'), { x: 50, y: 10 });
    expect(drag.isLifted.value).toBe(false);
    expect(bubbleSeen).toEqual(['down']); // a pending touch press is never ours
    const cancel = logEvent.mock.calls.find(([e]) => e.message === 'cancel')![0];
    expect(cancel.context).toMatchObject({ detail: 'lost-up' });
    // ...and it is a real press: the long-press lifts it.
    vi.advanceTimersByTime(300);
    expect(drag.isLifted.value).toBe(true);
  });

  it('a mouse press during a keyboard lift ends it and starts its own drag (its tap keeps its click)', async () => {
    key('keydown', ' ');
    expect(drag.isLifted.value).toBe(true);
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(false);
    const cancel = logEvent.mock.calls.find(([e]) => e.message === 'cancel')![0];
    expect(cancel.context).toMatchObject({ detail: 'pointer-down' });
    // A tap: no swallow was armed, so its click opens the chip.
    pointer('pointerup', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    click(el('chip'));
    expect(chipClick).toHaveBeenCalledTimes(1);
    // A drag from such a press lifts and drops.
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse' });
    await flushPromises();
    expect(commitCalendarMove).toHaveBeenCalledWith(expect.objectContaining({ input: 'mouse' }));
  });

  it('a right-click while lifted cancels, swallows the click, and starts no press', () => {
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse', button: 2 });
    expect(drag.isLifted.value).toBe(false);
    const cancel = logEvent.mock.calls.find(([e]) => e.message === 'cancel')![0];
    expect(cancel.context).toMatchObject({ detail: 'button' });
    click(el('chip'));
    expect(chipClick).not.toHaveBeenCalled();
    // No press was started: moving the mouse lifts nothing.
    pointer('pointermove', el('chip'), { x: 160, y: 10, pointerType: 'mouse', button: 2 });
    expect(drag.isLifted.value).toBe(false);
    expect(logEvent.mock.calls.filter(([e]) => e.message === 'ineligible')).toHaveLength(0);
  });

  it('a ghost that cannot be built cancels the drag (never blind) and reports it', () => {
    const chip = el('chip');
    const clone = chip.cloneNode.bind(chip);
    chip.cloneNode = () => {
      throw new Error('clone refused');
    };
    pointer('pointerdown', chip, { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', chip, { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(false);
    expect(drag.liveLabel.value).toMatch(/move cancelled/i);
    expect(chip.classList.contains('drag-placeholder')).toBe(false);
    const cancel = logEvent.mock.calls.find(([e]) => e.message === 'cancel')![0];
    expect(cancel.context).toMatchObject({ detail: 'ghost' });
    expect(lifts()).toHaveLength(0);
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(commitCalendarMove).not.toHaveBeenCalled();
    chip.cloneNode = clone;
  });

  it('a drop that throws still logs its drop event (failed), with the activity', async () => {
    commitCalendarMove.mockRejectedValue(new Error('boom'));
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    pointer('pointerup', el('root'), { x: 150, y: 10, pointerType: 'mouse' });
    await flushPromises();
    expect(logDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        view: 'month',
        input: 'mouse',
        gesture: 'move',
        source: expect.objectContaining({ activity }),
      }),
      'failed'
    );
    // Not wedged: the next drag lifts.
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
  });

  it('a refused pointer capture is logged at debug, and the drag goes on', () => {
    const rootEl = el('root');
    rootEl.setPointerCapture = () => {
      throw new Error('InvalidPointerId');
    };
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
    const capture = logEvent.mock.calls.find(([e]) => e.message === 'capture')![0];
    expect(capture).toMatchObject({
      surface: 'calendar-drag',
      level: 'debug',
      context: { action: 'capture', detail: 'set-failed' },
    });
  });

  it('a keyboard lift keeps the chip readable (solid placeholder, no ghost)', async () => {
    key('keydown', ' ');
    expect(el('chip').classList.contains('drag-placeholder')).toBe(true);
    expect(el('chip').classList.contains('drag-placeholder-solid')).toBe(true);
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el('chip').classList.contains('drag-placeholder')).toBe(false);
    expect(el('chip').classList.contains('drag-placeholder-solid')).toBe(false);
  });

  it('unmounting mid-drag leaves no click swallow behind', () => {
    const seen = vi.fn();
    document.addEventListener('click', seen);
    pointer('pointerdown', el('chip'), { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', el('chip'), { x: 150, y: 10, pointerType: 'mouse' });
    expect(drag.isLifted.value).toBe(true);
    wrapper.unmount();
    click(document.body);
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener('click', seen);
    wrapper = mount(Harness, { attachTo: document.body }); // for afterEach
  });

  it('detaches on unmount', () => {
    const chip = el('chip');
    wrapper.unmount();
    pointer('pointerdown', chip, { x: 50, y: 10, pointerType: 'mouse' });
    pointer('pointermove', chip, { x: 150, y: 10, pointerType: 'mouse' });
    expect(lifts()).toHaveLength(0);
    wrapper = mount(Harness, { attachTo: document.body }); // for afterEach
  });
});

describe('useCalendarDrag: root changes', () => {
  it('re-attaches when the root element changes', async () => {
    setActivePinia(createPinia());
    __resetEscapeCloseForTests();
    setWriteGate(null);
    perms.canEdit = true;
    logEvent.mockReset();
    const first = document.createElement('div');
    const second = document.createElement('div');
    for (const host of [first, second]) {
      const cell = Object.assign(document.createElement('div'), {});
      for (const [k, v] of Object.entries(dayDropAttrs('2026-11-11'))) cell.setAttribute(k, v);
      const chip = document.createElement('button');
      for (const [k, v] of Object.entries(dragSourceAttrs('move'))) chip.setAttribute(k, v);
      chip.setAttribute('data-activity-id', 'piano');
      chip.setAttribute('data-occurrence-date', '2026-11-11');
      cell.appendChild(chip);
      host.appendChild(cell);
      document.body.appendChild(host);
    }
    document.elementFromPoint = () => null;
    document.elementsFromPoint = () => [];
    const root = ref<HTMLElement | null>(first);
    const scope = effectScope();
    const api = scope.run(() => useCalendarDrag(root, { view: 'month' }))!;
    const press = (host: HTMLElement) => {
      const chip = host.querySelector('button')!;
      pointer('pointerdown', chip, { x: 0, y: 0, pointerType: 'mouse' });
      pointer('pointermove', chip, { x: 20, y: 0, pointerType: 'mouse' });
      const lifted = api.isLifted.value;
      pointer('pointercancel', chip, { x: 20, y: 0, pointerType: 'mouse' });
      return lifted;
    };
    expect(press(first)).toBe(true);
    root.value = second;
    await nextTick();
    expect(press(first)).toBe(false);
    expect(press(second)).toBe(true);
    scope.stop();
    expect(press(second)).toBe(false);
    first.remove();
    second.remove();
  });
});

/**
 * The `snap` option (timelines): the would-be slot is exposed as `overSlot` and the pointer
 * ghost sits on it with a time readout. The column is 7am-7pm drawn 780px tall (60px an
 * hour) from the viewport top, 100px wide at x 10; Piano (16:00-17:00) is drawn at y 540-600.
 */
describe('useCalendarDrag: timeline snap', () => {
  const setAttrs = (el: Element, attrs: Record<string, string>) => {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  };
  let host: HTMLElement;
  let column: HTMLElement;
  let block: HTMLElement;
  let handle: HTMLElement;
  let api: Drag;
  let scope: ReturnType<typeof effectScope>;

  beforeEach(() => {
    setActivePinia(createPinia());
    __resetEscapeCloseForTests();
    setWriteGate(null);
    perms.canEdit = true;
    host = document.createElement('div');
    column = document.createElement('div');
    setAttrs(column, timeDropAttrs('2026-11-11', 7, 18));
    column.getBoundingClientRect = () =>
      ({ top: 0, left: 10, width: 100, height: 720, right: 110, bottom: 720 }) as DOMRect;
    block = document.createElement('button');
    setAttrs(block, {
      ...dragSourceAttrs('move'),
      'data-activity-id': 'piano',
      'data-occurrence-date': '2026-11-11',
    });
    block.textContent = 'Piano';
    handle = document.createElement('span');
    setAttrs(handle, dragSourceAttrs('resize-end'));
    block.appendChild(handle);
    column.appendChild(block);
    host.appendChild(column);
    document.body.appendChild(host);
    const hit = (y: number) =>
      y >= 590 && y < 600 ? handle : y >= 540 && y < 590 ? block : column;
    document.elementFromPoint = (_x: number, y: number) => hit(y);
    document.elementsFromPoint = (_x: number, y: number) => [hit(y), column];
    scope = effectScope();
    api = scope.run(() =>
      useCalendarDrag(ref<HTMLElement | null>(host), { view: 'week', snap: timelineSlot })
    )!;
  });
  afterEach(() => {
    pointer('pointercancel', block, { x: 50, y: 0, pointerType: 'mouse' });
    scope.stop();
    host.remove();
  });

  /** The ghost frame and the readout pill, both appended to `body` by `useDragGhost`. */
  const ghost = () =>
    document.body.querySelector<HTMLElement>(':scope > div[aria-hidden].shadow-lg');
  const readout = () => document.body.querySelector<HTMLElement>(':scope > div.rounded-full');

  it('a move snaps the ghost onto the slot with the new window as its readout', () => {
    pointer('pointerdown', block, { x: 50, y: 545, pointerType: 'mouse' });
    pointer('pointermove', block, { x: 50, y: 605, pointerType: 'mouse' });
    expect(api.isLifted.value).toBe(true);
    expect(api.overSlot.value).toEqual({
      date: '2026-11-11',
      startTime: '17:00',
      endTime: '18:00',
      readout: '5pm – 6pm',
    });
    expect(ghost()!.style.transform).toBe('translate(10px, 600px)');
    expect(ghost()!.style.height).toBe('60px');
    expect(readout()!.textContent).toBe('5pm – 6pm');
  });

  it('a resize lifts the BLOCK (placeholder and ghost), reading out the new end', () => {
    pointer('pointerdown', handle, { x: 50, y: 595, pointerType: 'mouse' });
    pointer('pointermove', handle, { x: 50, y: 640, pointerType: 'mouse' });
    expect(api.isLifted.value).toBe(true);
    expect(block.classList.contains('drag-placeholder')).toBe(true);
    expect(handle.classList.contains('drag-placeholder')).toBe(false);
    expect(ghost()!.textContent).toContain('Piano');
    expect(api.overSlot.value).toMatchObject({ startTime: '16:00', endTime: '17:45' });
    expect(readout()!.textContent).toBe('5:45pm');
    expect(ghost()!.style.height).toBe('105px');
  });

  it('the slot clears when the drag ends', () => {
    pointer('pointerdown', block, { x: 50, y: 545, pointerType: 'mouse' });
    pointer('pointermove', block, { x: 50, y: 605, pointerType: 'mouse' });
    pointer('pointercancel', block, { x: 50, y: 605, pointerType: 'mouse' });
    expect(api.overSlot.value).toBeNull();
    expect(ghost()).toBeNull();
    expect(readout()).toBeNull();
  });

  it('without `snap` nothing is exposed and the ghost follows the pointer', () => {
    scope.stop();
    scope = effectScope();
    api = scope.run(() => useCalendarDrag(ref<HTMLElement | null>(host), { view: 'week' }))!;
    pointer('pointerdown', block, { x: 50, y: 545, pointerType: 'mouse' });
    pointer('pointermove', block, { x: 50, y: 605, pointerType: 'mouse' });
    expect(api.overSlot.value).toBeNull();
    expect(readout()).toBeNull();
    expect(ghost()!.style.transform).not.toContain('600px');
  });
});

/**
 * A teleported portal (the desktop month popover): it floats over cells of OTHER days, so a
 * press there takes the chip's own occurrence date as the grab date, and its keys (which never
 * reach the root) still lift. Cells: Wed 11-11, Thu 11-12, Fri 11-13 at x 0-99, 100-199,
 * 200-299; the popover's Wednesday chip floats over Thursday.
 */
describe('useCalendarDrag: portal', () => {
  let root: HTMLElement;
  let panel: HTMLElement;
  let chip: HTMLElement;
  let cells: HTMLElement[];
  let api: Drag;
  let scope: ReturnType<typeof effectScope>;
  const onLift = vi.fn();
  const menuKeys = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    __resetEscapeCloseForTests();
    setWriteGate(null);
    perms.canEdit = true;
    commitCalendarMove.mockReset().mockResolvedValue({ kind: 'saved' });
    onLift.mockReset();
    menuKeys.mockReset();
    root = document.createElement('div');
    cells = ['2026-11-11', '2026-11-12', '2026-11-13'].map((date) => {
      const cell = document.createElement('div');
      for (const [k, v] of Object.entries(dayDropAttrs(date))) cell.setAttribute(k, v);
      return root.appendChild(cell);
    });
    panel = document.createElement('div');
    panel.addEventListener('keydown', menuKeys); // the popover's own roving-focus handler
    chip = document.createElement('button');
    for (const [k, v] of Object.entries(dragSourceAttrs('move'))) chip.setAttribute(k, v);
    chip.setAttribute('data-activity-id', 'piano');
    chip.setAttribute('data-occurrence-date', '2026-11-11');
    panel.appendChild(chip);
    document.body.append(root, panel);
    const cellAt = (x: number) => cells.at(Math.min(2, Math.floor(x / 100)))!;
    document.elementFromPoint = (x: number) => cellAt(x);
    document.elementsFromPoint = (x: number) =>
      x >= 100 && x < 200 ? [chip, cellAt(x)] : [cellAt(x)];
    scope = effectScope();
    api = scope.run(() =>
      useCalendarDrag(ref<HTMLElement | null>(root), {
        view: 'month',
        portal: ref<HTMLElement | null>(panel),
        onLift,
      })
    )!;
  });
  afterEach(() => {
    scope.stop();
    root.remove();
    panel.remove();
    vi.useRealTimers();
  });

  const keyOn = (k: string, type: 'keydown' | 'keyup' = 'keydown') => {
    const e = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
    chip.dispatchEvent(e);
    return e;
  };

  it("a press in the popover grabs at the chip's own day, not the cell beneath it", async () => {
    pointer('pointerdown', chip, { x: 150, y: 10, pointerType: 'mouse' });
    pointer('pointermove', chip, { x: 250, y: 10, pointerType: 'mouse' });
    expect(api.isLifted.value).toBe(true);
    expect(onLift).toHaveBeenCalledTimes(1);
    pointer('pointerup', root, { x: 250, y: 10, pointerType: 'mouse' });
    await flushPromises();
    // Wednesday's chip dropped on Friday moves two days (Thursday beneath it is irrelevant).
    expect(commitCalendarMove).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { date: '2026-11-13' } })
    );
  });

  it('Space lifts a popover chip; its arrows step the target, not the popover focus', async () => {
    expect(keyOn(' ').defaultPrevented).toBe(true);
    expect(api.isLifted.value).toBe(true);
    expect(keyOn(' ', 'keyup').defaultPrevented).toBe(true); // the chip does not activate
    expect(onLift).not.toHaveBeenCalled(); // the popover stays open: the chip keeps focus
    keyOn('ArrowDown');
    expect(api.overTarget.value).toEqual({ kind: 'day', date: '2026-11-18' });
    expect(menuKeys).not.toHaveBeenCalled();
    keyOn('Enter');
    await flushPromises();
    expect(commitCalendarMove).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'keyboard', patch: { date: '2026-11-18' } })
    );
    // Idle again: the popover's own keys are its own.
    keyOn('ArrowDown');
    expect(menuKeys).toHaveBeenCalledTimes(1);
  });
});
