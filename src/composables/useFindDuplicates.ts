/**
 * ✨ Find Duplicates (#116): ask magic beans which lines of a shopping list being built from the
 * week's recipes are the same item written differently.
 *
 * WHAT IS SENT. Only `{ id, text }` per line: the ingredient text as written and an opaque id
 * (`L1…LN`). No recipe names, dates or who's eating. That is still family data, so it is
 * ADR-030's named exception of 2026-09-30 and it is gated by the `ingredients` consent variant,
 * which only its OWN "don't ask again" skips (a list is not a document, `useDocumentConsent`).
 *
 * WHAT COMES BACK. Groups of ids plus a short name, never an amount. Which ids are real, and which
 * line a group may claim, is the caller's decision against the list it holds (`shoppingMerge.ts`).
 *
 * FREE. The ai-extract Lambda counts a `dedupe` read on its own free attribute while the sealed
 * request stays under `FREE_TASK_MAX_BYTES` (`meter.mjs`). That bound is derived from
 * `DEDUPE_MAX_PAYLOAD_BYTES` (`@/utils/dedupePayload`, which owns the wire format), and
 * `lambdaContractParity.test.ts` proves the worst case fits, so the UI's candidate builder must
 * stay within that bound or the read is charged.
 *
 * STALE RESULTS. The drawer passes its own `AbortController` for this open. Closing the drawer
 * aborts it; any await that returns into an aborted run yields `'stale'`: no toast, no event, and
 * nothing for the caller to apply.
 */
import { readonly, ref, type Ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { requestConsent } from './useDocumentConsent';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import { resolveBillableFamilyId } from './useMagicBeanScope';
import { useOnline } from './useOnline';
import type { IngestEnv } from './useSharedDocumentIngest';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { findDuplicatesInText } from '@/services/ai/documentExtractionService';
import { logEvent } from '@/services/telemetry/logEvent';
import { dedupePayload, type DedupeGroup, type DedupeLine } from '@/utils/dedupePayload';

const SURFACE = 'meal-shopping-dupes';

/** Not a magic-beans door, so its own surface: one CloudWatch filter isolates this feature. */
const DEDUPE_ENV: IngestEnv = { surface: SURFACE, origin: 'in-app' };

export type FindDuplicatesStatus = 'done' | 'declined' | 'failed' | 'offline' | 'stale';

/** Diagnostics about the payload, for telemetry only; never sent. */
export interface FindDuplicatesMeta {
  /** Eligible lines the caller left out to stay within the free byte bound. */
  skipped?: number;
}

export function useFindDuplicates(): {
  running: Readonly<Ref<boolean>>;
  find(
    lines: DedupeLine[],
    controller: AbortController,
    meta?: FindDuplicatesMeta
  ): Promise<{ status: FindDuplicatesStatus; groups: DedupeGroup[] }>;
} {
  const { extractOptions } = useAiCapability();
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();

  /** True from the tap until the outcome, consent included, so a second tap cannot start a run. */
  const running = ref(false);

  async function find(
    lines: DedupeLine[],
    controller: AbortController,
    { skipped = 0 }: FindDuplicatesMeta = {}
  ): Promise<{ status: FindDuplicatesStatus; groups: DedupeGroup[] }> {
    const outcome = (status: FindDuplicatesStatus, groups: DedupeGroup[] = []) => ({
      status,
      groups,
    });
    // The drawer already closed, or a run is already in flight for it: this tap did nothing,
    // so it has no outcome to report.
    if (controller.signal.aborted || running.value) return outcome('stale');

    running.value = true;
    try {
      // Both refusals come BEFORE consent, so an offline or unattributable tap never prompts.
      if (!isOnline.value) {
        showToast('info', t('ai.offline.title'), t('ai.offline.message'));
        return outcome('offline');
      }
      // A null has already logged and toasted (`resolveBillableFamilyId`'s contract).
      const familyId = resolveBillableFamilyId(DEDUPE_ENV);
      if (!familyId) return outcome('failed');

      const grant = await requestConsent({ kind: 'ingredients' });
      if (controller.signal.aborted) return outcome('stale');
      if (!grant) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'find duplicates declined at consent',
          context: { action: 'find_declined' },
        });
        return outcome('declined');
      }

      // Logged BEFORE the await, so a failure rate has a denominator.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'find duplicates started',
        // `inferred_count` = eligible lines left out to keep the read free, so "it missed a
        // duplicate" can be told apart from "that line was never sent". 0 on the common path,
        // so the rate is measurable.
        context: { action: 'find_started', count: lines.length, inferred_count: skipped },
      });
      const result = await findDuplicatesInText(
        dedupePayload(lines),
        extractOptions({ grant, familyId, signal: controller.signal })
      );
      if (controller.signal.aborted) return outcome('stale');

      if (!result.success || !result.data) {
        logEvent({
          level: 'error',
          surface: SURFACE,
          message: 'find duplicates failed',
          context: { action: 'find_failed', error_code: result.errorCode },
        });
        // Its toast carries the error surface; no second reportError.
        reportExtractionFailure(result.errorCode, result.error);
        return outcome('failed');
      }

      const groups = result.data.groups;
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'find duplicates done',
        context: { action: 'find_done', count: groups.length },
      });
      return outcome('done', groups);
    } finally {
      running.value = false;
    }
  }

  return { running: readonly(running), find };
}
