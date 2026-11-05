import { describe, it, expect, afterEach } from 'vitest';
import {
  DRAG_ATTR,
  activityHostOf,
  dayDropAttrs,
  dragSourceAttrs,
  readDragSourceRef,
  readDropTarget,
  timeDropAttrs,
} from '@/utils/calendar/dragDom';

/** Build an element carrying `attrs` (what `v-bind="..."` would render). */
function el(attrs: Record<string, string>, tag = 'div', parent?: Element): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  (parent ?? document.body).appendChild(node);
  return node;
}

function withRect(node: HTMLElement, top: number, height: number): HTMLElement {
  const rect = { top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top };
  node.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  return node;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DRAG_ATTR', () => {
  it('names the protocol attributes once', () => {
    expect(DRAG_ATTR).toEqual({
      source: 'data-drag',
      drop: 'data-drop',
      date: 'data-date',
      hourStart: 'data-hour-start',
      hourEnd: 'data-hour-end',
      memberId: 'data-member-id',
    });
  });
});

describe('dayDropAttrs ↔ readDropTarget', () => {
  it('round-trips a day target, from the target or anything inside it', () => {
    const cell = el(dayDropAttrs('2026-11-04'));
    const chip = el({}, 'span', cell);
    expect(readDropTarget(cell, 0)).toEqual({ kind: 'day', date: '2026-11-04' });
    expect(readDropTarget(chip, 999)).toEqual({ kind: 'day', date: '2026-11-04' });
  });
});

describe('timeDropAttrs ↔ readDropTarget', () => {
  it('round-trips a week column: minutes from the pointer, hour height from the rect', () => {
    // 07:00 .. 19:00 inclusive = 13 rows; 780 px tall → 60 px per hour, top at 100.
    const column = withRect(el(timeDropAttrs('2026-11-04', 7, 19)), 100, 780);
    expect(readDropTarget(column, 100 + 150)).toEqual({
      kind: 'time',
      date: '2026-11-04',
      minutes: 9 * 60 + 30,
    });
  });

  it('round-trips a day-view member column', () => {
    const column = withRect(el(timeDropAttrs('2026-11-04', 6, 20, 'm2')), 0, 15 * 60);
    const inner = el({}, 'div', column);
    expect(readDropTarget(inner, 60)).toEqual({
      kind: 'time',
      date: '2026-11-04',
      minutes: 7 * 60,
      memberId: 'm2',
    });
  });

  it('scales with a Large-reading-mode column height', () => {
    // 13 rows at 71.25 px.
    const column = withRect(el(timeDropAttrs('2026-11-04', 7, 19)), 0, 13 * 71.25);
    expect(readDropTarget(column, 71.25 * 3)).toMatchObject({ minutes: 10 * 60 });
  });

  it('clamps a point above or below the column', () => {
    const column = withRect(el(timeDropAttrs('2026-11-04', 0, 23)), 0, 24 * 60);
    expect(readDropTarget(column, -50)).toMatchObject({ minutes: 0 });
    expect(readDropTarget(column, 5000)).toMatchObject({ minutes: 23 * 60 + 45 });
  });

  it('writes no member attribute when there is no member', () => {
    expect(timeDropAttrs('2026-11-04', 7, 19)).not.toHaveProperty(DRAG_ATTR.memberId);
  });
});

describe('readDropTarget: malformed', () => {
  it('returns null outside any target', () => {
    expect(readDropTarget(el({}), 0)).toBeNull();
  });

  it('returns null for a bad date, kind or hour range', () => {
    expect(readDropTarget(el({ 'data-drop': 'day', 'data-date': 'soon' }), 0)).toBeNull();
    expect(readDropTarget(el({ 'data-drop': 'day' }), 0)).toBeNull();
    expect(readDropTarget(el({ 'data-drop': 'slot', 'data-date': '2026-11-04' }), 0)).toBeNull();
    const reversed = withRect(el(timeDropAttrs('2026-11-04', 19, 7)), 0, 100);
    expect(readDropTarget(reversed, 10)).toBeNull();
    const missing = withRect(el({ 'data-drop': 'time', 'data-date': '2026-11-04' }), 0, 100);
    expect(readDropTarget(missing, 10)).toBeNull();
    const outOfRange = withRect(el(timeDropAttrs('2026-11-04', 7, 30)), 0, 100);
    expect(readDropTarget(outOfRange, 10)).toBeNull();
  });

  it('returns null for a column with no rendered height', () => {
    expect(readDropTarget(withRect(el(timeDropAttrs('2026-11-04', 7, 19)), 0, 0), 10)).toBeNull();
  });
});

describe('dragSourceAttrs ↔ readDragSourceRef', () => {
  it('round-trips a move source carrying the reveal hooks', () => {
    const chip = el({
      ...dragSourceAttrs('move'),
      'data-activity-id': 'a1',
      'data-occurrence-date': '2026-11-04',
    });
    const label = el({}, 'span', chip);
    const expected = { activityId: 'a1', occurrenceDate: '2026-11-04', gesture: 'move' };
    expect(readDragSourceRef(chip)).toEqual(expected);
    expect(readDragSourceRef(label)).toEqual(expected);
  });

  it('reads a resize handle inside its block, and the member column around it', () => {
    const column = el(timeDropAttrs('2026-11-04', 7, 19, 'm1'));
    const block = el(
      {
        ...dragSourceAttrs('move'),
        'data-activity-id': 'a1',
        'data-occurrence-date': '2026-11-04',
      },
      'button',
      column
    );
    const handle = el(dragSourceAttrs('resize-end'), 'span', block);
    expect(readDragSourceRef(handle)).toEqual({
      activityId: 'a1',
      occurrenceDate: '2026-11-04',
      gesture: 'resize-end',
      columnMemberId: 'm1',
    });
    expect(readDragSourceRef(block)).toMatchObject({ gesture: 'move', columnMemberId: 'm1' });
    // The block a handle lifts (the binding's placeholder and ghost for a resize).
    expect(activityHostOf(handle)).toBe(block);
    expect(activityHostOf(block)).toBe(block);
    expect(activityHostOf(column)).toBeNull();
  });

  it('returns null without a source, an identity, or a valid gesture', () => {
    expect(
      readDragSourceRef(el({ 'data-activity-id': 'a1', 'data-occurrence-date': '2026-11-04' }))
    ).toBeNull();
    expect(readDragSourceRef(el(dragSourceAttrs('move')))).toBeNull();
    expect(
      readDragSourceRef(el({ ...dragSourceAttrs('move'), 'data-activity-id': 'a1' }))
    ).toBeNull();
    expect(
      readDragSourceRef(
        el({ 'data-drag': 'fling', 'data-activity-id': 'a1', 'data-occurrence-date': '2026-11-04' })
      )
    ).toBeNull();
    expect(
      readDragSourceRef(
        el({ ...dragSourceAttrs('move'), 'data-activity-id': 'a1', 'data-occurrence-date': 'x' })
      )
    ).toBeNull();
  });
});
