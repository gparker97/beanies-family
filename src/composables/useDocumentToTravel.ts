// Wedge orchestration (ADR-030, #30): travel document → extraction → resolved segment buckets
// + trip target, handed to the review modal. Kept THIN — file intake (incl. PDF→image
// rasterization), the extraction call, the pure mapper, and the pure trip-target resolution.
// Consent is gated by the CALLER (TravelPlansPage) before the picker opens; nothing here runs
// until a document is picked, which only happens post-consent. No persistence, no rules — the
// page receives a fully-decided payload and the review modal confirms it.
//
// Every outcome is explicit and non-silent: offline is guarded; PDF rasterization failures and
// every extraction error code map to an informative toast (the shared mapping with #133).

import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { useVacationStore } from '@/stores/vacationStore';
import {
  inferTripType,
  travelExtractionToSegments,
  type SegmentBuckets,
} from '@/utils/travelExtractionToSegments';
import { resolveTripTarget, segmentDateRange, tripsOverlappingRange } from '@/utils/vacation';
import type { TripTarget } from '@/utils/vacation';
import type { ResultEnvelope } from '@/types/magicPayload';
import type { TravelExtractionResult } from '@/services/ai/types';
import { toDateInputValue } from '@/utils/date';
import type { VacationTripType } from '@/types/models';

export interface TravelReady {
  /** The mapped segment buckets, ready to attach or seed a new trip. */
  buckets: SegmentBuckets;
  /** Normalized traveller names per segment id — resolved to members after the user confirms. */
  travellerNamesBySegmentId: Record<string, string[]>;
  /** The distinct normalized traveller names across the whole document (for the mapping UI). */
  distinctTravellerNames: string[];
  /** Inferred trip type for the new-trip case. */
  tripType: VacationTripType;
  /** Where the segments should go (create / attach / choose) — pre-decided, pure. */
  target: TripTarget;
  /** Suggested destination-based name for the new-trip case (may be ''). */
  suggestedTripName: string;
  /** The ORIGINAL uploaded file (image or PDF), attached to the created segment(s). */
  sourceFile: File | null;
  /**
   * The envelope this result arrived in, carried whole so the review modal can offer the free
   * correction (`MagicMiscategorisedBanner` needs the prepared source and the grant).
   *
   * Deliberately NOT flattened into more fields beside `sourceFile`: that is how this shape
   * came to carry a copy of one envelope field and nothing else, and a second copied field is
   * a second thing to keep in step by hand.
   */
  env: ResultEnvelope;
}

export interface UseDocumentToTravelOptions {
  /**
   * Called once extraction succeeds with a non-empty travel result (so the page can open the
   * review modal). Nothing is auto-created. Single options object — expected to grow.
   */
  onTravelReady: (ready: TravelReady) => void;
}

/** kebab-case and greppable: one CloudWatch filter isolates this feature. */
const SURFACE = 'travel-extract';

export function useDocumentToTravel(options: UseDocumentToTravelOptions) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const vacationStore = useVacationStore();

  /** Run intake → (rasterize) → extract → map → resolve for one document (consent granted). */
  /**
   * The post-extraction half: notices, mapping, target resolution and the hand-off to the
   * review modal.
   *
   * Split out of `processFile` (#64) so a SHARED document can be delivered without a second
   * AI call. In-app behaviour is unchanged: `processFile` calls this.
   */
  /**
   * Wrap a delivery so a throw cannot vanish.
   *
   * `deliverX` is called from TWO places: `processFile`, which has a try/catch around it,
   * and the magic-reader consumer, which is a Vue WATCH callback with no catch anywhere in
   * the chain. Splitting the mapping out of `processFile` moved it out from under that catch
   * — the same shape as the incident the catch was originally added for: the spinner clears,
   * the modal never opens, the user is told nothing and CloudWatch records nothing.
   */
  function deliverTravel(data: TravelExtractionResult, env: ResultEnvelope): void {
    try {
      deliverTravelInner(data, env);
    } catch (err) {
      reportError({
        surface: SURFACE,
        message: 'delivering an extracted travel document threw',
        severity: 'error',
        error: err,
        context: { action: 'threw' },
      });
      showToast('error', t('ai.error.title'), t('ai.error.generic'));
    }
  }

  function deliverTravelInner(data: TravelExtractionResult, env: ResultEnvelope): void {
    // Loud-but-non-blocking notice FIRST — before the not-travel early return — so a >cap
    // document whose bookings sat on a dropped page still tells the user (never silent).
    if (env.truncated) {
      showToast('info', t('ai.pdfTruncated.title'), t('ai.pdfTruncated.message'));
    }
    if (!data.isTravel || data.segments.length === 0) {
      // Not recognised as a travel document — friendly info toast, nothing created.
      showToast('info', t('ai.notTravel.title'), t('ai.notTravel.message'));
      return;
    }

    // Map to segment buckets + carry the normalized per-segment traveller NAMES through to
    // the review modal, where the user confirms each name→member mapping (identity matching
    // is local; the roster is never sent to the model).
    const { buckets, travellerNamesBySegmentId } = travelExtractionToSegments(data);
    const distinctTravellerNames = [...new Set(Object.values(travellerNamesBySegmentId).flat())];
    const range = segmentDateRange(buckets);
    const matches = range
      ? tripsOverlappingRange(vacationStore.vacations, range, toDateInputValue(new Date()))
      : [];

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'travel document ready for review',
      context: {
        action: 'ready',
        segment_count:
          buckets.travelSegments.length +
          buckets.accommodations.length +
          buckets.transportation.length,
        target_kind: resolveTripTarget(matches).kind,
      },
    });
    options.onTravelReady({
      buckets,
      travellerNamesBySegmentId,
      distinctTravellerNames,
      tripType: inferTripType(data),
      target: resolveTripTarget(matches),
      suggestedTripName: data.tripName,
      sourceFile: env.sourceFile, // attach the ORIGINAL (PDF stays a PDF)
      env,
    });
  }

  return { deliverTravel };
}
