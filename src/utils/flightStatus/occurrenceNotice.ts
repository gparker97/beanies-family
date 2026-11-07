/**
 * Live flight checks (#143): the change / cancellation an airline made, read off ONE departure
 * occurrence. The briefing row, the bell entry and the OS notification all call this, so the
 * three surfaces cannot disagree about whether a flight changed, what to say, or which revision
 * the notice belongs to.
 *
 * Pure: the translator comes first (the `copy.ts` convention) and nothing is logged.
 */
import type { LanguageCode } from '@/types/models';
import type { TranslateFn } from '@/utils/format';
import { flightCodeLabel, type TravelSegmentOccurrence } from '@/utils/vacation';
import { normaliseFlightNumber } from './flightNumber';
import { cancelSentence, changeSentence, wasLine } from './copy';
import { tupleFromWas } from './schedule';
import { isCancelRevision } from './verify';

/** An airline change stays "news" on the briefing for this long after it was applied. */
export const CHANGE_NEWS_MS = 24 * 60 * 60 * 1000;

export interface OccurrenceNotice {
  kind: 'changed' | 'cancelled';
  /**
   * The identity the notice is keyed on (the bell and OS ids, the briefing row id). A change:
   * `liveRevision` (never `liveAppliedAt`: devices differ by seconds). A cancellation:
   * `liveRevision@liveCancelledAt`, because cancel → reinstate → cancel again reproduces the
   * same cancel revision, and only the stamp (written once, by the device that recorded it,
   * then synced) tells the second cancellation from the first.
   */
  revision: string;
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
  return (
    normaliseFlightNumber(o.airline, o.flightNumber)?.query ||
    flightCodeLabel(o.airline, o.flightNumber) ||
    o.title
  );
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
 * (`CHANGE_NEWS_MS` for the briefing, a rolling window for the bell, an hour for the OS).
 */
export function occurrenceNotice(
  t: TranslateFn,
  o: TravelSegmentOccurrence,
  lang?: LanguageCode
): OccurrenceNotice | null {
  const live = o.live;
  if (o.kind !== 'departure' || !live) return null;
  const flight = flightLabel(o);
  const cancelledMs = parseMs(live.liveCancelledAt);
  if (cancelledMs !== null && isCancelRevision(live.liveRevision)) {
    const airline = o.airline?.replace(/\s*\([A-Z0-9]{2,3}\)\s*$/, '').trim();
    return {
      kind: 'cancelled',
      revision: `${live.liveRevision!}@${live.liveCancelledAt!}`,
      atMs: cancelledMs,
      flight,
      message: cancelSentence(t, { airline, flight, date: o.date }, lang),
      was: '',
    };
  }
  const appliedMs = parseMs(live.liveAppliedAt);
  const was = tupleFromWas(live.liveWas);
  if (appliedMs === null || !was || !live.liveRevision) return null;
  return {
    kind: 'changed',
    revision: live.liveRevision,
    atMs: appliedMs,
    flight,
    message: changeSentence(t, flight, o.schedule ?? {}, was, lang),
    was: wasLine(t, was, lang),
  };
}
