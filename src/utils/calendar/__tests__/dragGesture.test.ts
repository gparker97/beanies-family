import { describe, it, expect } from 'vitest';
import { repoFile } from '@/test/repoFile';
import { DRAG, type DropTarget } from '@/utils/calendar/dragMath';
import {
  IDLE,
  clickFollowsCancel,
  ownsPointer,
  reduce,
  stepTarget,
  type DragEvent,
  type DragState,
  type PointerInput,
} from '@/utils/calendar/dragGesture';

const CELL: DropTarget = { kind: 'day', date: '2026-11-04' };
const OTHER: DropTarget = { kind: 'day', date: '2026-11-06' };
const SLOT: DropTarget = { kind: 'time', date: '2026-11-04', minutes: 960 };
const SLOT_END: DropTarget = { kind: 'time', date: '2026-11-04', minutes: 1020 };

function down(input: PointerInput, pointerId = 1, x = 100, y = 100, button = 0): DragEvent {
  return {
    type: 'down',
    input,
    pointerId,
    button,
    x,
    y,
    t: 0,
    press: { gesture: 'move', grab: CELL },
  };
}
/** A down that is not on a draggable (or not one the person may move). */
function bareDown(input: PointerInput, pointerId = 1, button = 0): DragEvent {
  return { type: 'down', input, pointerId, button, x: 100, y: 100, t: 0, press: null };
}
function move(x: number, y: number, target?: DropTarget | null, pointerId = 1): DragEvent {
  return target === undefined
    ? { type: 'move', pointerId, x, y, t: 0 }
    : { type: 'move', pointerId, x, y, t: 0, target };
}

/** Run events from idle; returns the final step and every effect type, in order. */
function run(events: DragEvent[], from: DragState = IDLE) {
  let state = from;
  const effects: string[] = [];
  let last = { state, effects: [] as ReturnType<typeof reduce>['effects'] };
  for (const event of events) {
    last = reduce(state, event);
    state = last.state;
    effects.push(...last.effects.map((e) => e.type));
  }
  return { state, effects, last };
}

