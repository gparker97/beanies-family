import { describe, expect, it } from 'vitest';
import type { FlightLeg, FlightVerification } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { extractSegmentOccurrences } from '@/utils/vacation';
import { liveNoticeId, travelChangeId } from '@/utils/notifications/travel';
import { noticeRevision, occurrenceNotice } from './occurrenceNotice';
import {
  changeNoticeRevision,
  liveRecordOf,
  revisionOf,
  tupleFromLeg,
  tupleFromWas,
} from './schedule';
import {
  deriveVerification,
  noticeRevAfterWrite,
  planChange,
  revertPlan,
  shouldApply,
  type VerifyContext,
} from './verify';
import { makeCheck, makeFlight, makeLeg, t, withArrival } from './__tests__/fixtures';

const NOW = Date.parse('2026-12-12T09:00:00Z');
const COPY = { t, lang: 'en' as const };
const REV = '2026-12-13|17:00|2|2026-12-13|23:10';
const AT = '2026-12-12T08:48:00.000Z';

const ctx: VerifyContext = {
  nowMs: NOW,
  inWindow: true,
  past: false,
  departed: false,
  enabled: true,
  entitled: true,
  configured: true,
  online: true,
  minIntervalMs: 30 * 60_000,
};

function apply(seg: VacationTravelSegment, leg: FlightLeg, nowMs = NOW): VacationTravelSegment {
  if (!shouldApply(seg, leg)) return seg;
  return { ...seg, ...planChange(seg, leg, undefined, nowMs, COPY) };
}

/** The store's `noticeKey` for a change not yet written (its unapplied-change branch). */
function unwrittenId(seg: VacationTravelSegment, v: FlightVerification): string {
  return noticeRevAfterWrite(seg, v.provider!);
}

/** The id a change's notice had before `liveWas.noticeRev` existed (`noticeRevision`'s
 *  fallback), read off the same live fields. */
function legacyId(seg: VacationTravelSegment): string {
  return changeNoticeRevision(
    seg.liveRevision!,
    seg.liveArrivalTerminal,
    tupleFromWas(seg.liveWas)
  );
}

function departure(seg: VacationTravelSegment) {
  return extractSegmentOccurrences('vac-1', seg, 0, ['mum']).find((o) => o.kind === 'departure')!;
}

describe('noticeRevision: identity and pushable', () => {
  it('a 5-part change keeps its revision as the id, and a push could have been it', () => {
    expect(
      noticeRevision({
        liveRevision: REV,
        liveArrivalTerminal: 'SQ318|2026-12-13|3',
        liveWas: { departureTime: '16:00', at: AT },
        liveAppliedAt: AT,
      })
    ).toEqual({ kind: 'changed', revision: REV, pushable: true, atMs: Date.parse(AT) });
  });

  it('an arrival-terminal-only change is its own notice, and never a push', () => {
    expect(
      noticeRevision({
        liveRevision: REV,
        liveArrivalTerminal: 'SQ318|2026-12-13|3',
        liveWas: { arrivalTerminal: '2', at: AT },
        liveAppliedAt: AT,
      })
    ).toEqual({
      kind: 'changed',
      revision: `${REV}~SQ318|2026-12-13|3`,
      pushable: false,
      atMs: Date.parse(AT),
    });
  });

  it('a mixed change could have been a push', () => {
    expect(
      noticeRevision({
        liveRevision: REV,
        liveArrivalTerminal: 'SQ318|2026-12-13|3',
        liveWas: { departureTime: '16:00', arrivalTerminal: '2', at: AT },
        liveAppliedAt: AT,
      })
    ).toMatchObject({ revision: `${REV}~SQ318|2026-12-13|3`, pushable: true });
  });

  it('a cancellation could have been a push', () => {
    expect(noticeRevision({ liveRevision: `${REV}|cancelled`, liveCancelledAt: AT })).toMatchObject(
      { kind: 'cancelled', revision: `${REV}|cancelled@${AT}`, pushable: true }
    );
  });
});

