// @vitest-environment node
/**
 * Stars and rewards (#148), step 0 (the spike): the frozen week record on the REAL document
 * layer (`docOps` through the two-device harness). Each device plans with the pure
 * `planWeekClose` over its own copy of the family file and writes what the repository writes (a
 * whole `set` of the deterministic id), then the devices merge.
 *
 *  (a) two devices closing the same week offline converge to ONE whole record;
 *  (b) a late tick that syncs after the close is picked up by the next close (re-settle);
 *  (c) the op cost of one record, with and without the scalar writer (measured and pinned);
 *  (d) a record written early by a device whose clock is ahead is ignored by the right-clock
 *      device while the week is open, and put right by its next close once the week ends, at
 *      any age inside retention (a higher mark count re-settles without the 7-day window).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { Chore, ChoreMark, ChoreWeek } from '@/types/models';
import { choreMarkId, shiftChoreDay } from '@/utils/chores';
import { closedRecords, planWeekClose, type ChoreWeekDraft } from '@/utils/choreStars';
import type { MutationOp } from '../protocol';
import { setScalarMint } from '../scalarStrings';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';

afterEach(() => setScalarMint(null));

const KID = '7f1c2a4e-1b2d-4c3e-9f80-1a2b3c4d5e6f';
const MOM = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const W0 = '2026-11-09'; // Mon .. Sun 11-15
const MON = '2026-11-16';
const T = '2026-11-01T08:00:00.000Z';
const RULES = { on: true, weeklyOn: true, barPct: 80, startedOn: W0 };

const days7 = (start: string) => Array.from({ length: 7 }, (_, i) => shiftChoreDay(start, i));

function chore(id: string, over: Partial<Chore> = {}): Chore {
  return {
    id,
    title: `Chore ${id}`,
    emoji: '🧹',
    assigneeIds: [KID],
    block: 'morning',
    sortOrder: 0,
    createdBy: MOM,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function mark(date: string, ref: string): ChoreMark {
  return {
    id: choreMarkId('done', KID, date, ref),
    kind: 'done',
    memberId: KID,
    date,
    ref,
    by: KID,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
  };
}

const setOp = (collection: 'chores' | 'choreMarks', e: Chore | ChoreMark): MutationOp => ({
  op: 'set',
  collection,
  id: e.id,
  entity: { ...e },
});
const ticks = (dates: readonly string[], ref = 'c1') =>
  dates.map((d) => setOp('choreMarks', mark(d, ref)));

/** The plain JSON of a doc: what the projection would hand the store. */
const plain = (doc: Doc) => JSON.parse(JSON.stringify(doc)) as FamilyDocument;

/** What `starStore.closeWeeks` plans on a device holding `doc`, with its clock at `todayYmd`. */
function planOn(doc: Doc, todayYmd: string) {
  const js = plain(doc);
  return planWeekClose({
    todayYmd,
    weekStartDay: 1,
    rewards: RULES,
    earners: [KID],
    living: new Set([KID, MOM]),
    chores: Object.values(js.chores ?? {}),
    marks: Object.values(js.choreMarks ?? {}),
    gifts: [],
    weeks: Object.values(js.choreWeeks ?? {}),
  });
}

/** The ONE batch `starRepository.setChoreWeeks` sends: a whole `set` per record, stamped. */
function closeOn(doc: Doc, todayYmd: string, stamp: string): { doc: Doc; wrote: ChoreWeekDraft[] } {
  const plan = planOn(doc, todayYmd);
  if (!plan.write.length) return { doc, wrote: [] };
  const ops: MutationOp[] = plan.write.map((w) => ({
    op: 'set',
    collection: 'choreWeeks',
    id: w.id,
    entity: { ...w, createdAt: stamp, updatedAt: stamp },
  }));
  return { doc: apply(doc, { op: 'batch', ops }), wrote: plan.write };
}

const recordsOf = (doc: Doc): ChoreWeek[] => Object.values(plain(doc).choreWeeks ?? {});
/** A record without its stamps, for comparing with a plan's draft. */
const unstamped = ({ createdAt: _c, updatedAt: _u, ...rest }: ChoreWeek) => rest;

function origin(marks: MutationOp[] = []): Doc {
  return seeded([
    setOp('chores', chore('c1')),
    setOp('chores', chore('c2', { stars: 2 })),
    ...marks,
  ]);
}

