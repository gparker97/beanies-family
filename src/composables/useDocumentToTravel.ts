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
import { ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import { useVacationStore } from '@/stores/vacationStore';
import { extractTravelFromDocument } from '@/services/ai/documentExtractionService';
import {
  inferTripType,
  travelExtractionToSegments,
  type SegmentBuckets,
} from '@/utils/travelExtractionToSegments';
import { resolveTripTarget, segmentDateRange, tripsOverlappingRange } from '@/utils/vacation';
import type { TripTarget } from '@/utils/vacation';
import type { ConsentGrant } from './useDocumentConsent';
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
  sourceFile: File;
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
  const { tier, byokConfig } = useAiCapability();
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  const vacationStore = useVacationStore();

  const isProcessing = ref(false);

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
    });
  }

  async function processFile(file: File, grant: ConsentGrant): Promise<void> {
    if (isProcessing.value) return; // ignore a second pick while one is in flight

    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    isProcessing.value = true;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'travel capture started',
      // The SUCCESS path is instrumented too, so a failure RATE is computable. An event that
      // only fires on failure has no denominator.
      context: { action: 'start' },
    });
    try {
      // The service owns document preparation: a PDF is rasterized to its first pages (up
      // to MAX_EXTRACT_PAGES) and a photo is used as-is, then each page is compressed. The
      // ORIGINAL file is still attached below, so the full PDF is never lost. Preparation
      // failures come back classified as `compression`, never silent.
      const result = await extractTravelFromDocument(file, {
        tier: tier.value,
        // Local YYYY-MM-DD so the model resolves relative dates against the user's calendar
        // date and the proxy's date validation passes.
        todayIso: toDateInputValue(new Date()),
        byok: byokConfig.value ?? undefined,
        grant,
      });

      if (result.success && result.data) {
        deliverTravel(result.data, {
          sourceFile: file,
          compressedBlob: result.compressedBlob,
          truncated: result.truncated,
        });
        return;
      }

      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'travel extraction failed',
        context: { action: 'failed', error_code: result.errorCode },
      });
      reportExtractionFailure(result.errorCode);
    } catch (err) {
      // NO SILENT FAILURES (docs/lessons.md, CLAUDE.md § Observability). This was try/finally
      // with NO catch, and the only caller does `void processTravelDoc(f)` — so any throw in
      // travelExtractionToSegments, inferTripType or resolveTripTarget became an unhandled
      // rejection: the spinner cleared, the review modal never opened, the user was told
      // nothing, and CloudWatch recorded nothing. The whole travel surface emitted ZERO
      // diagnostic events, against a rule the project calls mandatory.
      reportError({
        surface: SURFACE,
        message: 'travel document processing threw',
        severity: 'error',
        error: err,
        context: { action: 'threw' },
      });
      showToast('error', t('ai.error.title'), t('ai.error.generic'));
    } finally {
      isProcessing.value = false;
    }
  }

  return { isProcessing, processFile, deliverTravel };
}
