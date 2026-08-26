// The share-target ingest orchestrator (#64).
//
// Owns the whole flow once files exist, so the three platform adapters stay dumb: they
// produce `File[]` and call `ingestSharedDocuments`. Every step below is a call into
// something that already exists — the consent gate, the accept predicate, the extraction
// funnel, the shared failure→toast mapper, the reader registry and the dispatch channel.
// Nothing here re-implements any of them, and nothing here knows about a platform.
//
// The share boundary is EXPORTED to every app on the device (an Android intent filter, an
// iOS Share Extension), so everything arriving here is untrusted third-party input. See the
// plan's §6: types are decided from the resolved file rather than the sender's claim, sizes
// are capped before any decode, filenames are bounded before they reach storage, and nothing
// is persisted without the user confirming it in a review modal.

import { useAiCapability } from './useAiCapability';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { requestConsent } from './useDocumentConsent';
import {
  clearPendingMagic,
  dispatchSharePayload,
  isReaderEnabled,
  readerForShareKind,
} from './useMagicReader';
import { isAiPickerAcceptedFile } from '@/constants/aiDocumentPicker';
import { extractShareFromDocuments } from '@/services/ai/documentExtractionService';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { toDateInputValue } from '@/utils/date';
import { assertNever } from '@/utils/assertNever';
import type { ResultEnvelope, SharePayload } from '@/types/magicPayload';
import type { ShareExtractionResult } from '@/services/ai/types';
import type { UIStringKey } from '@/services/translation/uiStrings';

const SURFACE = 'share-target-ingest';

/** How long a cold-started app is given to finish restoring the session before we answer. */
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 100;

export interface ShareMeta {
  /** Which adapter delivered this. */
  platform: 'android' | 'ios' | 'pwa';
  /** True when the share LAUNCHED the app rather than arriving while it ran. */
  coldStart: boolean;
}

/**
 * One in-flight share at a time, module-level.
 *
 * Deliberately NOT the wedges' silent `if (isProcessing) return`: at the share boundary the
 * user has just left another app, so silence reads as "beanies lost it". A second share is
 * refused audibly.
 */
let isIngesting = false;

/** Wait for the session to finish restoring on a cold launch, bounded. */
async function waitForAuthInit(): Promise<boolean> {
  const authStore = useAuthStore();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!authStore.isInitialized && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return authStore.isInitialized;
}

/** Tell the user why nothing happened, and record it. Never a silent return. */
function notReady(detail: string, titleKey: UIStringKey, messageKey: UIStringKey): void {
  const { showToast } = useToast();
  const { t } = useTranslation();
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'share not ready',
    context: { action: 'not_ready', detail },
  });
  showToast('info', t(titleKey), t(messageKey));
}

/**
 * Read shared documents into the matching review modal.
 *
 * SEVERAL files are ONE item with several pages, by explicit decision — sharing three photos
 * of one invitation produces one activity, not three. Nothing is ever saved here; the user
 * confirms in the existing review modal, which is also the security answer for a hostile
 * share (at worst it costs one AI call and shows a form nobody confirms).
 */