describe('(a) two devices closing the same week offline', () => {
  it.each([
    ['the scalar writer OFF', false],
    ['the scalar writer ON', true],
  ])('converge to ONE whole record (%s)', (_name, scalar) => {
    if (scalar) setScalarMint((s) => new Automerge.ImmutableString(s));
    // Both hold Mon..Fri of c1. Device A also holds a Saturday tick of c2 that B never saw.
    const { a, b } = fork(origin(ticks(days7(W0).slice(0, 5))));
    const onA = closeOn(apply(a, ...ticks([days7(W0)[5]!], 'c2')), MON, '2026-11-16T07:00:00.000Z');
    const onB = closeOn(b, MON, '2026-11-16T07:30:00.000Z');
    expect(onA.wrote).toHaveLength(1);
    expect(onB.wrote).toHaveLength(1);
    expect(onA.wrote[0]).not.toEqual(onB.wrote[0]); // genuinely different records

    const merged = converge(onA.doc, onB.doc);
    const [one, ...more] = recordsOf(merged.a);
    expect(more).toEqual([]);
    // Whole: exactly one device's record, never a field-by-field mix (seven days, not eight).
    expect([onA.wrote[0], onB.wrote[0]]).toContainEqual(unstamped(one!));
    expect(one!.days).toHaveLength(7);

    // The next close on either device (it holds the union of the marks now) settles on the
    // record of the union; after one more sync both hold that, and a further close writes nothing.
    const nextA = closeOn(merged.a, MON, '2026-11-16T09:00:00.000Z');
    const nextB = closeOn(merged.b, MON, '2026-11-16T09:05:00.000Z');
    const settled = converge(nextA.doc, nextB.doc);
    const [final, ...extra] = recordsOf(settled.a);
    expect(extra).toEqual([]);
    expect(unstamped(final!)).toEqual(onA.wrote[0]);
    expect(final!.marks).toBe(6);
    expect(planOn(settled.a, MON).write).toEqual([]);
    expect(planOn(settled.b, MON).write).toEqual([]);
  });
});

describe('(b) re-settle after a real merge', () => {
  it('a late tick from an offline device is picked up; a chore delete alone rewrites nothing', () => {
    const { a: wall, b: tablet } = fork(origin(ticks(days7(W0).slice(0, 4))));
    // The tablet ticked Friday offline; the wall closes the week without it on Monday.
    const tabletAfter = apply(tablet, ...ticks([days7(W0)[4]!]));
    const closed = closeOn(wall, MON, '2026-11-16T06:00:00.000Z');
    expect(closed.wrote[0]).toMatchObject({ marks: 4, stars: 4 });

    const synced = converge(closed.doc, tabletAfter);
    const resettle = closeOn(synced.a, '2026-11-17', '2026-11-17T06:00:00.000Z');
    expect(resettle.wrote).toHaveLength(1);
    expect(resettle.wrote[0]).toMatchObject({ marks: 5, stars: 5 });

    // Deleting c1 (whose ticks those were) changes no raw mark: nothing is rewritten.
    const deleted = apply(resettle.doc, { op: 'delete', collection: 'chores', id: 'c1' });
    expect(planOn(deleted, '2026-11-18').write).toEqual([]);
    expect(recordsOf(deleted)[0]).toMatchObject({ marks: 5, stars: 5 });
  });

  it('a device whose clock is set back, with the marks swept, cannot lower a record', () => {
    const { a, b } = fork(origin(ticks(days7(W0))));
    const closed = closeOn(a, MON, '2026-11-16T06:00:00.000Z');
    const synced = converge(closed.doc, b);
    // Every mark gone (swept on another device), and B's clock reads the week as just ended.
    const swept = apply(
      synced.b,
      ...days7(W0).map((d): MutationOp => ({
        op: 'delete',
        collection: 'choreMarks',
        id: choreMarkId('done', KID, d, 'c1'),
      }))
    );
    const plan = planOn(swept, MON);
    expect(plan.write).toEqual([]);
    expect(plan.fewer).toBe(1);
  });
});