describe('the notice id across the arrival terminal', () => {
  /** The airline moved SQ318 to 18:30 from Terminal 3, and the plan took it. */
  const moved = makeLeg({
    dep: {
      scheduledLocal: '2026-12-13 18:30+08:00',
      scheduledUtc: '2026-12-13 10:30Z',
      terminal: '3',
    },
  });

  it('a quiet arrival-terminal fill changes no existing notice id (no dismissed notice returns)', () => {
    const applied = apply(makeFlight(), moved);
    const before = liveNoticeId('seg-1', applied);
    expect(before).toBe(travelChangeId('seg-1', applied.liveRevision!));
    const filled = apply(applied, withArrival(moved, '2'));
    expect(filled.liveArrivalTerminal).toBe('SQ318|2026-12-13|2');
    expect(liveNoticeId('seg-1', filled)).toBe(before);
    expect(occurrenceNotice(t, departure(filled))?.message).toBe(
      'SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.'
    );
  });

  it('a moved arrival terminal has one id before it is written and after', () => {
    const filled = apply(makeFlight(), withArrival(makeLeg({}), '2'));
    const leg = withArrival(makeLeg({}), 'T3');
    const v = deriveVerification(
      filled,
      makeCheck(leg, { planRecord: liveRecordOf(filled) }),
      undefined,
      ctx
    );
    expect(v).toMatchObject({ state: 'changed', applied: false });
    // No revision stored (the first answer only filled the arrival terminal): the change
    // records the airline's, so its notice has an id at all.
    expect(filled.liveRevision).toBeUndefined();
    const unwritten = unwrittenId(filled, v);
    const written = apply(filled, leg);
    expect(written.liveRevision).toBe(revisionOf(tupleFromLeg(leg)));
    expect(noticeRevision(written)?.revision).toBe(unwritten);
    expect(unwritten).toBe(`${revisionOf(tupleFromLeg(leg))}~SQ318|2026-12-13|3`);
  });

  it('a moved arrival terminal on a plan left on an older revision keeps that revision and one id', () => {
    // Applied at R2 (with the arrival terminal already recorded), put back, then the airline
    // returns to R1 and moves the arrival terminal.
    const filled = apply(makeFlight(), withArrival(makeLeg({}), '2'));
    const applied = apply(filled, withArrival(moved, '2'));
    const r2 = applied.liveRevision!;
    const back = { ...applied, ...revertPlan(applied) };
    const leg = withArrival(makeLeg({}), '3');
    expect(revisionOf(tupleFromLeg(leg))).not.toBe(r2);
    const v = deriveVerification(
      back,
      makeCheck(leg, { planRecord: liveRecordOf(back) }),
      undefined,
      ctx
    );
    expect(v).toMatchObject({ state: 'changed', applied: false, was: { arrivalTerminal: '2' } });
    const unwritten = unwrittenId(back, v);
    const written = apply(back, leg);
    expect(written.liveRevision).toBe(r2);
    expect(noticeRevision(written)?.revision).toBe(unwritten);
    // The plan already carries the change to R2 (its `liveWas`), so this is the flight's
    // second change: its own id, `#2`, never the first one's.
    expect(unwritten).toBe(`${r2}~SQ318|2026-12-13|3#2`);
    expect(occurrenceNotice(t, departure(written))?.message).toBe(
      'SQ318 now arrives at Terminal 3. Your plan has been updated.'
    );
  });

  it('the bell and briefing sentence for an arrival-terminal change names the arrival end', () => {
    const filled = apply(makeFlight(), withArrival(makeLeg({}), '2'));
    const notice = occurrenceNotice(t, departure(apply(filled, withArrival(makeLeg({}), '3'))));
    expect(notice).toMatchObject({
      kind: 'changed',
      pushable: false,
      flight: 'SQ318',
      message: 'SQ318 now arrives at Terminal 3. Your plan has been updated.',
      was: 'Was arriving at Terminal 2',
    });
  });
});

