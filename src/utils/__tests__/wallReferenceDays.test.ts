import { describe, it, expect } from 'vitest';
import { wallDayReferences, wallSharedReferences, type WallReferenceDay } from '../wallActivities';

function ref(over: Partial<WallReferenceDay> = {}): WallReferenceDay {
  return {
    kind: 'birthday',
    id: 'b:m-joey:2026-09-15',
    ymd: '2026-09-15',
    label: "Joey's 7th birthday",
    emoji: '🎂',
    ...over,
  };
}

const WEEK = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];

describe('wallDayReferences — day-shaped columns (days + today views)', () => {
  it('places a reference day in its own column', () => {
    const [row] = wallDayReferences([ref()], WEEK);
    expect(row).toMatchObject({ startCol: 1, span: 1 });
    expect(row!.reference.label).toBe("Joey's 7th birthday");
  });

  it('drops a day outside the visible columns rather than drawing it at column 0', () => {
    // A birthday placed at `indexOf(...) === -1` would render as `gridColumn: 0`,
    // which CSS reads as "auto" — so it would silently land in whichever cell was
    // next, on the wrong day, on the screen the family reads across the kitchen.
    expect(wallDayReferences([ref({ ymd: '2026-10-01' })], WEEK)).toEqual([]);
  });

  it('keeps several reference days on one date, each as its own row', () => {
    const rows = wallDayReferences(
      [
        ref({ id: 'a', label: "Ana's birthday" }),
        ref({ id: 'b', label: "Bo's birthday" }),
        ref({ id: 'h', kind: 'holiday', label: 'Vesak Day (SG)', emoji: undefined }),
      ],
      WEEK
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.startCol === 1)).toBe(true);
  });

  it('handles the single-column today view', () => {
    expect(wallDayReferences([ref()], ['2026-09-15'])[0]).toMatchObject({
      startCol: 0,
      span: 1,
    });
  });

  it('returns nothing for an empty window', () => {
    expect(wallDayReferences([ref()], [])).toEqual([]);
  });
});

describe('wallSharedReferences — member-shaped columns (the bean lanes)', () => {
  it("spans every lane, because a birthday is the family's day not one bean's", () => {
    const [row] = wallSharedReferences([ref()], '2026-09-15', 5);
    expect(row).toMatchObject({ startCol: 0, span: 5 });
  });

  it('ignores reference days for any other date', () => {
    // The lanes show ONE day; a week's worth of references reaches this function
    // and only the anchored day may render.
    const refs = [ref(), ref({ id: 'x', ymd: '2026-09-16', label: "Bo's birthday" })];
    const rows = wallSharedReferences(refs, '2026-09-15', 3);
    expect(rows.map((r) => r.reference.label)).toEqual(["Joey's 7th birthday"]);
  });

  it('renders nothing when there are no columns to span', () => {
    // A family filtered down to nobody has no lanes; spanning 0 columns would
    // emit `span: 0`, which is an invalid grid placement.
    expect(wallSharedReferences([ref()], '2026-09-15', 0)).toEqual([]);
  });
});
