/**
 * Live flight checks (#143): the change / cancellation an airline made, read off ONE departure
 * occurrence. The briefing row, the bell entry and the OS notification all call this, so the
 * three surfaces cannot disagree about whether a flight changed, what to say, or which revision
 * the notice belongs to.
 *
 * Pure: the translator comes first (the `copy.ts` convention) and nothing is logged.
 */
import type { LanguageCode, SegmentLiveState } from '@/types/models';
import type { ScheduleTuple } from '@/types/flightStatus';
import type { TranslateFn } from '@/utils/format';
import { flightCode, type TravelSegmentOccurrence } from '@/utils/vacation';
import { cancelSentence, changeSentence, wasLine } from './copy';
import { REVISION_FIELDS, tupleFromWas } from './schedule';
import { isCancelRevision } from './verify';

/** An airline change stays "news" on the briefing for this long after it was applied. */
export const CHANGE_NEWS_MS = 24 * 60 * 60 * 1000;

export interface OccurrenceNotice {
  kind: 'changed' | 'cancelled';
  /**
   * The identity the notice is keyed on (the bell and OS ids, the briefing row id). A change:
   * `liveRevision` (never `liveAppliedAt`: devices differ by seconds), plus the arrival
   * terminal when it moved (`changeNoticeRevision`). A cancellation:
   * `liveRevision@liveCancelledAt`, because cancel → reinstate → cancel again reproduces the
   * same cancel revision, and only the stamp (written once, by the device that recorded it,
   * then synced) tells the second cancellation from the first.
   */
  revision: string;
  /**
   * Could the closed-app push have been this notice? True for a cancellation, and for a
   * change that moved at least one of the five `REVISION_FIELDS`: the server pushes only a new
   * revision, never an arrival-terminal-only change, so such a notice must never be muted as
   * "the push already told them" (`flightStatusStore.noticeFirstSeen`).
   */
  pushable: boolean;
  /** Epoch ms the airline's word was written to the plan. */
  atMs: number;
  /** "SQ318": the flight as the family would say it. */
  flight: string;
  /** The notice sentence ("SQ318 now leaves at 18:30 ..." / "Singapore Airlines cancelled ..."). */
  message: string;
  /** "Was 17:00 from Terminal 2", '' for a cancellation or when nothing was recorded. */
  was: string;
}

/** The flight's code as written on the booking: "SQ318"; the segment title when there is none. */
export function flightLabel(
  o: Pick<TravelSegmentOccurrence, 'airline' | 'flightNumber' | 'title'>
): string {
  return flightCode(o.airline, o.flightNumber) || o.title;
}

function parseMs(iso: string | undefined): number | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The change or cancellation this departure occurrence carries, or null. A cancellation counts
 * only while it is RECORDED (the cancel marker on `liveRevision`, `isCancelRevision`), so a
 * reinstated flight raises no new cancel notice; `liveCancelledAt` (which a reinstatement
 * leaves set) is only its timestamp. A recorded cancellation wins over an earlier change; a
 * change counts only when it carries the values it replaced.
 * `nowMs` is not consulted: how long a notice stays news is each surface's own rule
 * (`CHANGE_NEWS_MS` for the briefing, a rolling window for the bell, 24 hours for the OS).
 */
export function occurrenceNotice(
  t: TranslateFn,
  o: TravelSegmentOccurrence,
  lang?: LanguageCode
): OccurrenceNotice | null {
  if (o.kind !== 'departure') return null;
  const key = noticeRevision(o.live);
  if (!key) return null;
  const flight = flightLabel(o);
  if (key.kind === 'cancelled') {
    const airline = o.airline?.replace(/\s*\([A-Z0-9]{2,3}\)\s*$/, '').trim();
    return {
      ...key,
      flight,
      message: cancelSentence(t, { airline, flight, date: o.date }, lang),
      was: '',
    };
  }
  const was = tupleFromWas(o.live?.liveWas)!;
  return {
    ...key,
    flight,
    message: changeSentence(t, flight, o.schedule ?? {}, was, lang),
    was: wasLine(t, was, lang),
  };
}

/**
 * A change notice's identity: the revision, plus `~<arrival terminal record>` only when the
 * arrival terminal moved (`was.arrivalTerminal` is set). A quiet arrival-terminal fill
 * therefore changes no existing notice id, while a moved arrival terminal (the revision
 * unchanged) is a new notice. `record` is `liveArrivalTerminal`'s form (`arrivalTerminalRecord`;
 * a caller holding a provider answer builds it from that), appended as is, so the id is the
 * same before the change is written (the store's `noticeKey`) and after (`noticeRevision`).
 */
export function changeNoticeRevision(
  revision: string,
  record: string | undefined,
  was: Pick<ScheduleTuple, 'arrivalTerminal'> | undefined
): string {
  return was?.arrivalTerminal !== undefined ? `${revision}~${record ?? ''}` : revision;
}

/**
 * The identity of the notice a segment's synced live fields carry right now (see
 * `OccurrenceNotice.revision` for the keying rules), or null when there is nothing to tell.
 * The one place that rule lives: the bell/OS ids, the briefing row and the device-side
 * dismissal (`flightStatusStore.dismissNotice`) all key on it, so a new airline revision is
 * a new notice everywhere at once.
 */
export function noticeRevision(
  live: SegmentLiveState | undefined
): Pick<OccurrenceNotice, 'kind' | 'revision' | 'pushable' | 'atMs'> | null {
  if (!live) return null;
  const cancelledMs = parseMs(live.liveCancelledAt);
  if (cancelledMs !== null && isCancelRevision(live.liveRevision)) {
    return {
      kind: 'cancelled',
      revision: `${live.liveRevision!}@${live.liveCancelledAt!}`,
      pushable: true,
      atMs: cancelledMs,
    };
  }
  const appliedMs = parseMs(live.liveAppliedAt);
  const was = tupleFromWas(live.liveWas);
  if (appliedMs === null || !was || !live.liveRevision) return null;
  return {
    kind: 'changed',
    revision: changeNoticeRevision(live.liveRevision, live.liveArrivalTerminal, was),
    pushable: REVISION_FIELDS.some((f) => was[f] !== undefined),
    atMs: appliedMs,
  };
}
