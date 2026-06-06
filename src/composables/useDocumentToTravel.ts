// Wedge orchestration (ADR-030, #30): travel document → extraction → resolved segment buckets
// + trip target, handed to the review modal. Kept THIN — file intake (incl. PDF→image
// rasterization), the extraction call, the pure mapper, and the pure trip-target resolution.
// Consent is gated by the CALLER (TravelPlansPage) before the picker opens; nothing here runs
// until a document is picked, which only happens post-consent. No persistence, no rules — the
// page receives a fully-decided payload and the review modal confirms it.
//
// Every outcome is explicit and non-silent: offline is guarded; PDF rasterization failures and
// every extraction error code map to an informative toast (the shared mapping with #133).

import { ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import { useVacationStore } from '@/stores/vacationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { extractTravelFromDocument } from '@/services/ai/documentExtractionService';
import {
  inferTripType,
  travelExtractionToSegments,
  type SegmentBuckets,
} from '@/utils/travelExtractionToSegments';
import { matchTravellerIds } from '@/utils/segmentTravellers';
import { resolveTripTarget, segmentDateRange, tripsOverlappingRange } from '@/utils/vacation';
import type { TripTarget } from '@/utils/vacation';
import { isPdfFile, pdfFirstPageToImage } from '@/utils/pdfFirstPageToImage';
import { toDateInputValue } from '@/utils/date';
import type { VacationTripType } from '@/types/models';

export interface TravelReady {
  /** The mapped segment buckets, ready to attach or seed a new trip. */
  buckets: SegmentBuckets;
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

export function useDocumentToTravel(options: UseDocumentToTravelOptions) {
  const { tier, byokConfig } = useAiCapability();
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  const vacationStore = useVacationStore();
  const familyStore = useFamilyStore();

  const isProcessing = ref(false);

  /** Run intake → (rasterize) → extract → map → resolve for one document (consent granted). */
  async function processFile(file: File): Promise<void> {
    if (isProcessing.value) return; // ignore a second pick while one is in flight

    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    isProcessing.value = true;
    try {
      // PDFs must be rasterized (page 1) to an image for the image-only extraction proxy.
      // A rasterization failure is surfaced through the shared reporter (compression bucket),
      // never silently swallowed.
      let extractFile = file;
      if (isPdfFile(file)) {
        try {
          extractFile = await pdfFirstPageToImage(file);
        } catch (err) {
          console.error('[travel-extract] PDF rasterization failed:', err);
          reportExtractionFailure('compression');
          return;
        }
      }

      const result = await extractTravelFromDocument(extractFile, {
        tier: tier.value,
        // Local YYYY-MM-DD so the model resolves relative dates against the user's calendar
        // date and the proxy's date validation passes.
        todayIso: toDateInputValue(new Date()),
        byok: byokConfig.value ?? undefined,
      });

      if (result.success && result.data) {
        if (!result.data.isTravel || result.data.segments.length === 0) {
          // Not recognised as a travel document — friendly info toast, nothing created.
          showToast('info', t('ai.notTravel.title'), t('ai.notTravel.message'));
          return;
        }

        // Match the model's per-segment traveller NAMES to family members (humans only).
        const buckets = travelExtractionToSegments(result.data, (names) =>
          matchTravellerIds(names, familyStore.sortedHumans)
        );
        const range = segmentDateRange(buckets);
        const matches = range
          ? tripsOverlappingRange(vacationStore.vacations, range, toDateInputValue(new Date()))
          : [];

        options.onTravelReady({
          buckets,
          tripType: inferTripType(result.data),
          target: resolveTripTarget(matches),
          suggestedTripName: result.data.tripName,
          sourceFile: file, // attach the ORIGINAL (PDF stays a PDF)
        });
        return;
      }

      reportExtractionFailure(result.errorCode);
    } finally {
      isProcessing.value = false;
    }
  }

  return { isProcessing, processFile };
}
