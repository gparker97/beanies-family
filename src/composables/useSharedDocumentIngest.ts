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

import { computed, ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { consentOpen, requestConsent } from './useDocumentConsent';
import { dispatchSharePayload, isReaderEnabled, readerForShareKind } from './useMagicReader';
import { isAiPickerAcceptedFile } from '@/constants/aiDocumentPicker';
import { MAX_SHARE_TEXT_CHARS, type SharedContent } from '@/services/share/types';
import { resolveRecipeSource } from '@/services/ai/recipeSourceResolver';
import { routeUrl } from '@/utils/recipeSourceUrl';
import { extractUrls } from '@/utils/url';
import { toShareLink } from '@/utils/shareLink';
import { withSniffedType } from '@/utils/sniffFileType';
import {
  extractShareFromDocuments,
  extractShareFromText,
} from '@/services/ai/documentExtractionService';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { toDateInputValue } from '@/utils/date';
import { assertNever } from '@/utils/assertNever';
import type { ResultEnvelope, SharePayload, ShareKind } from '@/types/magicPayload';
import type { ShareExtractionResult } from '@/services/ai/types';
import type { ConsentGrant } from './useDocumentConsent';
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
  /**
   * How many documents the sender offered that the platform could NOT hand over. Non-zero
   * means the share was partial, which has to be said out loud — otherwise it just looks
   * like a smaller share than it was.
   */
  unreadable?: number;
}

/**
 * One in-flight share at a time, module-level.
 *
 * Deliberately NOT the wedges' silent `if (isProcessing) return`: at the share boundary the
 * user has just left another app, so silence reads as "beanies lost it". A second share is
 * refused audibly.
 *
 * REACTIVE because it also drives the reading overlay. The in-app readers get their spinner
 * from the wedge's `isProcessing`, which `processFile` sets — but the share path bypasses
 * `processFile` (that is how it avoids a second AI call), and the extraction finishes BEFORE
 * any page is navigated to. So on a real device the app opened from a share and then sat
 * there doing nothing visible for four or five seconds. This is the state the global overlay
 * in `App.vue` watches.
 */
const isIngesting = ref(false);

/**
 * Whether a shared document is being read right now, for the app-shell overlay.
 *
 * False while the consent prompt is up: that modal IS the feedback at that moment, and the
 * overlay sits above it.
 */
export const isReadingSharedDocument = computed(() => isIngesting.value && !consentOpen.value);

/**
 * Wait for the app to be genuinely usable on a cold launch, bounded.
 *
 * Waiting on `isInitialized` ALONE is not enough, and getting that wrong broke essentially
 * every launch-by-share: `initializeAuth()` flips `isInitialized` long before
 * `loadFamilyData()` populates `currentMember`, and the share drains within milliseconds of
 * that. The result was a "still counting your beans" toast on almost every cold share —
 * after the native side had already cleared the share, so there was nothing left to retry.
 *
 * So this waits for the state the ingest actually needs: auth settled AND, if the user is
 * signed in, the family loaded. A signed-OUT result is final and returns immediately —
 * there is no family coming.
 */