export async function ingestSharedDocuments(files: File[], meta: ShareMeta): Promise<void> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  // Fires before anything can fail, so every later event has a denominator.
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'share received',
    context: {
      action: 'received',
      os: meta.platform,
      file_count: files.length,
      cold_start: meta.coldStart,
    },
  });

  if (isIngesting) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share arrived mid-ingest',
      context: { action: 'busy' },
    });
    showToast('info', t('shareTarget.busy.title'), t('shareTarget.busy.message'));
    return;
  }
  isIngesting = true;
  // Whether a payload was handed to a page. On every other path the channel must be cleared,
  // so a dead-ended share cannot pin a File in memory until the next navigation — but
  // clearing it after a SUCCESSFUL dispatch would throw away the very thing we just sent.
  let dispatched = false;

  try {
    // 1) Readiness. A share can launch a cold app that is signed out or still hydrating;
    //    without this we would fire an AI call for a family that is not loaded, behind a
    //    login redirect the router is about to perform.
    if (!(await waitForAuthInit())) {
      notReady('auth_timeout', 'shareTarget.signIn.title', 'shareTarget.signIn.message');
      return;
    }
    if (!useAuthStore().isAuthenticated) {
      // Deliberately not queued across a login: holding someone else's file across an auth
      // boundary is a data-handling question this change is not taking on.
      notReady('signed_out', 'shareTarget.signIn.title', 'shareTarget.signIn.message');
      return;
    }
    if (!useFamilyStore().currentMember) {
      notReady('family_loading', 'shareTarget.notReady.title', 'shareTarget.notReady.message');
      return;
    }
    const { tier, byokConfig, isConfigured } = useAiCapability();
    if (!isConfigured.value) {
      // Reuses the same "not set up yet" wording the shared mapper shows for `not_available`,
      // rather than inventing a second phrasing for the same state.
      notReady('ai_unconfigured', 'ai.unavailable.title', 'ai.unavailable.message');
      return;
    }

    // 2) What can we actually read? Decided from the RESOLVED file, never the sender's claim.
    const usable = files.filter(isAiPickerAcceptedFile);
    if (usable.length === 0) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'nothing usable in share',
        // A fixed enum, never a filename or a raw MIME string from another app.
        context: { action: 'rejected_type', detail: files.length === 0 ? 'empty' : 'unsupported' },
      });
      showToast('info', t('shareTarget.unsupported.title'), t('shareTarget.unsupported.message'));
      return;
    }

    // 3) Offline. Reuses the shared mapper's own branch rather than a second guard.
    const { reportExtractionFailure } = useExtractionErrorToast();
    if (!useOnline().isOnline.value) {
      reportExtractionFailure('offline');
      return;
    }

    // 4) ADR-030 consent, before a single byte leaves the device. A third-party app cannot
    //    cause a document to be sent without the user seeing this.
    const grant = await requestConsent();
    if (!grant) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'consent declined',
        context: { action: 'consent_declined' },
      });
      return;
    }

    // 5) ONE call that classifies AND extracts. The page cap lives in the funnel; this
    //    orchestrator never counts pages or files.
    const result = await extractShareFromDocuments(usable, {
      tier: tier.value,
      todayIso: toDateInputValue(new Date()),
      byok: byokConfig.value ?? undefined,
      grant,
    });

    if (!result.success || !result.data) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'share extraction failed',
        context: { action: 'failed', error_code: result.errorCode },
      });
      reportExtractionFailure(result.errorCode);
      return;
    }

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share classified',
      context: { action: 'classified', kind: result.data.kind },
    });

    if (result.data.kind === 'none') {
      showToast('info', t('shareTarget.unrecognised.title'), t('shareTarget.unrecognised.message'));
      return;
    }

    // 6) Is the destination reader actually available to this member? Permission AND flag —
    //    say so rather than routing into a silent no-op.
    const reader = readerForShareKind(result.data.kind);
    if (!isReaderEnabled(reader)) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'target reader unavailable',
        context: { action: 'reader_disabled', kind: result.data.kind },
      });
      showToast('info', t('shareTarget.readerOff.title'), t('shareTarget.readerOff.message'));
      return;
    }

    // 7) Hand it to the page that owns the review modal. File 1 is the attachment; the
    //    multi-file notice says so.
    const env: ResultEnvelope = {
      sourceFile: usable[0],
      compressedBlob: result.compressedBlob,
      truncated: result.truncated,
    };
    dispatchSharePayload(toPayload(result.data, env));
    dispatched = true;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share ready for review',
      context: { action: 'ready', kind: result.data.kind },
    });
  } catch (err) {
    // A native listener rejection escapes Vue's error handler entirely, so this catch is the
    // only thing between a throw and a user who is told nothing.
    reportError({
      surface: SURFACE,
      message: 'share ingest threw',
      // Not `critical`: nothing is persisted at this point, so no user data is at risk.
      severity: 'error',
      error: err,
      context: { action: 'threw' },
    });
    const { showToast: toast } = useToast();
    const { t: translate } = useTranslation();
    toast('error', translate('ai.error.title'), translate('ai.error.generic'));
  } finally {
    isIngesting = false;
    if (!dispatched) clearPendingMagic();
  }
}

/** Narrow the extraction union onto the dispatch union. `assertNever` closes it. */
function toPayload(
  data: Exclude<ShareExtractionResult, { kind: 'none' }>,
  env: ResultEnvelope
): SharePayload {
  switch (data.kind) {
    case 'event':
      return { kind: 'event', data: data.event, env };
    case 'travel':
      return { kind: 'travel', data: data.travel, env };
    case 'recipe':
      return { kind: 'recipe', data: data.recipe, env };
    default:
      return assertNever(data, 'shareKind');
  }
}