describe('a change notice keeps one identity, and each change has its own', () => {
  /** The airline moved the time; no departure terminal published yet. */
  const timeOnly = makeLeg({
    dep: {
      scheduledLocal: '2026-12-13 18:30+08:00',
      scheduledUtc: '2026-12-13 10:30Z',
      terminal: undefined,
    },
  });
  const terminal = (dep: string): FlightLeg => makeLeg({ dep: { terminal: dep } });
  /** The answer as the device holds it beside this plan (seen, so never superseded). */
  const verifyOn = (seg: VacationTravelSegment, leg: FlightLeg) =>
    deriveVerification(seg, makeCheck(leg, { planRecord: liveRecordOf(seg) }), undefined, ctx);

  it("a first change's id has today's format, frozen into liveWas", () => {
    const applied = apply(makeFlight(), terminal('3'));
    expect(applied.liveWas?.noticeRev).toBe(applied.liveRevision);
    expect(noticeRevision(applied)?.revision).toBe(legacyId(applied));
    expect(liveNoticeId('seg-1', applied)).toBe(travelChangeId('seg-1', applied.liveRevision!));
  });

  it('a later quiet fill of the departure terminal or the arrival terminal never moves the id', () => {
    const applied = apply(makeFlight({ terminal: undefined }), timeOnly);
    const id = liveNoticeId('seg-1', applied);
    expect(id).toBe(travelChangeId('seg-1', revisionOf(tupleFromLeg(timeOnly))));

    const depFilled = apply(applied, {
      ...timeOnly,
      departure: { ...timeOnly.departure, terminal: '3' },
    });
    expect(depFilled.terminal).toBe('3');
    expect(depFilled.liveRevision).not.toBe(applied.liveRevision);
    // The rule the id used to follow would have moved it, reopening a dismissed notice.
    expect(legacyId(depFilled)).not.toBe(legacyId(applied));
    expect(liveNoticeId('seg-1', depFilled)).toBe(id);

    const arrFilled = apply(
      depFilled,
      withArrival({ ...timeOnly, departure: { ...timeOnly.departure, terminal: '3' } }, '2')
    );
    expect(arrFilled.liveArrivalTerminal).toBe('SQ318|2026-12-13|2');
    expect(liveNoticeId('seg-1', arrFilled)).toBe(id);
    expect(arrFilled.liveWas).toEqual(applied.liveWas);
  });

  it("a change written without noticeRev (an older build) keeps today's id", () => {
    const applied = apply(makeFlight(), terminal('3'));
    for (const noticeRev of [undefined, '', 7 as unknown as string]) {
      const older = { ...applied, liveWas: { ...applied.liveWas!, noticeRev } };
      expect(noticeRevision(older)?.revision).toBe(legacyId(older));
    }
  });

  it('T2, T3, T2, T3: four distinct ids, the same on two devices, one before and after each write', () => {
    let plan = makeFlight();
    const ids: string[] = [];
    for (const [i, dep] of (['3', '2', '3', '2'] as const).entries()) {
      const leg = terminal(dep);
      const v = verifyOn(plan, leg);
      expect(v).toMatchObject({ state: 'changed', applied: false });
      const before = unwrittenId(plan, v);
      // Two devices apply the same answer from the same synced plan, seconds apart.
      const here = apply(plan, leg, NOW + i * 60_000);
      const there = apply(plan, leg, NOW + i * 60_000 + 7_000);
      expect(noticeRevision(here)?.revision).toBe(before);
      expect(noticeRevision(there)?.revision).toBe(before);
      ids.push(before);
      plan = here;
    }
    expect(new Set(ids).size).toBe(4);
    const r3 = revisionOf(tupleFromLeg(terminal('3')));
    const r2 = revisionOf(tupleFromLeg(terminal('2')));
    expect(ids).toEqual([r3, `${r2}#2`, `${r3}#3`, `${r2}#4`]);
  });

  it('a change on top of one written without noticeRev is the second occurrence', () => {
    const applied = apply(makeFlight(), terminal('3'));
    const older = { ...applied, liveWas: { ...applied.liveWas!, noticeRev: undefined } };
    const next = apply(older, terminal('2'));
    expect(next.liveWas?.noticeRev).toBe(`${revisionOf(tupleFromLeg(terminal('2')))}#2`);
  });

  it('noticeRev survives "Put it back" untouched, and the schedule tuple never reads it', () => {
    const applied = apply(makeFlight(), terminal('3'));
    const patch = revertPlan(applied);
    expect(patch).not.toHaveProperty('noticeRev');
    expect(patch).not.toHaveProperty('liveWas');
    const back = { ...applied, ...patch };
    expect(back.terminal).toBe('Terminal 2');
    expect(back.liveWas?.noticeRev).toBe(applied.liveWas?.noticeRev);
    expect(liveNoticeId('seg-1', back)).toBe(liveNoticeId('seg-1', applied));
    expect(tupleFromWas(applied.liveWas)).toEqual({ terminal: 'Terminal 2' });
  });
});