async function waitUntilReady(): Promise<void> {
  const authStore = useAuthStore();
  const familyStore = useFamilyStore();
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (authStore.isInitialized) {
      // Signed out is a settled answer, not something to keep waiting on.
      if (!authStore.isAuthenticated) return;
      if (familyStore.currentMember) return;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
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
 * Wait for the app to be usable, then check the four preconditions a share needs.
 *
 * Returns false when it is not ready — having ALREADY logged and toasted, so the caller
 * simply returns. Extracted only so the spine stays readable: the order, the `detail` values
 * and the toasts are the file path's, unchanged, and a LINK needs all four identically (the
 * same family, the same tier, the same BYOK config).
 */
async function awaitReadiness(): Promise<boolean> {
  await waitUntilReady();
  if (!useAuthStore().isInitialized) {
    notReady('auth_timeout', 'shareTarget.notReady.title', 'shareTarget.notReady.message');
    return false;
  }
  if (!useAuthStore().isAuthenticated) {
    // Deliberately not queued across a login: holding someone else's file across an auth
    // boundary is a data-handling question this change is not taking on.
    notReady('signed_out', 'shareTarget.signIn.title', 'shareTarget.signIn.message');
    return false;
  }
  if (!useFamilyStore().currentMember) {
    notReady('family_loading', 'shareTarget.notReady.title', 'shareTarget.notReady.message');
    return false;
  }
  if (!useAiCapability().isConfigured.value) {
    // Reuses the same "not set up yet" wording the shared mapper shows for `not_available`,
    // rather than inventing a second phrasing for the same state.
    notReady('ai_unconfigured', 'ai.unavailable.title', 'ai.unavailable.message');
    return false;
  }
  return true;
}

/** What the share turned out to be, once triaged. Network-free to produce. */
type ShareSource = { kind: 'documents'; files: File[] } | { kind: 'link'; url: string };

/**
 * Triage the share into documents or a link. NO NETWORK — which is what lets the single
 * offline guard sit between this and consent and keep the file path's ordering intact.
 *
 * Returns `null` to mean "the user has already been told and the event already logged".
 * That sentinel is stated here because a silent `null` is exactly the failure mode this
 * surface is most prone to.
 */
async function prepare(content: SharedContent, meta: ShareMeta): Promise<ShareSource | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  // Re-stamp each file with the type its BYTES say it is. Accepting on the bytes but leaving
  // the declared type in place made acceptance and processing disagree: downstream
  // `isPdfFile` reads `file.type`, so a PDF declared `application/octet-stream` was accepted
  // and then compressed as an image.
  const stamped = await Promise.all(content.files.map((f) => withSniffedType(f)));
  const verdicts = await Promise.all(stamped.map((f) => isAiPickerAcceptedFile(f)));
  const usable = stamped.filter((_, i) => verdicts[i]);

  // iOS hands a shared URL over as a `.txt` file in the app-group inbox. Normalising here
  // rather than in that one adapter means a `.txt` shared from ANY platform works, and keeps
  // the adapters free of decisions — which is what `share/types.ts` already asks of them.
  // `withSniffedType` returns the file untouched when the bytes match no signature, so a
  // real text file still declares `text/plain` at this point.
  let text = content.text;
  if (!usable.length && !text) {
    const textFile = stamped.find((f) => f.type === 'text/plain');
    // Bound the DECODE, not just its result: another app can hand over a 100 MB file
    // declaring itself text, and decoding it whole before slicing is the very OOM the cap
    // exists to prevent. 4 = the UTF-8 worst case per character.
    if (textFile) text = await textFile.slice(0, MAX_SHARE_TEXT_CHARS * 4).text();
  }

  // A share the platform could only partially hand over must SAY so — before the empty-batch
  // return, or the worst case (nothing readable) blames the user's file for a provider fault.
  if (meta.unreadable) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share was partial',
      context: { action: 'rejected_type', detail: 'unreadable', file_count: meta.unreadable },
    });
    showToast('info', t('shareTarget.partial.title'), t('shareTarget.partial.message'));
  }

  // FILES WIN. A captioned photo, or an iOS share carrying both a URL and a title, must
  // produce ONE item — and the photo is the thing the user pointed at.
  if (usable.length) {
    // Several files are read as ONE item, and only the first is attached. Below the page cap
    // `truncated` stays false, so without this a 2-4 file share silently keeps one photo.
    if (usable.length > 1) {
      showToast(
        'info',
        t('shareTarget.firstAttached.title'),
        t('shareTarget.firstAttached.message')
      );
    }
    return { kind: 'documents', files: usable };
  }

  if (text) {
    // Cap before anything parses it — `extractUrls` splits the whole string. Accepted
    // consequence: truncation can sever a URL sitting past the cap, and `no_url` is then the
    // honest outcome. Bounding untrusted input at the boundary is worth that tail.
    const capped = text.slice(0, MAX_SHARE_TEXT_CHARS);
    // The SAME predicate the resolver applies moments later. A weaker one here would pick a
    // YouTube channel link sitting ahead of a good recipe URL and then die on it, with a
    // readable link two words away.
    const url = extractUrls(capped).find((candidate) => routeUrl(candidate).kind !== 'invalid');
    if (url) return { kind: 'link', url };

    // Deliberately a toast, NOT a `share`-task call on the bare text: that would turn any
    // app's share sheet into a general text→model endpoint on a soft-keyed proxy, and it is
    // a different feature with its own UX questions. One string pair is the honest answer.
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'shared text carried no link',
      context: { action: 'no_url' },
    });
    showToast('info', t('shareTarget.noLink.title'), t('shareTarget.noLink.message'));
    return null;
  }

  // Everything the platform DID hand over was unreadable by us; if it handed over nothing at
  // all, the partial notice above has already explained why.
  if (meta.unreadable && content.files.length === 0) return null;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'nothing usable in share',
    // A fixed enum, never a filename or a raw MIME string from another app.
    context: {
      action: 'rejected_type',
      detail: content.files.length === 0 ? 'empty' : 'unsupported',
    },
  });
  showToast('info', t('shareTarget.unsupported.title'), t('shareTarget.unsupported.message'));
  return null;
}

