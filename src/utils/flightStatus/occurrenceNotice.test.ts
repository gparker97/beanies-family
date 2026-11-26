import { describe, expect, it } from 'vitest';
import type { FlightLeg, FlightVerification, ScheduleTuple } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { extractSegmentOccurrences } from '@/utils/vacation';
import { liveNoticeId, travelChangeId } from '@/utils/notifications/travel';
import { changeNoticeRevision, noticeRevision, occurrenceNotice } from './occurrenceNotice';
import { arrivalTerminalRecord, revisionOf, tupleFromLeg } from './schedule';
import {
  deriveVerification,
  planChange,
  revertPlan,
  revisionAfterWrite,
  shouldApply,
  type VerifyContext,
} from './verify';
import { makeCheck, makeFlight, makeLeg, t } from './__tests__/fixtures';

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

const withArrival = (leg: FlightLeg, terminal: string): FlightLeg => ({
  ...leg,
  arrival: { ...leg.arrival, terminal },
});

function apply(seg: VacationTravelSegment, leg: FlightLeg): VacationTravelSegment {
  if (!shouldApply(seg, leg)) return seg;
  return { ...seg, ...planChange(seg, leg, undefined, NOW, COPY) };
}

/** The store's `noticeKey` for a change not yet written (its unapplied-change branch). */
function unwrittenId(seg: VacationTravelSegment, v: FlightVerification): string {
  return changeNoticeRevision(
    revisionAfterWrite(seg, v.provider!) ?? revisionOf(v.provider!),
    arrivalTerminalRecord(seg, v.provider!),
    v.was
  );
}

function departure(seg: VacationTravelSegment) {
  return extractSegmentOccurrences('vac-1', seg, 0, ['mum']).find((o) => o.kind === 'departure')!;
}

describe('changeNoticeRevision', () => {
  it('is the revision, plus the arrival terminal only when it moved', () => {
    expect(changeNoticeRevision(REV, '3', undefined)).toBe(REV);
    const departureOnly: ScheduleTuple = { departureTime: '17:00' };
    expect(changeNoticeRevision(REV, '3', departureOnly)).toBe(REV);
    expect(changeNoticeRevision(REV, '3', { arrivalTerminal: '2' })).toBe(`${REV}~3`);
    expect(changeNoticeRevision(REV, undefined, { arrivalTerminal: '2' })).toBe(`${REV}~`);
  });
});

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
    const v = deriveVerification(filled, makeCheck(leg), undefined, ctx);
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
    const v = deriveVerification(back, makeCheck(leg), undefined, ctx);
    expect(v).toMatchObject({ state: 'changed', applied: false, was: { arrivalTerminal: '2' } });
    const unwritten = unwrittenId(back, v);
    const written = apply(back, leg);
    expect(written.liveRevision).toBe(r2);
    expect(noticeRevision(written)?.revision).toBe(unwritten);
    expect(unwritten).toBe(`${r2}~SQ318|2026-12-13|3`);
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