describe('dragGesture: mouse', () => {
  it('press → pressed, with no timer', () => {
    const { state, effects } = run([down('mouse')]);
    expect(state.phase).toBe('pressed');
    expect(effects).toEqual([]);
  });

  it('lifts on 4 px of movement, not before', () => {
    expect(run([down('mouse'), move(103, 100)]).state.phase).toBe('pressed');
    const { state, effects } = run([down('mouse'), move(104, 100)]);
    expect(state.phase).toBe('lifted');
    // No haptic for a mouse; the lift is announced.
    expect(effects).toEqual(['lift', 'announce']);
  });

  it('lifts with the grab target until a move names another', () => {
    const { state } = run([down('mouse'), move(110, 100)]);
    expect(state.phase === 'lifted' && state.target).toEqual(CELL);
    const named = run([down('mouse'), move(110, 100, OTHER)]).state;
    expect(named.phase === 'lifted' && named.target).toEqual(OTHER);
  });

  it('ignores the long-press timer', () => {
    expect(run([down('mouse'), { type: 'timer' }]).state.phase).toBe('pressed');
  });

  it('a press released without moving is a plain click (back to idle, no effects)', () => {
    const { state, effects } = run([down('mouse'), { type: 'up', pointerId: 1 }]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual([]);
  });

  it('owns its pointer from press (the swipe never arms on a chip)', () => {
    const pressed = run([down('mouse')]).state;
    expect(ownsPointer(pressed, 1)).toBe(true);
    expect(ownsPointer(pressed, 2)).toBe(false);
  });
});

describe('dragGesture: touch / pen', () => {
  for (const input of ['touch', 'pen'] as const) {
    it(`${input}: press starts the long-press timer`, () => {
      const { state, last } = run([down(input)]);
      expect(state.phase).toBe('pressed');
      expect(last.effects).toEqual([{ type: 'start-timer', ms: DRAG.longPressMs }]);
    });

    it(`${input}: the timer lifts with a haptic tick`, () => {
      const { state, effects } = run([down(input), { type: 'timer' }]);
      expect(state.phase).toBe('lifted');
      expect(state.phase === 'lifted' && state.target).toEqual(CELL);
      expect(effects).toEqual(['start-timer', 'clear-timer', 'haptic', 'lift', 'announce']);
    });
  }

  it('movement within 8 px keeps the press pending', () => {
    expect(run([down('touch'), move(108, 100)]).state.phase).toBe('pressed');
  });

  it('movement beyond 8 px hands the gesture back (scroll / swipe) and clears the timer', () => {
    const { state, effects } = run([down('touch'), move(109, 100)]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual(['start-timer', 'clear-timer']);
  });

  it('measures slop as a distance, not per axis', () => {
    // 6 px right + 6 px down = 8.49 px.
    expect(run([down('touch'), move(106, 106)]).state).toEqual(IDLE);
  });

  it('does not own the pointer before lift (scroll and swipe behave as today)', () => {
    expect(ownsPointer(run([down('touch')]).state, 1)).toBe(false);
    expect(ownsPointer(run([down('touch'), { type: 'timer' }]).state, 1)).toBe(true);
  });

  it('a tap before the timer is a plain tap', () => {
    const { state, effects } = run([down('touch'), { type: 'up', pointerId: 1 }]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual(['start-timer', 'clear-timer']);
  });

  it('a late timer after the press ended does nothing', () => {
    const { state, effects } = run([
      down('touch'),
      { type: 'up', pointerId: 1 },
      { type: 'timer' },
    ]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual(['start-timer', 'clear-timer']);
  });

  it('a lifted move updates the target silently', () => {
    const { state, last } = run([down('touch'), { type: 'timer' }, move(200, 100, OTHER)]);
    expect(state.phase === 'lifted' && state.target).toEqual(OTHER);
    expect(last.effects).toEqual([]);
  });

  it('a move over nothing droppable clears the target; a move without one keeps it', () => {
    const cleared = run([down('touch'), { type: 'timer' }, move(200, 100, null)]).state;
    expect(cleared.phase === 'lifted' && cleared.target).toBeNull();
    const kept = run([down('touch'), { type: 'timer' }, move(200, 100)]).state;
    expect(kept.phase === 'lifted' && kept.target).toEqual(CELL);
  });

  it('moves from another pointer are ignored', () => {
    const { state } = run([down('touch'), { type: 'timer' }, move(300, 300, OTHER, 7)]);
    expect(state.phase === 'lifted' && state.target).toEqual(CELL);
  });
});

describe('dragGesture: drop and commit', () => {
  it('release over a target drops and commits', () => {
    const { state, last } = run([
      down('touch'),
      { type: 'timer' },
      move(200, 100, OTHER),
      { type: 'up', pointerId: 1 },
    ]);
    expect(state.phase).toBe('committing');
    expect(last.effects).toEqual([
      { type: 'drop', input: 'touch', gesture: 'move', grab: CELL, target: OTHER },
    ]);
  });

  it('release over nothing cancels (spring back), releasing capture', () => {
    const { state, last } = run([
      down('mouse'),
      move(200, 100, null),
      { type: 'up', pointerId: 1 },
    ]);
    expect(state).toEqual(IDLE);
    expect(last.effects).toEqual([
      { type: 'release-capture', pointerId: 1 },
      { type: 'cancel', reason: 'no-target', swallowClick: true },
      { type: 'announce', kind: 'cancelled' },
    ]);
  });

  it('settled returns to idle; settled elsewhere is ignored', () => {
    const committing: DragState = { phase: 'committing' };
    expect(reduce(committing, { type: 'settled' }).state).toEqual(IDLE);
    expect(reduce(IDLE, { type: 'settled' }).state).toEqual(IDLE);
  });

  it('single flight: nothing presses or lifts while committing', () => {
    const committing: DragState = { phase: 'committing' };
    for (const event of [
      down('touch'),
      down('mouse'),
      { type: 'timer' } as const,
      {
        type: 'key',
        key: ' ',
        shift: false,
        lift: { view: 'month', gesture: 'move', origin: CELL },
      } as const,
      { type: 'cancel', reason: 'escape' } as const,
    ]) {
      const step = reduce(committing, event);
      expect(step.state).toBe(committing);
      expect(step.effects).toEqual([]);
    }
    expect(ownsPointer(committing, 1)).toBe(false);
  });
});

describe('dragGesture: cancel', () => {
  for (const reason of ['escape', 'pointercancel', 'hidden', 'overlay'] as const) {
    it(`a lifted drag cancels on ${reason}`, () => {
      const { state, last } = run([down('touch'), { type: 'timer' }, { type: 'cancel', reason }]);
      expect(state).toEqual(IDLE);
      expect(last.effects).toEqual([
        { type: 'release-capture', pointerId: 1 },
        { type: 'cancel', reason, swallowClick: true },
        { type: 'announce', kind: 'cancelled' },
      ]);
    });
  }

  it('Escape cancels a pointer drag', () => {
    const { state, last } = run([
      down('mouse'),
      move(110, 100),
      { type: 'key', key: 'Escape', shift: false },
    ]);
    expect(state).toEqual(IDLE);
    expect(last.effects.map((e) => e.type)).toEqual(['release-capture', 'cancel', 'announce']);
  });

  it('a cancel before lift just abandons the press (no cancel event)', () => {
    expect(run([down('touch'), { type: 'cancel', reason: 'pointercancel' }]).effects).toEqual([
      'start-timer',
      'clear-timer',
    ]);
    expect(run([down('mouse'), { type: 'cancel', reason: 'hidden' }]).effects).toEqual([]);
    expect(run([down('touch'), { type: 'key', key: 'Escape', shift: false }]).state).toEqual(IDLE);
  });

  it('a cancel while idle does nothing', () => {
    expect(reduce(IDLE, { type: 'cancel', reason: 'hidden' })).toEqual({
      state: IDLE,
      effects: [],
    });
  });
});

describe('dragGesture: second finger', () => {
  it('cancels a lifted drag, releases the first pointer, and stops owning it (pinch proceeds)', () => {
    const { state, last } = run([down('touch', 1), { type: 'timer' }, down('touch', 2)]);
    expect(state).toEqual(IDLE);
    expect(last.effects).toEqual([
      { type: 'release-capture', pointerId: 1 },
      { type: 'cancel', reason: 'second-pointer', swallowClick: true },
      { type: 'announce', kind: 'cancelled' },
    ]);
    expect(ownsPointer(state, 1)).toBe(false);
    expect(ownsPointer(state, 2)).toBe(false);
  });

  it('abandons a pending press (the timer is cleared, nothing lifts)', () => {
    const { state, effects } = run([down('touch', 1), down('touch', 2), { type: 'timer' }]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual(['start-timer', 'clear-timer']);
  });

  it('the same pointer pressing again during a press: the stale press ends, a fresh one starts', () => {
    const pressed = run([down('touch', 1, 100, 100)]).state;
    const step = reduce(pressed, down('touch', 1, 300, 50));
    expect(step.state).toMatchObject({ phase: 'pressed', pointerId: 1, x: 300, y: 50 });
    expect(step.effects).toEqual([
      { type: 'clear-timer' },
      { type: 'start-timer', ms: DRAG.longPressMs },
    ]);
    // Not on a draggable: the stale press just ends.
    expect(reduce(pressed, bareDown('touch', 1)).state).toEqual(IDLE);
  });

  it('(b) the same pointer pressing again while lifted: lost-up, then a fresh press from it', () => {
    const { state, last } = run([down('mouse', 1), move(150, 100, OTHER), down('mouse', 1, 40)]);
    expect(state).toMatchObject({ phase: 'pressed', input: 'mouse', pointerId: 1, x: 40 });
    expect(last.effects).toEqual([
      { type: 'release-capture', pointerId: 1 },
      // The up never comes, and the fresh press's own tap must keep its click.
      { type: 'cancel', reason: 'lost-up', swallowClick: false },
      { type: 'announce', kind: 'cancelled' },
    ]);
    // ...a real press: it lifts on the slop like any other.
    expect(reduce(state, move(50, 100)).state.phase).toBe('lifted');
    // Not on a draggable: the old drag ends and nothing presses.
    const lifted = run([down('mouse', 1), move(150, 100, OTHER)]).state;
    expect(reduce(lifted, bareDown('mouse', 1)).state).toEqual(IDLE);
  });

  it('(a) a non-primary button while lifted cancels (swallow armed) and never presses', () => {
    const lifted = run([down('mouse', 1), move(150, 100, OTHER)]).state;
    for (const pointerId of [1, 2]) {
      const { state, effects } = reduce(lifted, down('mouse', pointerId, 100, 100, 2));
      expect(state).toEqual(IDLE);
      expect(effects).toEqual([
        { type: 'release-capture', pointerId: 1 },
        { type: 'cancel', reason: 'button', swallowClick: true },
        { type: 'announce', kind: 'cancelled' },
      ]);
    }
    // While pressed it abandons; while idle nothing happens.
    expect(reduce(run([down('mouse', 1)]).state, down('mouse', 1, 100, 100, 2)).state).toEqual(
      IDLE
    );
    expect(reduce(IDLE, down('mouse', 1, 100, 100, 2))).toEqual({ state: IDLE, effects: [] });
    expect(reduce(IDLE, down('pen', 1, 100, 100, 2)).state).toEqual(IDLE);
  });

  it('(c) a primary press during a keyboard lift ends it and presses afresh, swallowing nothing', () => {
    const keyLift: DragEvent = {
      type: 'key',
      key: ' ',
      shift: false,
      lift: { view: 'month', gesture: 'move', origin: CELL },
    };
    const lifted = run([keyLift]).state;
    for (const input of ['mouse', 'touch'] as const) {
      const { state, effects } = reduce(lifted, down(input, 7));
      expect(state).toMatchObject({ phase: 'pressed', input, pointerId: 7 });
      expect(effects).toEqual([
        // A keyboard lift holds no capture, so nothing to release.
        { type: 'cancel', reason: 'pointer-down', swallowClick: false },
        { type: 'announce', kind: 'cancelled' },
        ...(input === 'mouse' ? [] : [{ type: 'start-timer', ms: DRAG.longPressMs }]),
      ]);
    }
    // A non-primary button only cancels it.
    const right = reduce(lifted, down('mouse', 7, 100, 100, 2));
    expect(right.state).toEqual(IDLE);
    expect(right.effects[0]).toEqual({ type: 'cancel', reason: 'button', swallowClick: false });
  });

  it('another pointer while lifted cancels but never presses (a pinch is not a new drag)', () => {
    const lifted = run([down('touch', 1), { type: 'timer' }]).state;
    expect(reduce(lifted, down('touch', 2)).state).toEqual(IDLE);
  });

  it('a lost up, a fresh press or a disposing view is not followed by a click; the rest are', () => {
    for (const reason of ['lost-up', 'pointer-down', 'dispose'] as const) {
      expect(clickFollowsCancel(reason)).toBe(false);
    }
    for (const reason of [
      'escape',
      'pointercancel',
      'second-pointer',
      'button',
      'ghost',
      'no-target',
    ] as const) {
      expect(clickFollowsCancel(reason)).toBe(true);
    }
  });
});

describe('dragGesture: keyboard', () => {
  const liftMonth: DragEvent = {
    type: 'key',
    key: ' ',
    shift: false,
    lift: { view: 'month', gesture: 'move', origin: CELL },
  };
  const liftWeek: DragEvent = {
    type: 'key',
    key: ' ',
    shift: false,
    lift: { view: 'week', gesture: 'move', origin: SLOT, endOrigin: SLOT_END },
  };
  const key = (k: string, shift = false): DragEvent => ({ type: 'key', key: k, shift });

  it('Space on a focused chip lifts (announced, no haptic, no pointer)', () => {
    const { state, last } = run([liftMonth]);
    expect(state).toMatchObject({
      phase: 'lifted',
      input: 'keyboard',
      target: CELL,
      view: 'month',
    });
    expect(last.effects).toEqual([
      { type: 'lift', input: 'keyboard', gesture: 'move', grab: CELL },
      { type: 'announce', kind: 'lifted', target: CELL },
    ]);
  });

  it('Space with nothing to lift does nothing', () => {
    expect(reduce(IDLE, key(' '))).toEqual({ state: IDLE, effects: [] });
    expect(reduce(IDLE, key('ArrowRight')).state).toEqual(IDLE);
  });

  it('arrows step the target and announce it', () => {
    const { state, last } = run([liftMonth, key('ArrowRight')]);
    expect(state.phase === 'lifted' && state.target).toEqual({ kind: 'day', date: '2026-11-05' });
    expect(last.effects).toEqual([
      { type: 'announce', kind: 'over', target: { kind: 'day', date: '2026-11-05' } },
    ]);
  });

  it('Enter drops on the stepped target', () => {
    const { state, last } = run([liftMonth, key('ArrowDown'), key('Enter')]);
    expect(state.phase).toBe('committing');
    expect(last.effects).toEqual([
      {
        type: 'drop',
        input: 'keyboard',
        gesture: 'move',
        grab: CELL,
        target: { kind: 'day', date: '2026-11-11' },
      },
    ]);
  });

  it('Escape cancels a keyboard lift (nothing to release)', () => {
    const { state, last } = run([liftMonth, key('Escape')]);
    expect(state).toEqual(IDLE);
    expect(last.effects).toEqual([
      // A keyboard lift owes no pointer click: nothing is swallowed.
      { type: 'cancel', reason: 'escape', swallowClick: false },
      { type: 'announce', kind: 'cancelled' },
    ]);
  });

  it('a step that clamps to the same target announces nothing', () => {
    const top: DragEvent = {
      type: 'key',
      key: ' ',
      shift: false,
      lift: { view: 'week', gesture: 'move', origin: { ...SLOT, minutes: 0 } },
    };
    expect(run([top, key('ArrowUp')]).last.effects).toEqual([]);
  });

  it('Shift+↓ on an unmoved timeline lift turns it into a resize from the end', () => {
    const { state, last } = run([liftWeek, key('ArrowDown', true)]);
    expect(state).toMatchObject({
      phase: 'lifted',
      gesture: 'resize-end',
      grab: SLOT_END,
      target: { ...SLOT_END, minutes: 1035 },
    });
    expect(last.effects).toEqual([
      { type: 'announce', kind: 'over', target: { ...SLOT_END, minutes: 1035 } },
    ]);
    const dropped = run([
      liftWeek,
      key('ArrowDown', true),
      key('ArrowUp', true),
      key('ArrowUp', true),
      key('Enter'),
    ]);
    expect(dropped.last.effects).toEqual([
      {
        type: 'drop',
        input: 'keyboard',
        gesture: 'resize-end',
        grab: SLOT_END,
        target: { ...SLOT_END, minutes: 1005 },
      },
    ]);
  });

  it('Shift+arrows after a move are ignored (a resize would discard the move)', () => {
    const { state } = run([liftWeek, key('ArrowDown'), key('ArrowDown', true)]);
    expect(state).toMatchObject({ gesture: 'move', target: { ...SLOT, minutes: 975 } });
  });

  it('Shift+arrows without a known end (month) do not resize', () => {
    const { state } = run([liftMonth, key('ArrowDown', true)]);
    expect(state).toMatchObject({ gesture: 'move', target: CELL });
  });

  it('plain arrows during a resize are ignored', () => {
    const { state } = run([liftWeek, key('ArrowDown', true), key('ArrowRight')]);
    expect(state).toMatchObject({ gesture: 'resize-end', target: { ...SLOT_END, minutes: 1035 } });
  });

  it('keys do not steer a pointer drag; Enter does not drop it', () => {
    const lifted = run([down('mouse'), move(110, 100)]).state;
    expect(reduce(lifted, key('ArrowRight')).state).toBe(lifted);
    expect(reduce(lifted, key('Enter')).state).toBe(lifted);
  });

  it('a second Space while lifted does nothing', () => {
    const lifted = run([liftMonth]).state;
    expect(reduce(lifted, liftMonth).state).toBe(lifted);
  });

  it('passes the per-render step context through (member columns)', () => {
    const liftDay: DragEvent = {
      type: 'key',
      key: ' ',
      shift: false,
      lift: { view: 'day', gesture: 'move', origin: { ...SLOT, memberId: 'm1' } },
    };
    const step: DragEvent = {
      type: 'key',
      key: 'ArrowRight',
      shift: false,
      steps: { memberIds: ['m1', 'm2'] },
    };
    expect(run([liftDay, step]).state).toMatchObject({ target: { memberId: 'm2' } });
  });
});

describe('stepTarget', () => {
  describe('month', () => {
    it('←/→ a day, ↑/↓ a week, across month ends', () => {
      const d = { kind: 'day', date: '2026-11-30' } as const;
      expect(stepTarget('month', d, 'ArrowRight', false)).toEqual({
        kind: 'day',
        date: '2026-12-01',
      });
      expect(stepTarget('month', d, 'ArrowLeft', false)).toEqual({
        kind: 'day',
        date: '2026-11-29',
      });
      expect(stepTarget('month', d, 'ArrowDown', false)).toEqual({
        kind: 'day',
        date: '2026-12-07',
      });
      expect(stepTarget('month', d, 'ArrowUp', false)).toEqual({ kind: 'day', date: '2026-11-23' });
    });

    it('ignores other keys', () => {
      expect(stepTarget('month', CELL, 'Home', false)).toBe(CELL);
    });
  });

  describe('week', () => {
    const dates = [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ];

    it('↑/↓ 15 minutes, ←/→ a day', () => {
      expect(stepTarget('week', SLOT, 'ArrowDown', false)).toEqual({ ...SLOT, minutes: 975 });
      expect(stepTarget('week', SLOT, 'ArrowUp', false)).toEqual({ ...SLOT, minutes: 945 });
      expect(stepTarget('week', SLOT, 'ArrowRight', false)).toEqual({
        ...SLOT,
        date: '2026-11-05',
      });
      expect(stepTarget('week', SLOT, 'ArrowLeft', false)).toEqual({ ...SLOT, date: '2026-11-03' });
    });

    it('Shift+↑/↓ steps 15 minutes (the resize end); Shift+←/→ does nothing', () => {
      expect(stepTarget('week', SLOT, 'ArrowDown', true)).toEqual({ ...SLOT, minutes: 975 });
      expect(stepTarget('week', SLOT, 'ArrowRight', true)).toBe(SLOT);
    });

    it('clamps minutes to 00:00 .. 23:45 and days to the visible week', () => {
      expect(stepTarget('week', { ...SLOT, minutes: 0 }, 'ArrowUp', false)).toMatchObject({
        minutes: 0,
      });
      expect(stepTarget('week', { ...SLOT, minutes: 1425 }, 'ArrowDown', false)).toMatchObject({
        minutes: 1425,
      });
      expect(
        stepTarget('week', { ...SLOT, date: '2026-11-08' }, 'ArrowRight', false, { dates })
      ).toMatchObject({ date: '2026-11-08' });
      expect(
        stepTarget('week', { ...SLOT, date: '2026-11-02' }, 'ArrowLeft', false, { dates })
      ).toMatchObject({ date: '2026-11-02' });
    });

    it('a day target (all-day row, strip pill) steps ←/→ a day and ignores ↑/↓', () => {
      expect(stepTarget('week', CELL, 'ArrowRight', false, { dates })).toEqual({
        kind: 'day',
        date: '2026-11-05',
      });
      expect(stepTarget('week', CELL, 'ArrowDown', false)).toBe(CELL);
      expect(
        stepTarget('week', { kind: 'day', date: '2026-11-08' }, 'ArrowRight', false, { dates })
      ).toEqual({
        kind: 'day',
        date: '2026-11-08',
      });
    });
  });

  describe('day', () => {
    const lane: DropTarget = { ...SLOT, memberId: 'm2' };
    const memberIds = ['m1', 'm2', 'm3'];

    it('↑/↓ 15 minutes', () => {
      expect(stepTarget('day', lane, 'ArrowDown', false)).toEqual({ ...lane, minutes: 975 });
    });

    it('←/→ a member column, clamped at both ends', () => {
      expect(stepTarget('day', lane, 'ArrowRight', false, { memberIds })).toEqual({
        ...lane,
        memberId: 'm3',
      });
      expect(stepTarget('day', lane, 'ArrowLeft', false, { memberIds })).toEqual({
        ...lane,
        memberId: 'm1',
      });
      expect(
        stepTarget('day', { ...lane, memberId: 'm3' }, 'ArrowRight', false, { memberIds })
      ).toEqual({ ...lane, memberId: 'm3' });
    });

    it('never changes the date, and does nothing without columns', () => {
      expect(stepTarget('day', lane, 'ArrowRight', false)).toBe(lane);
      expect(stepTarget('day', SLOT, 'ArrowRight', false, { memberIds })).toBe(SLOT);
    });
  });
});

describe('purity', () => {
  it('dragGesture imports nothing from vue or the DOM', () => {
    const src = repoFile('src/utils/calendar/dragGesture.ts');
    const imports = [...src.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec).not.toMatch(/^(vue|@vue\/|pinia)/);
      expect(spec).not.toMatch(/^@\/(composables|components|stores|pages)\//);
    }
    expect(src).not.toMatch(/\b(document|window|navigator|setTimeout)\b\.?/);
  });
});