/**
 * Do the network work: read the documents, or fetch and read the link.
 *
 * Returns `null` to mean "the user has already been told and the event already logged" —
 * the same sentinel `prepare` uses, for the same reason.
 */
type ReadOutcome = { kind: 'none' } | { kind: ShareKind; payload: SharePayload };

async function read(source: ShareSource, grant: ConsentGrant): Promise<ReadOutcome | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  const { tier, byokConfig } = useAiCapability();
  const opts = {
    tier: tier.value,
    todayIso: toDateInputValue(new Date()),
    byok: byokConfig.value ?? undefined,
    grant,
  };

  if (source.kind === 'documents') {
    // ONE call that classifies AND extracts. The page cap lives in the funnel; this
    // orchestrator never counts pages or files.
    const result = await extractShareFromDocuments(source.files, opts);
    if (!result.success || !result.data) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'share extraction failed',
        context: { action: 'failed', error_code: result.errorCode },
      });
      reportExtractionFailure(result.errorCode);
      return null;
    }
    return classify(result.data, {
      sourceFile: source.files[0],
      compressedBlob: result.compressedBlob,
      truncated: result.truncated,
    });
  }

  // A LINK. `resolveRecipeSource` is reused verbatim — despite the name, its page route
  // carries no recipe policy (the blocklist only picks which link inside a YouTube
  // DESCRIPTION to follow), and its fetch budget is what bounds this path's cost.
  const resolved = await resolveRecipeSource(source.url);
  const route = routeUrl(source.url);

  switch (resolved.kind) {
    case 'jsonld': {
      // The page declares schema.org Recipe, so it IS a recipe and the values are exact.
      // Classification and extraction in one, with the model never invoked.
      const link = toShareLink(resolved, route);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'link resolved',
        context: { action: 'resolved', extraction_path: resolved.path },
      });
      // Named directly rather than routed through `classify`: a JSON-LD hit is not an
      // extraction result and must not be dressed up as one — that is the whole reason
      // `RecipeShareSource` is a union.
      return {
        kind: 'recipe',
        payload: {
          kind: 'recipe',
          source: { via: 'jsonld', recipe: resolved.recipe },
          env: { sourceFile: null, link },
        },
      };
    }
    case 'text': {
      const link = toShareLink(resolved, route);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'link resolved',
        context: { action: 'resolved', extraction_path: resolved.path },
      });
      const result = await extractShareFromText(resolved.text, opts);
      if (!result.success || !result.data) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'share extraction failed',
          context: { action: 'failed', error_code: result.errorCode },
        });
        reportExtractionFailure(result.errorCode);
        return null;
      }
      return classify(result.data, { sourceFile: null, link });
    }
    case 'refusal': {
      // `not_a_recipe_url` is unreachable from here — the picker in `prepare` already used
      // `routeUrl` — but the switch stays exhaustive because the pasted-link path reaches it.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'refused to read the link',
        context: { action: 'failed', error_code: resolved.reason },
      });
      const isVideo = resolved.reason === 'no_text_no_link';
      showToast(
        'info',
        t(isVideo ? 'recipeExtract.noTranscript.title' : 'recipeExtract.badLink.title'),
        t(isVideo ? 'recipeExtract.noTranscript.message' : 'recipeExtract.badLink.message')
      );
      return null;
    }
    case 'failed':
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'link fetch failed',
        context: { action: 'failed', error_code: resolved.errorCode },
      });
      reportExtractionFailure(resolved.errorCode);
      return null;
    default:
      return assertNever(resolved, 'resolvedRecipeSource');
  }
}