describe('(d) a record written early by a clock that is ahead', () => {
  it('is ignored while the week is open here, and put right by the next close after it ends', () => {
    const realWed = '2026-11-11';
    const { a: fast, b: right } = fork(origin(ticks([W0, '2026-11-10'])));
    // A's clock is a week ahead: it calls 11-09..11-15 closed on 11-11 and freezes it early.
    const early = closeOn(fast, shiftChoreDay(realWed, 7), '2026-11-18T08:00:00.000Z');
    expect(early.wrote.map((w) => [w.weekStart, w.marks])).toEqual([[W0, 2]]);

    let synced = converge(early.doc, right);
    // The right clock: the record is not trusted while the week is open, and nothing is written.
    expect(closedRecords(recordsOf(synced.b), realWed)).toEqual([]);
    expect(planOn(synced.b, realWed).write).toEqual([]);

    // The rest of the week is ticked on the right-clock device; on Monday it closes the week.
    const ticked = apply(synced.b, ...ticks(days7(W0).slice(2)));
    const fixed = closeOn(ticked, MON, '2026-11-16T06:00:00.000Z');
    expect(fixed.wrote).toHaveLength(1);
    expect(fixed.wrote[0]).toMatchObject({ marks: 7, stars: 7, done: 7, due: 14 });

    synced = converge(fixed.doc, synced.a);
    const [only, ...rest] = recordsOf(synced.a);
    expect(rest).toEqual([]);
    expect(unstamped(only!)).toEqual(fixed.wrote[0]);
    expect(planOn(synced.a, MON).write).toEqual([]);
  });

  it('is put right even when no right-clock device closes within the 7-day window (more marks re-settle at any age)', () => {
    const { a: fast, b: right } = fork(origin(ticks([W0, '2026-11-10'])));
    const early = closeOn(fast, '2026-11-18', '2026-11-18T08:00:00.000Z');
    const synced = converge(early.doc, right);
    const ticked = apply(synced.b, ...ticks(days7(W0).slice(2)));
    expect(recordsOf(ticked)[0]).toMatchObject({ marks: 2 });
    // First opened again on 11-23, the day after the window (11-15 + 7) ended.
    const fixed = closeOn(ticked, '2026-11-23', '2026-11-23T06:00:00.000Z');
    const plan = planOn(ticked, '2026-11-23');
    expect(plan.late).toBe(0);
    expect(plan.resettled).toBe(1);
    expect(fixed.wrote.find((w) => w.weekStart === W0)).toMatchObject({ marks: 7, stars: 7 });
    const after = converge(fixed.doc, synced.a);
    expect(recordsOf(after.a).find((w) => w.weekStart === W0)).toMatchObject({ marks: 7 });
    expect(planOn(after.a, '2026-11-23').write).toEqual([]);
  });
});

describe('(c) the op cost of one frozen week', () => {
  /** A realistic record: UUID member id, every number set, `hitOn` present. */
  const RECORD: ChoreWeek = {
    id: `${KID}:${W0}`,
    memberId: KID,
    weekStart: W0,
    done: 12,
    due: 14,
    stars: 15,
    bonus: 2,
    full: 18,
    bar: 15,
    days: [2, 3, 2, 3, 2, 3, 0],
    hitOn: '2026-11-14',
    marks: 12,
    createdAt: '2026-11-16T06:00:00.123Z',
    updatedAt: '2026-11-16T06:00:00.123Z',
  };

  function opsFor(scalar: boolean): number {
    setScalarMint(scalar ? (s) => new Automerge.ImmutableString(s) : null);
    const base = seeded();
    const before = Automerge.stats(base).numOps;
    const after = apply(base, {
      op: 'set',
      collection: 'choreWeeks',
      id: RECORD.id,
      entity: { ...RECORD },
    });
    setScalarMint(null);
    return Automerge.stats(after).numOps - before;
  }

  it('measured: one record with and without the scalar writer', () => {
    const off = opsFor(false);
    const on = opsFor(true);
    // eslint-disable-next-line no-console -- the spike's measurement, printed on purpose
    console.log(
      `[choreWeeks] one ChoreWeek record: ${off} ops (scalar writer OFF), ${on} ops (ON)`
    );
    // Pinned (2026-11-16, @automerge/automerge 3.5.0). OFF: every string is text, one op to make
    // it plus one per character (the 47-char id, the 36-char member id, two dates, two
    // timestamps: 151 ops), plus the entity map, seven numbers and the `days` list with its seven
    // inserts; the plan estimated about 170. ON: each of the six strings is one op.
    // Three kids for a year: 156 records, about 27,000 ops OFF and 3,400 ON.
    expect(off).toBe(OFF_OPS);
    expect(on).toBe(ON_OPS);
  });
});

const OFF_OPS = 173;
const ON_OPS = 22;