/**
 * Read what a person shared into the matching review modal.
 *
 * SEVERAL files are ONE item with several pages, by explicit decision — sharing three photos
 * of one invitation produces one activity, not three. A LINK is fetched first and its text
 * classified, because the model cannot fetch and a bare URL says nothing. Nothing is ever
 * saved here; the user confirms in the existing review modal, which is also the security
 * answer for a hostile share (at worst it costs one AI call and shows a form nobody
 * confirms).
 *
 * The body is deliberately only the spine. Each phase — readiness, triage, read — is a
 * module-level function above, so adding a second source kind did not double the branch
 * count of one long function.
 */
export async function ingestSharedContent(content: SharedContent, meta: ShareMeta): Promise<void> {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const isLink = content.files.length === 0 && Boolean(content.text);

  // Fires before anything can fail, so every later event has a denominator.
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'share received',
    context: {
      action: 'received',
      os: meta.platform,
      detail: isLink ? 'link' : 'file',
      // Pinned at 0 for a link so existing dashboards keep meaning what they mean.
      file_count: content.files.length,
      cold_start: meta.coldStart,
    },
  });

  if (isIngesting.value) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share arrived mid-ingest',
      context: { action: 'busy' },
    });
    showToast('info', t('shareTarget.busy.title'), t('shareTarget.busy.message'));
    return;
  }
  isIngesting.value = true;

  try {
    if (!(await awaitReadiness())) return;

    const source = await prepare(content, meta);
    if (!source) return; // already logged and toasted

    // Offline sits between triage and consent — both `prepare` branches are network-free, so
    // the file path's original ordering (triage → offline → consent → extract) is preserved.
    const { reportExtractionFailure } = useExtractionErrorToast();
    if (!useOnline().isOnline.value) {
      reportExtractionFailure('offline');
      return;
    }

    // ADR-030 consent, before a single byte leaves the device — and before the FETCH, not
    // just the extraction. A third-party app cannot cause a document or a page to be read
    // without the user seeing this.
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

    const outcome = await read(source, grant);
    if (!outcome) return; // already logged and toasted

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share classified',
      context: { action: 'classified', kind: outcome.kind },
    });

    if (outcome.kind === 'none') {
      showToast('info', t('shareTarget.unrecognised.title'), t('shareTarget.unrecognised.message'));
      return;
    }

    // Is the destination reader actually available to this member? Permission AND flag — say
    // so rather than routing into a silent no-op.
    const reader = readerForShareKind(outcome.kind);
    if (!isReaderEnabled(reader)) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'target reader unavailable',
        context: { action: 'reader_disabled', kind: outcome.kind },
      });
      showToast('info', t('shareTarget.readerOff.title'), t('shareTarget.readerOff.message'));
      return;
    }

    dispatchSharePayload(outcome.payload);
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'share ready for review',
      context: { action: 'ready', kind: outcome.kind },
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
    showToast('error', t('ai.error.title'), t('ai.error.generic'));
  } finally {
    isIngesting.value = false;
  }
}

/**
 * Narrow a model extraction onto the dispatch union. `assertNever` closes it, so a fifth
 * kind is a build error here rather than a silent drop at one page.
 */
function classify(data: ShareExtractionResult, env: ResultEnvelope): ReadOutcome {
  switch (data.kind) {
    case 'none':
      return { kind: 'none' };
    case 'event':
      return { kind: 'event', payload: { kind: 'event', data: data.event, env } };
    case 'travel':
      return { kind: 'travel', payload: { kind: 'travel', data: data.travel, env } };
    case 'recipe':
      return {
        kind: 'recipe',
        payload: { kind: 'recipe', source: { via: 'extraction', data: data.recipe }, env },
      };
    default:
      return assertNever(data, 'shareKind');
  }
}
