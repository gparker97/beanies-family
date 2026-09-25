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
import {
  consentOpen,
  isDeferredStatementConsent,
  requestConsent,
  type DeferredStatementConsent,
} from './useDocumentConsent';
import { dispatchSharePayload, isReaderEnabled, readerForShareKind } from './useMagicReader';
import { AI_PICKER_MAX_BYTES, isAiPickerAcceptedFile } from '@/constants/aiDocumentPicker';
import {
  MAX_SHARE_TEXT_BYTES,
  MAX_SHARE_TEXT_CEILING,
  MAX_LINK_NOTE_CHARS,
  MAX_SHARE_TEXT_CHARS,
  MIN_SHARE_TEXT_CHARS,
  SHARE_TEXT_BUDGET,
  shareTextBudgetKey,
  type SharedContent,
} from '@/services/share/types';
import { boundText } from '@/utils/boundText';
import { consumeAttempt, consumeAttempts, peekAttempt } from '@/utils/attemptBudget';
import { resolveBillableFamilyId } from '@/composables/useMagicBeanScope';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTime12, toTimeInputValue } from '@/utils/date';
import { extractUrls } from '@/utils/url';
import { withSniffedType } from '@/utils/sniffFileType';
import {
  extractShareFromDocuments,
  extractShareFromPreparedSource,
  extractShareFromText,
} from '@/services/ai/documentExtractionService';
import {
  looksLikeCsv,
  prepareStatementUnits,
  readStatement,
  type StatementInput,
} from '@/services/ai/statementExtraction';
import { CompressionError } from '@/services/photos/photoCompression';
import { isPdfFile, isTextLikeFile } from '@/utils/pdfExtractionImages';
import { buildStatementContext } from '@/utils/statement/merchantMemory';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { isBeanpodFileName } from '@/constants/beanpodFile';
import { getPlatform } from '@/services/sync/capabilities';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';
import { reportError } from '@/utils/errorReporter';
import { assertNever } from '@/utils/assertNever';
import type { ResultEnvelope, SharePayload, ShareKind } from '@/types/magicPayload';
import type {
  DocumentExtractionResult,
  ExtractionErrorCode,
  ExtractionSource,
  ShareExtractionResult,
} from '@/services/ai/types';
import type { ConsentGrant } from './useDocumentConsent';
import type { UIStringKey } from '@/services/translation/uiStrings';

const SURFACE = 'share-target-ingest';

/**
 * Which door a capture came in by, carried through the shared spine (#84).
 *
 * The two fields travel TOGETHER, as one object rather than two parameters, so no call site
 * can pair the wrong surface with the wrong origin. There is deliberately NO default value
 * anywhere: an unthreaded site is then a compile error rather than an event silently filed
 * under the share funnel.
 *
 * ⚠️ Keep this a LABEL. The moment it carries behaviour — a policy, a callback, a flag — the
 * two paths have diverged and should be two functions, not one function reading a field.
 */
export interface IngestEnv {
  /** Telemetry surface. Free-form by design: this is what separates the two funnels in
   *  CloudWatch without a new context key, an allowlist entry or a Lambda deploy. */
  surface: string;
  /** Which entry point. Rides onto `ResultEnvelope.origin` for the review surfaces. */
  origin: 'share' | 'in-app';
}

/** The share path's ONE literal. Every other site takes its env from a parameter. */
const SHARE_ENV: IngestEnv = { surface: SURFACE, origin: 'share' };

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
/**
 * Everything the reading UI needs, as ONE value.
 *
 * It was a single boolean until the resolve beat needed a kind and the recipe form needed to
 * keep its own overlay. Three sibling refs reset together, in a `finally` in a different
 * function from where two of them are set, is the shape a future change half-updates — so a
 * reset is one assignment, and a new fact is a FIELD here rather than a fourth ref.
 */
type IngestState =
  | { phase: 'idle' }
  /** `hint`: the kind the person picked in the sheet (#108), so the overlay lights that tile
   *  from the first frame. Absent on a share, a correction, and an unpicked capture. */
  | {
      phase: 'reading';
      presentation: 'global' | 'local';
      hint?: ShareKind;
      /** A statement is read page by page (#107); the overlay says "page 3 of 5". */
      progress?: { done: number; total: number };
    }
  | { phase: 'resolved'; presentation: 'global' | 'local'; kind: ShareKind };

/**
 * What a caller may state about a read as it starts — typed FROM the reading arm so a new
 * reading-time fact is declared once, on the state, and every caller sees it.
 */
type ReadingFacts = Partial<Omit<Extract<IngestState, { phase: 'reading' }>, 'phase'>>;

const ingestState = ref<IngestState>({ phase: 'idle' });

/** Read-only view for the overlay, which renders the tiles from `phase` and `kind`. */
export const magicIngestState = computed<IngestState>(() => ingestState.value);

const isIngesting = computed(() => ingestState.value.phase !== 'idle');

/**
 * How long the resolved tile is held before the review modal opens.
 *
 * ⚠️ The ONLY deliberate latency in this pipeline. Without it the resolve renders for zero
 * frames: `dispatchSharePayload` routes and `withIngestLock`'s `finally` clears the state in
 * the same tick, so "two tiles fade and one lifts" would never be seen by anyone. Zero under
 * reduced motion.
 */
const RESOLVE_HOLD_MS = 700;

/**
 * Whether a shared document is being read right now, for the app-shell overlay.
 *
 * False while the consent prompt is up: that modal IS the feedback at that moment, and the
 * overlay sits above it.
 */
export const isReadingSharedDocument = computed(() => isReadingOn('global'));

/**
 * The same question for a door that fills ITSELF in (`InAppDestination`).
 *
 * ⚠️ `presentation: 'local'` SUPPRESSES the app-shell overlay, so this is not an extra: it is
 * the only feedback such a door has, and without a consumer a recipe-form capture is four to
 * eight seconds of an inert, editable, blank form that then silently repopulates. The two
 * values of `presentation` must each have exactly one renderer; that is the whole point of
 * deriving the flag from the claim rather than configuring it separately.
 *
 * It is also the in-flight fact every OTHER local guard should read. `useRecipeCapture`'s
 * `isProcessing` is composable-local and is set only by `processUrl`, which the doors no
 * longer call — so a guard written against it is dead code that looks live.
 */
export const isReadingLocally = computed(() => isReadingOn('local'));

/** One predicate, two presentations — so the two computeds cannot drift in their guards. */
function isReadingOn(presentation: 'global' | 'local'): boolean {
  // Read ONCE into a local: re-reading `ingestState.value` in each operand does not narrow the
  // union, and an `as` at this call site would defeat the point of discriminating it.
  const state = ingestState.value;
  return state.phase !== 'idle' && !consentOpen.value && state.presentation === presentation;
}

/**
 * Is an ingest already running?
 *
 * Exported so a DOOR can refuse at the moment the user commits a source — before the consent
 * prompt and before the picker opens — rather than after. `withIngestLock` below is still the
 * authority and still refuses correctly if this check is ever lost; the difference is where
 * the user finds out.
 *
 * Without it the sequence is: tap camera on door 2 while door 1's capture is in flight →
 * answer a consent prompt → take a photo → `ingestInAppSource` runs → the lock refuses → the
 * photo is discarded. That is the exact "declining throws away work already done" failure the
 * consent reorder exists to remove, reintroduced one layer down.
 *
 * The window between this check and the lock is a single user gesture on a single-threaded UI.
 */
export function refuseIfBusy(env: IngestEnv): boolean {
  if (!isIngesting.value) return false;

  const { showToast } = useToast();
  const { t } = useTranslation();
  logEvent({
    level: 'info',
    surface: env.surface,
    message: 'ingest arrived while busy',
    context: { action: 'busy' },
  });
  showToast('info', t('shareTarget.busy.title'), t('shareTarget.busy.message'));
  return true;
}

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

/**
 * Tell the user why nothing happened, and record it. Never a silent return.
 *
 * ⚠️ NOT exported. `useMagicBeanScope` needs the same log+toast pair and briefly imported it —
 * but that module is imported BY this one, so the import was a cycle, and under Vite a cycle
 * can leave a binding `undefined` at call time. The throw lands in `withIngestLock`'s catch,
 * which turns it into "Couldn't read that" on every capture with nothing naming the cause.
 * It carries its own two lines instead; the shared contract is the `action: 'not_ready'`
 * context key, which is what a CloudWatch filter actually keys on.
 */
function notReady(
  env: IngestEnv,
  detail: string,
  titleKey: UIStringKey,
  messageKey: UIStringKey
): void {
  const { showToast } = useToast();
  const { t } = useTranslation();
  logEvent({
    level: 'info',
    surface: env.surface,
    // Source-neutral: this is now reached from both doors. The FILTERABLE field is `surface`,
    // which says which one — a message string is not a dashboard filter.
    message: 'ingest not ready',
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
    notReady(
      SHARE_ENV,
      'auth_timeout',
      'shareTarget.notReady.title',
      'shareTarget.notReady.message'
    );
    return false;
  }
  if (!useAuthStore().isAuthenticated) {
    // Deliberately not queued across a login: holding someone else's file across an auth
    // boundary is a data-handling question this change is not taking on.
    notReady(SHARE_ENV, 'signed_out', 'shareTarget.signIn.title', 'shareTarget.signIn.message');
    return false;
  }
  if (!useFamilyStore().currentMember) {
    notReady(
      SHARE_ENV,
      'family_loading',
      'shareTarget.notReady.title',
      'shareTarget.notReady.message'
    );
    return false;
  }
  if (!useAiCapability().isConfigured.value) {
    // Reuses the same "not set up yet" wording the shared mapper shows for `not_available`,
    // rather than inventing a second phrasing for the same state.
    notReady(SHARE_ENV, 'ai_unconfigured', 'ai.unavailable.title', 'ai.unavailable.message');
    return false;
  }
  return true;
}

/**
 * Trailing sentence punctuation is not part of a URL.
 *
 * Brackets are deliberately NOT handled: `extractUrls` already stops at `)`, so a
 * parenthesised path arrives truncated before this ever sees it. That is a pre-existing
 * limitation of the shared extractor, not something to paper over here — fixing it belongs
 * in `extractUrls`, where every caller would benefit.
 */
function trimUrlPunctuation(url: string): string {
  return url.replace(/[.,;:!?'"]+$/, '');
}

/**
 * State what the share turned out to BE, once triage knows.
 *
 * Separate from the `received` event because on iOS a link arrives as a `.txt` file, so the
 * raw content cannot tell the two apart — and the Observability Coverage pins `detail` so
 * the two funnels are separable. `file_count` is 0 for a link, so existing dashboards keep
 * meaning what they mean.
 */
/**
 * Why a triage went the way it did, when the bare `detail` does not say.
 *
 * A literal union rather than a one-entry lookup table: same type safety, without an
 * indirection standing between the key and the string it maps to. Extend by adding a literal —
 * NEVER by adding another parameter, because two of this helper's call sites are file shares
 * where any such flag is meaningless.
 */
type TriageNote = 'the message outweighed the links in it';
const OUTWEIGHED_LINKS: TriageNote = 'the message outweighed the links in it';

function logReceivedKind(
  env: IngestEnv,
  detail: 'file' | 'link' | 'text',
  fileCount: number,
  note?: TriageNote
): void {
  logEvent({
    level: 'info',
    surface: env.surface,
    // ⚠️ THE PREFIX IS STABLE. Every message starts 'share triaged', so a saved CloudWatch
    // query moves from `= "share triaged"` to `like /^share triaged/` and keeps working as
    // notes are added. The note rides in the MESSAGE — developer-authored free text, not
    // allowlisted — rather than in `context`, so no new key ships and `file_count` keeps its
    // documented meaning.
    message: note ? `share triaged — ${note}` : 'share triaged',
    context: { action: 'triaged', detail, file_count: fileCount },
  });
}

/**
 * The one place a budget refusal is reported. Shared by the `prepare` peek and the `read`
 * consume so the two cannot drift into two messages for one limit.
 */
function refuseForQuota(env: IngestEnv, resetsAt: number): void {
  const { showToast } = useToast();
  const { t } = useTranslation();
  logEvent({
    level: 'warn',
    surface: env.surface,
    // `action: 'refused'` — a DELIBERATE refusal, not a type rejection. Folding it into
    // `rejected_type` would make "how many were refused, and why" unanswerable.
    message: 'text share refused by the local budget',
    context: { action: 'refused', detail: 'quota' },
  });
  showToast(
    'info',
    t('shareTarget.text.quota.title'),
    fillTemplate(t('shareTarget.text.quota.message'), {
      resetsAt: formatTime12(toTimeInputValue(new Date(resetsAt))),
    })
  );
}

/**
 * What the share turned out to be, once triaged. Network-free to produce.
 *
 * `text` is the #83 arm: sender-supplied prose carrying no usable link. It is strictly
 * DOWNSTREAM of every existing decision in `prepare` — files still win, a link inside the
 * text still wins — so adding it could not change any outcome that already worked.
 * `truncated` means the text was longer than the read cap and has been bounded; the
 * orchestrator says so with its own toast (see `runTextBands`).
 */
/**
 * The three FIRST-READ arms — what `prepare` and `sourceFromText` can produce. Intersected
 * ONCE with the optional `hint`: the kind the person picked in the magic-beans sheet before
 * the read (#108). It is a property of the source, not of an arm, because documents, pasted
 * text and a fetched link page all reach the model through the one `opts` object in `read()`;
 * attaching it per arm is how a pasted LINK once lost its pick. The share path never sets it.
 */
type FirstReadSource = (
  | { kind: 'documents'; files: File[] }
  | { kind: 'link'; url: string }
  /**
   * `full` is the untruncated trimmed text, set ONLY when `text` was capped. A statement read
   * (#107) reads the whole thing in chunks, so a pasted statement that turns out to be one
   * must not be judged on its first 10 000 characters.
   */
  | { kind: 'text'; text: string; truncated: boolean; full?: string }
) & {
  hint?: ShareKind;
  /** The hint is the door's own pre-pick, left as it was: the surface's default, not a pick. */
  hintFromSurface?: boolean;
};

type ShareSource =
  | FirstReadSource
  /**
   * A re-read of a document this spine has ALREADY resolved and (on the managed tier) paid
   * for, as the kind the user says it actually is.
   *
   * A `ShareSource` arm rather than a fourth entry point: everything below `withIngestLock` —
   * offline, classify, the reader gate, the resolve hold, dispatch — is identical, and only
   * the two lines that produce the source differ. `prepared` is the payload the model was
   * given verbatim, because the proxy fingerprints those exact bytes.
   */
  | {
      kind: 'correction';
      prepared: ExtractionSource;
      to: ShareKind;
      env: ResultEnvelope;
      token?: string;
    };

/**
 * Which funnel an event belongs to, derived from the source rather than threaded alongside
 * it. `ShareSource` IS the discriminator and `read()` already receives it, so a parallel
 * `detail` parameter would be a second representation of one fact to keep in sync by hand.
 * Closed by the union: a fourth arm cannot compile without updating this.
 */
function sourceDetail(source: ShareSource): 'file' | 'link' | 'text' {
  switch (source.kind) {
    case 'documents':
      return 'file';
    case 'link':
      return 'link';
    case 'text':
      return 'text';
    case 'correction':
      // The funnel a correction belongs to is the one its ORIGINAL read belonged to — a
      // corrected photo is still the file funnel. Derived from the prepared payload rather
      // than threaded, for the same reason the rest of this function is.
      return source.prepared.kind === 'text' ? 'text' : 'file';
    default:
      return assertNever(source, 'shareSourceDetail');
  }
}

/**
 * The kind the person STATED before this read (#108), or nothing. A sibling of `sourceDetail`
 * for the same reason: `ShareSource` is the discriminator and both `read()` and `runIngest()`
 * already receive it, so this is written once rather than in each. A correction carries `to`,
 * which is a different fact (a re-read after a wrong answer) and is handled by its own arm.
 */
function statedKind(source: ShareSource): ShareKind | undefined {
  return source.kind === 'correction' ? undefined : source.hint;
}

/**
 * The two OUTCOMES a stated kind can have that a blind read cannot (#108). Same shape as
 * `refuseForQuota` and `notReady`: one event, one toast, so the spine gains a one-line branch
 * and the pairing lives here. Both interpolate the QUOTED tile name (`ai.capture.dest.*`), which
 * carries no article — "a Activity" is the bug the quoting avoids.
 */
function hintDisagreed(env: IngestEnv, hint: ShareKind, bySurface: boolean): void {
  const { showToast } = useToast();
  const { t } = useTranslation();
  logEvent({
    level: 'info',
    surface: env.surface,
    // A model OUTCOME, not a fault: the document genuinely holds nothing of that kind.
    message: 'the model could not read it as the stated kind',
    context: { action: bySurface ? 'surface_hint_disagreed' : 'hint_disagreed', kind: hint },
  });
  showToast(
    'info',
    t('ai.capture.pick.none.title'),
    fillTemplate(t('ai.capture.pick.none.message'), {
      kind: t(`ai.capture.dest.${hint}`),
      noun: t(`ai.capture.noun.${hint}`),
    })
  );
}

function hintOverruled(
  env: IngestEnv,
  hint: ShareKind,
  actual: ShareKind,
  bySurface: boolean
): void {
  const { showToast } = useToast();
  const { t } = useTranslation();
  logEvent({
    // `warn`: the prompt told the model not to re-decide and it did anyway. A rising rate is the
    // first thing to look at before touching the prompt.
    // A surface's pre-pick being overruled is usually the right call (a booking dropped on the
    // calendar), so it is `info` and logged apart from a person's pick.
    level: bySurface ? 'info' : 'warn',
    surface: env.surface,
    message: 'the model overruled the stated kind',
    context: {
      action: bySurface ? 'surface_hint_overruled' : 'hint_overruled',
      kind: actual,
      detail: hint,
    },
  });
  showToast(
    'info',
    t('ai.capture.pick.overruled.title'),
    fillTemplate(t('ai.capture.pick.overruled.message'), {
      picked: t(`ai.capture.dest.${hint}`),
      actual: t(`ai.capture.dest.${actual}`),
    })
  );
}

/**
 * The budget key for the current family, or `null` when the budget does not apply.
 *
 * Two reasons it may not apply, and both are deliberate:
 *   - **BYOK/on-device**: the user pays for their own key and the server throttle does not
 *     touch them, so a client cap would be us rationing someone else's quota for no benefit.
 *   - **No family id**: nothing sane to scope a budget to. `awaitReadiness` has already
 *     established `currentMember`, so this is a should-not-happen rather than a real path,
 *     but failing OPEN here matches the server's own fail-open posture — the request still
 *     meets the route throttle and both server limits.
 */
function textBudgetKey(): string | null {
  if (useAiCapability().tier.value !== 'managed') return null;
  const familyId = useFamilyContextStore().activeFamilyId;
  return familyId ? shareTextBudgetKey(familyId) : null;
}

/**
 * Turn sender-supplied TEXT into a `ShareSource`: the LINK when the share IS a link, otherwise
 * the text itself, bounded and budgeted (#83, precedence #85).
 *
 * The precedence is `MAX_LINK_NOTE_CHARS`: a body outweighs the links inside it, a note around
 * a link does not — but only where the text arm can actually read the share.
 *
 * Extracted out of `prepare()` (#84) so BOTH entry points get one text policy rather than
 * two. Everything about what text is acceptable — the link-vs-text decision, the three size
 * bands, the truncation notice, and the quota PEEK — lives here and only here. An in-app
 * paste therefore inherits the share path's limits structurally, not by discipline.
 *
 * The matching `consumeAttempt` deliberately does NOT live here: it sits immediately before
 * the AI call in `runIngest`, because consent runs between the two and spending a share on a
 * declined prompt would be a bug the user can see.
 *
 * Returns `null` to mean "the user has already been told and the event already logged" — the
 * same sentinel `prepare` uses, for the same reason.
 *
 * @param overCeilingByBytes The verdict of the pre-decode byte gate, when the text came from
 *   a shared `.txt`. Passed in rather than re-derived: only the caller has the `File`.
 */
async function sourceFromText(
  text: string,
  env: IngestEnv,
  overCeilingByBytes = false
): Promise<FirstReadSource | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  // ── Measure ────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ Bands are measured on the ORIGINAL trimmed string, never on `capped` — that copy is ≤
  // the read cap by construction, so band logic reading it could never see either the truncate
  // or the refuse band.
  const trimmed = text.trim();
  // Cap before anything parses it — `extractUrls` splits the whole string. Accepted
  // consequence: truncation can sever a URL sitting past the cap, and the text arm is then the
  // honest outcome. Bounding untrusted input at the boundary is worth that tail.
  const capped = text.slice(0, MAX_SHARE_TEXT_CHARS);

  // Punctuation is trimmed because sentence-punctuated prose is the NORMAL input here —
  // "Watch this https://youtu.be/dQw4w9WgXcQ." is how people share. `extractUrls` strips it on
  // its bare-domain pass but not on its protocol pass, and the trailing dot makes the video id
  // 12 characters, which `routeUrl` rejects outright: a perfectly readable video became "No
  // Link Found".
  //
  // `Set` because `trimUrlPunctuation` can collapse two distinct candidates onto one string,
  // which defeats `extractUrls`' own dedupe and would run the same whole-string split twice.
  // This value now picks the ARM, not just a refusal, so it pays to be exact.
  const candidates = [...new Set(extractUrls(capped).map(trimUrlPunctuation))];

  // ⚠️ BOTH forms. `extractUrls` returns a bare domain SCHEME-PREFIXED (`url.ts:75` pushes
  // `https://${cleaned}`), while this splits the ORIGINAL text — so splitting on the candidate
  // alone never matches `www.school.edu.sg` and leaves the whole domain counted as prose.
  // Verified: "Regards\nwww.smmis.edu.sg" measures 24 one-form, 7 two-form. Latent and harmless
  // while this only gated a refusal (it made the refusal LESS likely, the safe direction); not
  // harmless now that the same number picks the arm.
  //
  // It can OVER-strip: prose that repeats a domain in words ("I love example.com so much…")
  // loses those mentions too, so 113 characters can measure 89. Measured, accepted, and in the
  // SAFE direction — undercounting prose biases toward the LINK arm, which is the path that
  // works today. Do not "fix" it with word boundaries; a URL is not a word.
  //
  // ⚠️ LONGEST FIRST, and this is not cosmetic. `split` removes every literal occurrence, so
  // stripping a SHORTER candidate that is a prefix of a longer one chews the front off the
  // longer one too and strands its path as prose — which the longer candidate can then never
  // match. "Check out https://example.com or the recipe at https://example.com/recipe/x" left
  // `/recipe/x` behind, INFLATING the count by 19 and able to tip an ordinary recipe share over
  // the threshold into the text arm, losing the schema.org quantities the low threshold exists
  // to protect. Ordering by descending length removes the specific URL before the general one.
  const stripScheme = (u: string) => u.replace(/^https?:\/\//, '');
  const prose = [...candidates]
    .sort((a, b) => b.length - a.length)
    .reduce((rest, c) => rest.split(c).join(' ').split(stripScheme(c)).join(' '), trimmed)
    .trim().length;

  // ── Decide ─────────────────────────────────────────────────────────────────────────────
  //
  // The bands, decided BEFORE the arm so each is evaluated once and read twice. Nothing here
  // has a side effect: `peekAttempt` consumes nothing and writes nothing (pinned by a test,
  // because it is an assumption about another module's internals).
  const overCeiling = overCeilingByBytes || trimmed.length > MAX_SHARE_TEXT_CEILING;
  const budgetKey = textBudgetKey();
  const quota = budgetKey ? peekAttempt(budgetKey, SHARE_TEXT_BUDGET) : null;

  // ⚠️ "Can the text arm actually READ this?", NOT "should it". A link-bearing share must never
  // become a refusal because the arm it was newly routed to could not run. Two shipped cases
  // depend on this: an over-ceiling `.txt` that BEGINS with a link (iOS delivers every shared
  // URL that way, and `prepare` sets `overCeilingByBytes` as a flag rather than returning
  // precisely so it keeps working), and any link share once the text budget is spent — which
  // has never consumed that budget and must not start refusing.
  const textArmUsable =
    !overCeiling && trimmed.length >= MIN_SHARE_TEXT_CHARS && quota?.ok !== false;

  // THE PRECEDENCE (#85), in one line. A body outweighs the links inside it; a note around a
  // link does not. Before this, the FIRST usable URL won unconditionally — so a school email
  // whose details are in the body was routed to its own signature URL, and beanies read the
  // school's homepage instead of the field trip.
  const bodyOutweighsLinks = prose > MAX_LINK_NOTE_CHARS;

  // ── Dispatch ───────────────────────────────────────────────────────────────────────────
  if (candidates.length && !(bodyOutweighsLinks && textArmUsable)) {
    // Imported HERE rather than at module scope. `App.vue` statically imports
    // `useShareTargets`, which imports this file — so a top-level import would drag the recipe
    // link-reading graph (`recipeSourceUrl`, `recipeSourceResolver`, `recipeFetchService`,
    // `shareLink` — ~22 KB) into the eager entry chunk, where none of it lived before. And it
    // now sits INSIDE this block, so the dominant new case (a long email) never loads it.
    const router = await import('@/utils/recipeSourceUrl').catch((err: unknown) => {
      // "Offline, or a stale deploy" — not a code fault. If the message is readable on its
      // own, read it: a result beats an error. If it is NOT, rethrow — `withIngestLock`
      // already reports and shows `ai.error.generic`, and handling it here too would invent a
      // fourth meaning for `null` and show two toasts for one failure.
      if (!textArmUsable) throw err;
      reportError({
        surface: env.surface,
        // `severity` omitted: 'error' is the default, and this must not page Slack.
        message: 'link router chunk failed to load — read as text instead',
        error: err,
        context: { action: 'rejected_type', detail: 'link_router_unavailable' },
      });
      return null;
    });

    if (router) {
      // The SAME predicate the resolver applies moments later. A weaker one here would pick a
      // YouTube channel link sitting ahead of a good recipe URL and then die on it, with a
      // readable link two words away.
      const url = candidates.find((c) => router.routeUrl(c).kind !== 'invalid');
      if (url) {
        logReceivedKind(env, 'link', 0);
        return { kind: 'link', url };
      }

      // ⚠️ There WERE links, but none beanies can read — a YouTube channel, a playlist, an
      // `/@handle`. Refuse as a LINK; do not fall through to the text bands with them.
      //
      // The bands accept anything over 25 characters, and a bare
      // `https://www.youtube.com/playlist?list=…` is 46 — so it would pass, spend a budget
      // slot, and reach the model as prose. The model cannot fetch, so `none` is the only
      // possible answer: one billed call and one slot for a refusal that was free a moment
      // ago. It would also contradict `extractShareFromText`'s own JSDoc ("Never the bare
      // URL"), and a SHORT unreadable link would be told "include the date, the time and where
      // it is" — advice about an event, given to someone who shared a link.
      if (prose < MIN_SHARE_TEXT_CHARS) {
        logEvent({
          level: 'info',
          surface: env.surface,
          message: 'shared link is not one beanies can read',
          context: { action: 'rejected_type', detail: 'unreadable_link' },
        });
        showToast('info', t('recipeExtract.badLink.title'), t('recipeExtract.badLink.message'));
        return null;
      }
    }
  }

  // ── The text arm ───────────────────────────────────────────────────────────────────────
  //
  // The text ITSELF is the share (#83). This used to be a dead end, deliberately: routing bare
  // text to the model turns any app's share sheet into a general text→model endpoint on a
  // soft-keyed proxy. That is still true — what changed is that the provenance fence has been
  // REPLACED rather than removed. Bounded here, budgeted here and in `read`, and throttled per
  // family and per IP at the proxy. See `docs/adr/035-plain-text-share-provenance.md`.
  if (overCeiling) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'shared text was too long to read',
      context: { action: 'rejected_type', detail: 'over_ceiling' },
    });
    showToast('info', t('shareTarget.text.tooLong.title'), t('shareTarget.text.tooLong.message'));
    return null;
  }

  // Measured AFTER trim, or 30 spaces would pass. A couple of words cannot carry a date,
  // a time and a title, and paying the model to discover that is pure cost.
  if (trimmed.length < MIN_SHARE_TEXT_CHARS) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'shared text was too short to read',
      context: { action: 'rejected_type', detail: 'too_short' },
    });
    showToast('info', t('shareTarget.text.tooShort.title'), t('shareTarget.text.tooShort.message'));
    return null;
  }

  // PEEKED above, not consumed. Consent runs after `prepare`, so consuming there would burn a
  // share when the user DECLINES. The matching `consumeAttempt` sits immediately before the AI
  // call in `read`.
  if (quota && !quota.ok) {
    refuseForQuota(env, quota.resetsAt);
    return null;
  }

  // Between the cap and the ceiling the text is bounded and the caller is told — but NOT here.
  // `sourceFromText` runs inside triage, and the offline guard and the consent prompt both come
  // after it and can both end the flow. Announcing "beanies read the beginning of it — check
  // the details before you save" and then showing an offline error, or nothing at all because
  // consent was declined, is a straight falsehood: nothing was read and there is nothing to
  // save. The flag rides on the ShareSource; `runIngest` announces it when it becomes true.
  const truncated = trimmed.length > MAX_SHARE_TEXT_CHARS;

  // The note is set ONLY when the new precedence chose text over a usable link, so
  // `filter @message like /outweighed/` measures exactly how often the rule fires.
  logReceivedKind(env, 'text', 0, candidates.length ? OUTWEIGHED_LINKS : undefined);
  // `boundText`, not `slice`: cutting UTF-16 code units can split a surrogate pair and hand
  // the model a U+FFFD where an emoji was.
  return {
    kind: 'text',
    text: boundText(trimmed, MAX_SHARE_TEXT_CHARS),
    truncated,
    ...(truncated ? { full: trimmed } : {}),
  };
}

/**
 * Read a shared or picked TEXT file (a `.txt`, or a `.csv` statement export, #107).
 *
 * Decides the ceiling from `File.size` BEFORE decoding, so a 50 000-character file is never
 * silently read as its first slice. The verdict is a FLAG, not a refusal: iOS delivers a
 * shared URL as a `.txt`, and a `.txt` that begins with a link must keep taking the link path.
 * One function for both entry points, so `prepare` and `inAppSource` cannot drift into two
 * text-file policies.
 *
 * @param uncapped read the whole file regardless of the ceiling (a statement read bounds
 *   itself, in chunks).
 */
async function readTextFile(
  file: File,
  uncapped = false
): Promise<{ text: string; overCeilingByBytes: boolean }> {
  const overCeilingByBytes = file.size > MAX_SHARE_TEXT_BYTES;
  if (uncapped) return { text: await file.text(), overCeilingByBytes };
  // The slice in the non-over-ceiling arm is belt-and-braces against a lying `File.size`, NOT
  // the working bound: the two numbers are equal, so it never clips a file that is actually
  // used and can never split a UTF-8 sequence. Deliberate; not dead code.
  const text = await file
    .slice(0, overCeilingByBytes ? MAX_SHARE_TEXT_CHARS * 4 : MAX_SHARE_TEXT_BYTES)
    .text();
  return { text, overCeilingByBytes };
}

/**
 * Triage the share into documents or a link. NO NETWORK — which is what lets the single
 * offline guard sit between this and consent and keep the file path's ordering intact.
 *
 * Returns `null` to mean "the user has already been told and the event already logged".
 * That sentinel is stated here because a silent `null` is exactly the failure mode this
 * surface is most prone to.
 */
async function prepare(content: SharedContent, meta: ShareMeta): Promise<FirstReadSource | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  // Re-stamp each file with the type its BYTES say it is. Accepting on the bytes but leaving
  // the declared type in place made acceptance and processing disagree: downstream
  // `isPdfFile` reads `file.type`, so a PDF declared `application/octet-stream` was accepted
  // and then compressed as an image.
  const stamped = await Promise.all(content.files.map((f) => withSniffedType(f)));

  // ⚠️ A FAMILY FILE IS NOT A DOCUMENT TO READ, and saying so is the whole point of this arm.
  // Selecting a `.beanpod` in the Drive iOS app and choosing beanies lands HERE, because the
  // Share Extension claims files (and wins over the document-type declaration, which only lists
  // images and PDFs). It then fails the image/PDF triage below and falls out as the generic
  // "beanies can read photos, screenshots, PDFs and links" toast — the most natural thing a
  // stuck person tries, answered with a sentence that is actively misleading about what beanies
  // can do with their own family file.
  //
  // ⚠️ THIS IS NOT A JOIN ROUTE, and must not become one. The share sheet hands over file BYTES
  // with no Drive grant, so opening them would fork the pod (ADR-033) and re-merging carries the
  // compaction hazard. The message points at the routes that actually work.
  //
  // Placed before the triage so it precedes BOTH `shareTarget.unsupported` toast sites, and in
  // `prepare` rather than in an adapter because every platform's adapter ends here — the
  // deliberate no-platform-branch rule in `services/share/index.ts`.
  //
  // `isBeanpodFileName` is the STRICT predicate: a shared `.json` is not claimed away from the
  // document reader.
  if (stamped.some((f) => isBeanpodFileName(f.name))) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'beanpod offered on the share sheet',
      // `detail` is the fixed enum here, matching the neighbouring `rejected_type` events, NOT a
      // device label — so this site spells the context out instead of spreading platformContext().
      context: { action: 'rejected_type', detail: 'beanpod', os: getPlatform() },
    });
    showToast('info', t('shareTarget.beanpod.title'), t('shareTarget.beanpod.message'));
    return null;
  }

  const verdicts = await Promise.all(stamped.map((f) => isAiPickerAcceptedFile(f)));
  // A text or CSV file is accepted (#107) but is never a DOCUMENT to compress as an image; it is
  // read below as text, exactly like the iOS `.txt` path always has been.
  const usable = stamped.filter((f, i) => verdicts[i] && !isTextLikeFile(f));

  // iOS hands a shared URL over as a `.txt` file in the app-group inbox. Normalising here
  // rather than in that one adapter means a `.txt` shared from ANY platform works, and keeps
  // the adapters free of decisions — which is what `share/types.ts` already asks of them.
  // `withSniffedType` returns the file untouched when the bytes match no signature, so a
  // real text file still declares `text/plain` at this point.
  let text = content.text;
  // Whether `text` came from a shared `.txt` FILE rather than from a caption. The two are
  // treated differently below: a .txt IS the share, a caption merely accompanies files.
  let textFromFile = false;
  // Set when the FILE's byte size puts it unambiguously past the ceiling. See below for why
  // this is a flag and not an early return.
  let overCeilingByBytes = false;
  if (!usable.length && !text) {
    const textFile = stamped.find((f) => isTextLikeFile(f));
    if (textFile) {
      // The ceiling is decided from `File.size` before decoding; see `readTextFile`.
      ({ text, overCeilingByBytes } = await readTextFile(textFile));
      textFromFile = true;
    }
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
    logReceivedKind(SHARE_ENV, 'file', usable.length);
    return { kind: 'documents', files: usable };
  }

  // Files were offered but NONE survived triage (over the size cap, or a type we cannot
  // read), and none of them yielded text either. That is a FILE problem and must be reported
  // as one: falling through to the text branch would quietly read a caption's album link
  // instead and never tell the user their photo was too big. Senders routinely set both
  // extras — Google Photos attaches an album link beside the image.
  //
  // `!textFromFile` is load-bearing, and `!text` is NOT enough: a caption beside an
  // unreadable photo also populates `text`, and reading the caption's link instead of
  // reporting the photo is the exact silent substitution this branch exists to stop. A
  // shared `.txt`, by contrast, IS the share and must reach the link branch.
  if (content.files.length > 0 && !textFromFile) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'nothing usable in share',
      context: { action: 'rejected_type', detail: 'unsupported' },
    });
    showToast('info', t('shareTarget.unsupported.title'), t('shareTarget.unsupported.message'));
    return null;
  }

  if (text) {
    const fromText = await sourceFromText(text, SHARE_ENV, overCeilingByBytes);
    if (fromText) return fromText;
    // `null` means the text was refused and the user already told — but a caption beside
    // files is a different story, and that case returned earlier. Reaching here means the
    // text WAS the share, so the refusal is the whole answer.
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
/**
 * `model: false` marks the two link paths that answer WITHOUT the model (a schema.org JSON-LD
 * page, a title-only fallback). A stated kind (#108) rides the model channel only, so on those
 * paths it was never consulted — and `runIngest` must not report the page's own answer as the
 * model overruling the pick.
 */
type DispatchOutcome = { kind: ShareKind; payload: SharePayload; model: boolean };
/**
 * `statement_detected` (#107) is the unhinted classify answer "this is a bank statement". It is
 * a SIGNAL, never something to dispatch: the classify read was made under the generic consent,
 * without the merchant list, and returns no lines, so `runIngest` hands it to the statement
 * branch. It is not named `transactions` so the compiler can never confuse it with a
 * dispatchable transactions outcome.
 */
type ReadOutcome = { kind: 'none' } | { kind: 'statement_detected' } | DispatchOutcome;
/** What reaches the shared tail: a statement has been read by then, or was never one. */
type FinalOutcome = { kind: 'none' } | DispatchOutcome;

async function read(
  source: ShareSource,
  grant: ConsentGrant,
  env: IngestEnv
): Promise<ReadOutcome | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  // The family fence, BEFORE the model. A read nobody can attribute cannot be counted, and an
  // uncounted read is the loophole the meter exists to close — so this refuses rather than
  // degrading to the proxy's IP limit. `resolveBillableFamilyId` has already logged and toasted.
  const familyId = resolveBillableFamilyId(env);
  if (!familyId) return null;

  const detail = sourceDetail(source);
  const hint = statedKind(source);
  const opts = {
    // `familyId` is REQUIRED, not optional. Absent used to degrade to the proxy's IP limit;
    // under the meter it would be an UNCOUNTED read — the Lambda has no partition key to write
    // under — which is the loophole the meter exists to close. Resolved (and refused) above.
    ...useAiCapability().extractOptions({ grant, familyId }),
    // The person's pick (#108) rides the SAME channel a correction does — `to` is what makes
    // a read targeted — but with no token and `reason: 'stated'`, so it is billed like any
    // first read, never reaches the meter, and the prompt does not claim an earlier reading
    // existed. Folded in HERE, once: documents, pasted text and a fetched link page all read
    // through this one object. The correction arm spreads its own `correction` over it below.
    ...(hint ? { correction: { to: hint, reason: 'stated' as const } } : {}),
  };

  /** Report an extraction failure once, tagged with which funnel it came from. */
  /**
   * `providerDetail` is our own provider layer's message ("invalid api key", "quota exceeded"),
   * not raw upstream response text. It reaches the user because a bare "something went wrong"
   * cost a real family an afternoon: their tier had been switched to BYOK and the key was bad,
   * and the toast named neither fact.
   *
   * It is deliberately NOT logged — the telemetry context is an allowlist, and a provider
   * message is free-form text that could carry anything. `error_code` is the queryable field.
   */
  function failed(errorCode: ExtractionErrorCode | undefined, providerDetail?: string): null {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'share extraction failed',
      context: { action: 'failed', error_code: errorCode, detail },
    });
    reportExtractionFailure(errorCode, providerDetail);
    return null;
  }

  /**
   * What the review modal needs to offer a "not right?" — the prepared payload the model was
   * actually given, plus the grant if the proxy issued one.
   *
   * Both halves come off the SAME result, so they cannot describe different reads. A missing
   * `preparedSource` means the model was never invoked (a JSON-LD or title-only link), and
   * then there is nothing to re-read and correctly no banner.
   */
  function correctableFrom(
    result: DocumentExtractionResult<ShareExtractionResult>
  ): ResultEnvelope['correction'] {
    if (!result.preparedSource) return undefined;
    return { source: result.preparedSource, token: result.data?.correction?.token };
  }

  /**
   * Extract from TEXT and classify the result. Shared verbatim by the link arm (a fetched
   * page's reduced text) and the #83 text arm (what a person selected in another app) —
   * everything downstream of `extractShareFromText` is identical for the two, and writing it
   * twice is how the two funnels would drift.
   */
  // `envelope`, not `env` — `env` is the IngestEnv in scope, and shadowing it here with a
  // ResultEnvelope is exactly the kind of confusion that produces a wrong-funnel event.
  async function readText(text: string, envelope: ResultEnvelope): Promise<ReadOutcome | null> {
    const result = await extractShareFromText(text, opts);
    if (!result.success || !result.data) return failed(result.errorCode, result.error);
    return classify(result.data, { ...envelope, correction: correctableFrom(result) });
  }

  if (source.kind === 'correction') {
    // The prepared payload is re-sent verbatim — never re-prepared. The proxy fingerprints the
    // bytes it received, and a second canvas pass would not reproduce them, so re-preparing
    // would have the grant refused on a document nobody changed.
    //
    // The client text budget is deliberately NOT consumed: a correction that is free of the
    // server count but not of the client cap is not free, and it would fail loudest at exactly
    // the moment someone is correcting a lot — refused by a quota toast while the server grant
    // sits unspent and expires.
    const result = await extractShareFromPreparedSource(source.prepared, {
      ...opts,
      correction: { token: source.token, to: source.to },
    });
    if (!result.success || !result.data) return failed(result.errorCode, result.error);
    // ⚠️ `correction: undefined` is load-bearing, not tidiness. Carrying the spent grant
    // forward would re-render the banner with a token the server will refuse — the free chain
    // the proxy's no-chain invariant forbids, produced on the client instead.
    return classify(result.data, { ...source.env, correction: undefined });
  }

  if (source.kind === 'documents') {
    // ONE call that classifies AND extracts. The page cap lives in the funnel; this
    // orchestrator never counts pages or files.
    const result = await extractShareFromDocuments(source.files, opts);
    if (!result.success || !result.data) return failed(result.errorCode, result.error);
    return classify(result.data, {
      sourceFile: source.files[0],
      compressedBlob: result.compressedBlob,
      truncated: result.truncated,
      origin: env.origin,
      correction: correctableFrom(result),
    });
  }

  if (source.kind === 'text') {
    // CONSUME the budget here, not in `prepare`. This is the last point before an AI call is
    // actually made, so consent having been declined — or any earlier refusal — costs the
    // user nothing. `prepare`'s peek is what makes the refusal cheap and pre-consent; this is
    // what makes it correct.
    const budgetKey = textBudgetKey();
    if (budgetKey) {
      const allowed = consumeAttempt(budgetKey, SHARE_TEXT_BUDGET);
      if (!allowed.ok) {
        refuseForQuota(env, allowed.resetsAt);
        return null;
      }
    }
    // The truncation notice belongs HERE, not in triage: this is the first point at which
    // "beanies read the beginning of it" is actually true — offline has been ruled out,
    // consent has been given, and the budget has just been spent on a real call.
    if (source.truncated) {
      logEvent({
        level: 'info',
        surface: env.surface,
        // NOT `rejected_type`: a truncated read is a success with a notice, and filing it as
        // a rejection would inflate the refusal counter and hide a success.
        message: 'shared text was truncated',
        context: { action: 'truncated', detail: 'text' },
      });
      showToast(
        'info',
        t('shareTarget.text.truncated.title'),
        t('shareTarget.text.truncated.message')
      );
    }

    // ⚠️ `truncated` is deliberately NOT set on the envelope. Every review surface renders
    // `ai.pdfTruncated.*` from it — copy about PAGES, which a text share does not have. The
    // truncation notice is `prepare`'s own toast; setting this too would show two notices,
    // one of them about pages that do not exist.
    return readText(source.text, { sourceFile: null, origin: env.origin });
  }

  // A LINK. `resolveRecipeSource` is reused verbatim — despite the name, its page route
  // carries no recipe policy (the blocklist only picks which link inside a YouTube
  // DESCRIPTION to follow), and its fetch budget is what bounds this path's cost.
  // Dynamic for the same reason as in `prepare` — and free here, since this branch is about
  // to make a multi-second network call anyway. Same pattern `pdfExtractionImages` documents.
  const [{ resolveRecipeSource }, { routeUrl }, { toShareLink }] = await Promise.all([
    import('@/services/ai/recipeSourceResolver'),
    import('@/utils/recipeSourceUrl'),
    import('@/utils/shareLink'),
  ]);
  const resolved = await resolveRecipeSource(source.url);
  const route = routeUrl(source.url);

  switch (resolved.kind) {
    case 'jsonld': {
      // The page declares schema.org Recipe, so it IS a recipe and the values are exact.
      // Classification and extraction in one, with the model never invoked.
      const link = toShareLink(resolved, route);
      logEvent({
        level: 'info',
        surface: env.surface,
        message: 'link resolved',
        context: { action: 'resolved', extraction_path: resolved.path },
      });
      // Named directly rather than routed through `classify`: a JSON-LD hit is not an
      // extraction result and must not be dressed up as one — that is the whole reason
      // `RecipeShareSource` is a union.
      return {
        kind: 'recipe',
        model: false,
        payload: {
          kind: 'recipe',
          source: { via: 'jsonld', recipe: resolved.recipe },
          env: { sourceFile: null, link, origin: env.origin },
        },
      };
    }
    case 'text': {
      const link = toShareLink(resolved, route);
      logEvent({
        level: 'info',
        surface: env.surface,
        message: 'link resolved',
        context: { action: 'resolved', extraction_path: resolved.path },
      });
      return readText(resolved.text, { sourceFile: null, link, origin: env.origin });
    }
    case 'titleOnly': {
      // Same fallback the pasted-link path takes: a named, linked recipe the user finishes
      // themselves, rather than losing a capture they chose deliberately.
      logEvent({
        level: 'info',
        surface: env.surface,
        message: 'link resolved to a title only',
        context: { action: 'resolved', extraction_path: resolved.path, detail: 'title_only' },
      });
      // A title-only stub is an evidence-free RECIPE fallback, not a page-declared answer. If
      // the person said this is something else (#108), a recipe named after a video title is
      // not "what they picked, best effort" — it is a wrong thing. `none` here lets the spine
      // tell them beanies could not read it as their pick, instead of the recipe toast.
      if (hint && hint !== 'recipe') return { kind: 'none' };
      showToast('info', t('recipeExtract.titleOnly.title'), t('recipeExtract.titleOnly.message'));
      return {
        kind: 'recipe',
        model: false,
        payload: {
          kind: 'recipe',
          source: { via: 'titleOnly', title: resolved.title },
          env: {
            sourceFile: null,
            origin: env.origin,
            // Via `toShareLink` rather than a hand-built literal: it produces exactly this
            // shape, and routing through it means the titleOnly path picks up the video
            // thumbnails (#86) instead of being hard-coded to no image — the one case that
            // has no other picture available.
            link: toShareLink(resolved, { kind: 'youtube', url: resolved.sourceUrl }),
          },
        },
      };
    }
    case 'refusal': {
      // `not_a_recipe_url` is unreachable from here — the picker in `prepare` already used
      // `routeUrl` — but the switch stays exhaustive because the pasted-link path reaches it.
      // `refused`, NOT `failed` — matching `processUrl`, which this parallels. A video with
      // an empty description is a correct, expected outcome; folding it into `failed` would
      // make a "failed / received" alarm page on a healthy week when people share Shorts.
      logEvent({
        level: 'warn',
        surface: env.surface,
        message: 'refused to read the link',
        context: { action: 'refused', error_code: resolved.reason },
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
        surface: env.surface,
        message: 'link fetch failed',
        context: { action: 'failed', error_code: resolved.errorCode, detail },
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
  // Fires before anything can fail, so every later event has a denominator.
  //
  // `detail` is deliberately NOT decided here. On iOS — the one platform where a shared link
  // ALWAYS arrives as a file — the extension writes the URL as a `.txt`, so judging from the
  // raw content would label every iOS link share as a file and blind any funnel keyed on
  // `detail='link'`. The verdict is known one function later, so `prepare` emits it.
  logEvent({
    level: 'info',
    surface: SHARE_ENV.surface,
    message: 'share received',
    context: { action: 'received', os: meta.platform, cold_start: meta.coldStart },
  });

  await withIngestLock(SHARE_ENV, async () => {
    // ⚠️ Readiness and triage are SHARE-ONLY and stay outside `runIngest`, in this order.
    // `awaitReadiness` polls for a cold-started app to finish restoring its session, which is
    // meaningless inside a running one; `prepare` is platform triage, which an in-app capture
    // has no equivalent of. Folding either into the shared tail would change the share path's
    // behaviour, which this split exists to avoid.
    if (!(await awaitReadiness())) return;

    const source = await prepare(content, meta);
    if (!source) return; // already logged and toasted

    const grant = await requestConsent();
    if (!grant) {
      logEvent({
        level: 'info',
        surface: SHARE_ENV.surface,
        message: 'consent declined',
        context: { action: 'consent_declined' },
      });
      return;
    }

    await runIngest(source, SHARE_ENV, grant);
  });
}

/**
 * The busy guard, the reading overlay and the outermost catch. Wraps BOTH entry points.
 *
 * ⚠️ Separate from `runIngest` for a REASON, not for symmetry. The busy guard fires before
 * `awaitReadiness` and `prepare`; folding the lock into `runIngest` would move it after them
 * on the share path, which is a behaviour change. This wrapper preserves the current ordering
 * exactly.
 *
 * The lock is shared by both doors deliberately. `isIngesting` is module-level and already
 * means "one AI read at a time, app-wide": an in-app capture must contend for it, or a share
 * arriving mid-capture doubles the AI spend. It is also what drives
 * `isReadingSharedDocument`, so the in-app path inherits the globally-mounted
 * `AiProcessingOverlay` with no new code at all.
 */
async function withIngestLock(
  env: IngestEnv,
  run: () => Promise<void>,
  facts: ReadingFacts = {}
): Promise<void> {
  const { presentation = 'global', hint } = facts;
  const { showToast } = useToast();
  const { t } = useTranslation();

  if (isIngesting.value) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'ingest arrived while busy',
      context: { action: 'busy' },
    });
    showToast('info', t('shareTarget.busy.title'), t('shareTarget.busy.message'));
    return;
  }
  // `presentation` is decided HERE, not after triage. `runIngest` used to downgrade to
  // 'local' several awaits later — `withSniffedType` reads the file — so an in-form capture
  // painted the full-screen overlay over the very fields the scoped one exists to keep
  // visible, then swapped. A triage refusal never reached `runIngest` at all, so the user saw
  // only the wrong overlay for the whole thing. The same applies to `hint`: the overlay must
  // light the picked tile from the first frame, not once triage has run.
  ingestState.value = { phase: 'reading', presentation, ...(hint ? { hint } : {}) };

  try {
    await run();
  } catch (err) {
    // A native listener rejection escapes Vue's error handler entirely, so this catch is the
    // only thing between a throw and a user who is told nothing.
    reportError({
      surface: env.surface,
      message: 'ingest threw',
      // Not `critical`: nothing is persisted at this point, so no user data is at risk.
      severity: 'error',
      error: err,
      context: { action: 'threw' },
    });
    showToast('error', t('ai.error.title'), t('ai.error.generic'));
  } finally {
    ingestState.value = { phase: 'idle' };
  }
}

// ─── The statement branch (#107) ───────────────────────────────────────────────────────

/** Did the person SAY this is a statement (the Transactions tile, or a correction to it)? */
function isStatedStatement(source: ShareSource): boolean {
  return source.kind === 'correction'
    ? source.to === 'transactions'
    : source.hint === 'transactions';
}

/**
 * What the statement reader should be given for this source, or `null` when it cannot be read
 * as a statement at all (a link: a statement is never a web page we fetch).
 *
 * Several shared screenshots are ALL read, one unit each (a week of transactions is often more
 * than one screen). A statement is one PDF, so with a PDF among the files the first PDF is the
 * statement. A correction of a PDF re-reads the ORIGINAL file, because the prepared source it
 * carries is what the classify read sent, capped at the first five pages. Photos keep the
 * prepared source: it carries EVERY image the first read sent, where the envelope's file is only
 * the first. (A corrected long paste is still the first 10 000 characters: the envelope keeps no
 * fuller copy. Choosing Transactions before reading avoids it, and the too-long toast says so.)
 */
function statementInputFrom(source: ShareSource): StatementInput | null {
  const fromFiles = (files: File[]): StatementInput | null => {
    const pdf = files.find((f) => isPdfFile(f));
    if (pdf) return { kind: 'pdf', file: pdf };
    return files.length ? { kind: 'image', files } : null;
  };
  switch (source.kind) {
    case 'documents':
      return fromFiles(source.files);
    case 'text': {
      const text = source.full ?? source.text;
      return { kind: 'text', text, source: looksLikeCsv(text) ? 'csv' : 'text' };
    }
    case 'correction': {
      const original = source.env.sourceFile;
      return original && isPdfFile(original)
        ? { kind: 'pdf', file: original }
        : { kind: 'prepared', source: source.prepared };
    }
    case 'link':
      return null;
    default:
      return assertNever(source, 'statementInputFrom');
  }
}

/**
 * Read a statement, page by page, into a `transactions` payload (#107).
 *
 * Kept to one shape, prepare units → consent → budget → read → map, so the whole branch fits on
 * one screen. Anything that wants to grow here belongs in `statementExtraction.ts` (reading) or
 * `statementImportStore` (review), not in the spine.
 *
 * Returns into `runIngest`'s shared tail, which runs the reader gate, the resolve hold and the
 * dispatch for this kind exactly as for the others. `null` means already logged and toasted.
 */
async function runStatementBranch(
  source: ShareSource,
  env: IngestEnv,
  entry: 'hinted' | 'corrected' | 'unhinted'
): Promise<FinalOutcome | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();

  // The reader gate BEFORE any page is rendered or any bean spent. The tail checks it again,
  // but by then an unhinted statement from a member without finance access would already have
  // been read and paid for.
  if (!isReaderEnabled('statement')) {
    logEvent({
      level: 'warn',
      surface: env.surface,
      message: 'target reader unavailable',
      context: { action: 'reader_disabled', kind: 'transactions' },
    });
    showToast('info', t('shareTarget.readerOff.title'), t('shareTarget.readerOff.message'));
    return null;
  }
  if (entry !== 'hinted') {
    logEvent({
      level: 'info',
      surface: 'statement-import',
      message: 'reclassified',
      context: { action: 'reclassified', detail: entry },
    });
  }

  const input = statementInputFrom(source);
  if (!input) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'this cannot be read as a statement',
      context: { action: 'rejected_type', detail: 'unsupported' },
    });
    showToast('info', t('shareTarget.unsupported.title'), t('shareTarget.unsupported.message'));
    return null;
  }

  let prepared: Awaited<ReturnType<typeof prepareStatementUnits>>;
  try {
    prepared = await prepareStatementUnits(input);
  } catch (err) {
    // A corrupt or password-protected PDF, an undecodable image, an out-of-memory render. The
    // shared mapping shows the `compression` toast; the console carries what to check.
    console.error(
      '[statement-import] could not prepare the statement for reading: a corrupt or ' +
        'password-protected PDF, an undecodable image, or an out-of-memory render.',
      err
    );
    const code = err instanceof CompressionError ? 'compression' : 'provider_error';
    logEvent({
      level: 'warn',
      surface: 'statement-import',
      message: 'prepare_failed',
      context: { action: 'failed', error_code: code, detail: input.kind },
    });
    reportExtractionFailure(code);
    return null;
  }
  if (prepared.units.length === 0) return { kind: 'none' };

  // The statement consent, now that the cost is known. Asked on EVERY path into this branch:
  // a generic grant never covered the merchant list this read sends.
  const grant = await requestConsent({ kind: 'transactions', reads: prepared.units.length });
  if (!grant) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'consent declined',
      context: { action: 'consent_declined', kind: 'transactions' },
    });
    return null;
  }

  // The text budget, all at once and before any call: refusing on chunk 3 of 5 would have spent
  // two slots on reads that never happen. Image units are not text-budgeted, exactly as today.
  const budgetKey = prepared.textUnits > 0 ? textBudgetKey() : null;
  if (budgetKey) {
    const allowed = consumeAttempts(budgetKey, SHARE_TEXT_BUDGET, prepared.textUnits);
    if (!allowed.ok) {
      refuseForQuota(env, allowed.resetsAt);
      return null;
    }
  }

  const familyId = resolveBillableFamilyId(env);
  if (!familyId) return null; // already logged and toasted

  const context = buildStatementContext(
    useTransactionsStore().transactions,
    useFamilyStore().members.map((m) => m.name)
  );
  logEvent({
    level: 'info',
    surface: 'statement-import',
    message: 'merchant_memory',
    context: { action: 'merchant_memory', count: context.merchants.length },
  });

  const outcome = await readStatement(
    prepared,
    useAiCapability().extractOptions({ grant, familyId, context }),
    (progress) => {
      const state = ingestState.value;
      if (state.phase === 'reading') ingestState.value = { ...state, progress };
    }
  );
  if (!outcome.ok) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'share extraction failed',
      context: { action: 'failed', error_code: outcome.errorCode, kind: 'transactions' },
    });
    reportExtractionFailure(outcome.errorCode);
    return null;
  }
  const { result } = outcome.read;
  if (!result.isStatement || result.lines.length === 0) return { kind: 'none' };

  // The first unit's source is what a "not right?" re-reads as another kind. No token: a
  // statement read is never granted a free correction, and the banner says so.
  const firstUnit = prepared.units[0]!.source;
  return {
    kind: 'transactions',
    model: true,
    payload: {
      kind: 'transactions',
      data: outcome.read,
      env: {
        sourceFile:
          input.kind === 'pdf' ? input.file : input.kind === 'image' ? input.files[0]! : null,
        origin: env.origin,
        correction: { source: firstUnit },
      },
    },
  };
}

/**
 * The shared tail: offline → consent → read → classify → none → reader gate → dispatch.
 *
 * Everything from here down is identical whichever door the content came in by, which is
 * exactly why it is one function. The ONLY thing the two entry points disagree about is how a
 * `ShareSource` was obtained.
 */
async function runIngest(
  source: ShareSource,
  env: IngestEnv,
  consent: ConsentGrant | DeferredStatementConsent,
  destination?: InAppDestination
): Promise<void> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  // ⚠️ Offline is checked AFTER consent now, at both entry points, and that is a deliberate
  // trade rather than an oversight. Consent moved out to the callers (the door mints at the
  // commit, before its picker; the share path as soon as `prepare` yields a usable source), so
  // the order is consent → offline everywhere instead of two orderings that could drift.
  //
  // The cost is that an offline user answers a privacy prompt and is then told they are
  // offline. `FamilyPlannerPage` accepted exactly this trade in writing — "consent-first is the
  // privacy-correct order" — and nothing leaves the device either way. The previous comment
  // here claimed the old triage → offline → consent order was preserved; it is not.
  const { reportExtractionFailure } = useExtractionErrorToast();
  if (!useOnline().isOnline.value) {
    reportExtractionFailure('offline');
    return;
  }

  // ADR-030 consent is already minted by the caller — REQUIRED here, never optional, so an
  // unthreaded call site is a compile error rather than a silent ungated read. Both entry
  // points now mint at the same point in their own flow (the in-app door at the commit, before
  // its picker; the share path as soon as `prepare` yields a usable source), which is what
  // makes them one rule rather than two orderings that can drift.
  //
  // A STATEMENT (#107) is the one exception, and it is settled HERE, in these few lines, so
  // `read()` and everything below it keep their plain `ConsentGrant`. A source the person
  // labelled a statement (the Transactions tile, or "not right? → Transactions") goes straight
  // to the statement branch, which asks its own consent once the page count is known. A
  // deferred marker anywhere else refuses out loud: it is not a grant, and nothing is read.
  let outcome: FinalOutcome | null;
  if (isStatedStatement(source)) {
    outcome = await runStatementBranch(
      source,
      env,
      source.kind === 'correction' ? 'corrected' : 'hinted'
    );
  } else if (isDeferredStatementConsent(consent)) {
    notReady(env, 'consent_deferred_wrong_kind', 'ai.error.title', 'ai.error.generic');
    return;
  } else {
    const first = await read(source, consent, env);
    outcome =
      first?.kind === 'statement_detected'
        ? await runStatementBranch(source, env, 'unhinted')
        : first;
  }
  if (!outcome) return; // already logged and toasted

  // The stated kind (#108) counts only where the model actually saw it. A JSON-LD or
  // title-only link answers from the page itself, so there the pick was never applied: say so
  // once, and treat the read as unhinted from here on — the page's answer is not the model
  // overruling anything, and the "not right?" the overruled toast promises does not exist.
  const stated = statedKind(source);
  const bySurface = source.kind !== 'correction' && !!source.hintFromSurface;
  const hint = stated && outcome.kind !== 'none' && !outcome.model ? undefined : stated;
  if (stated && !hint) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'the stated kind was not consulted: the link answered without the model',
      context: { action: 'hint_unused', kind: stated, detail: bySurface ? 'surface' : 'person' },
    });
    // Never silently: the overlay lit their tile and the answer is about to land somewhere
    // else. One line, no promise of a "not right?" (a page-declared result has none). Not for a
    // surface's own pre-pick the page agrees with: nobody picked anything, and nothing moved.
    if (!bySurface || outcome.kind !== stated) {
      showToast('info', t('ai.capture.title'), t('ai.capture.pick.unused'));
    }
  }
  logEvent({
    level: 'info',
    surface: env.surface,
    message: 'share classified',
    // `detail` is how a read was steered, so "did the model return the stated kind" is this
    // event's `kind` against the preceding `hinted` event's, filtered on `detail: 'hinted'`.
    context: {
      action: 'classified',
      kind: outcome.kind,
      detail:
        source.kind === 'correction'
          ? 'corrected'
          : hint
            ? bySurface
              ? 'surface_hinted'
              : 'hinted'
            : 'unhinted',
    },
  });

  if (outcome.kind === 'none') {
    // Under a stated kind, "none" means "not that" — say which, and what to do (#108).
    if (hint) hintDisagreed(env, hint, bySurface);
    else {
      showToast('info', t('shareTarget.unrecognised.title'), t('shareTarget.unrecognised.message'));
    }
    return;
  }

  // Is the destination reader actually available to this member? Permission AND flag — say
  // so rather than routing into a silent no-op.
  const reader = readerForShareKind(outcome.kind);
  if (!isReaderEnabled(reader)) {
    logEvent({
      level: 'warn',
      surface: env.surface,
      message: 'target reader unavailable',
      context: { action: 'reader_disabled', kind: outcome.kind },
    });
    showToast('info', t('shareTarget.readerOff.title'), t('shareTarget.readerOff.message'));
    return;
  }

  // The model was told the kind and chose another. The read is spent and the extraction is
  // real, so it is DELIVERED — but never silently: the person is told which kind beanies read,
  // and "not right?" is at the foot of the modal that opens. Deliberately AFTER the reader gate:
  // that toast promises a review, which only exists once the gate has passed, and a kind whose
  // reader is off has already been reported once above.
  if (hint && outcome.kind !== hint) hintOverruled(env, hint, outcome.kind, bySurface);

  // Hold the resolved tile long enough to be seen. Only on a DISPATCHED outcome — never on
  // `none`, never on a refusal, where there is nothing to resolve to.
  const current = ingestState.value;
  if (current.phase !== 'idle') {
    ingestState.value = {
      phase: 'resolved',
      presentation: current.presentation,
      kind: outcome.kind,
    };
    // Only where there is something to SEE resolve. The hold exists so the app-shell overlay's
    // three tiles can fade to one; a `local` door renders no tiles, so there it is 700ms of a
    // frozen spinner with Save dead, for a beat nobody watches.
    if (current.presentation === 'global' && !prefersReducedMotion()) {
      await new Promise((resolve) => setTimeout(resolve, RESOLVE_HOLD_MS));
    }
  }

  // A door that can consume this kind itself gets first refusal. A THROW here falls through to
  // the dispatch and is reported: this is the one path meaning "we charged a bean and lost the
  // answer", so it must never end in silence.
  let claimed = false;
  if (destination) {
    try {
      claimed = destination.claim(outcome.payload);
    } catch (err) {
      reportError({
        surface: env.surface,
        message: 'a local destination threw on an extracted capture',
        severity: 'error',
        error: err,
        context: { action: 'threw', kind: outcome.kind },
      });
    }
  }

  if (!claimed) dispatchSharePayload(outcome.payload);
  logEvent({
    level: 'info',
    surface: env.surface,
    message: 'share ready for review',
    // `detail` here is what gives each source's conversion rate a denominator: the `triaged`
    // event already carries it, so filtering on one value follows a capture from arrival to
    // review without the funnels sharing a counter.
    context: { action: 'ready', kind: outcome.kind, detail: sourceDetail(source) },
  });
}

// ─── The IN-APP entry point (#84) ────────────────────────────────────────────────────────

/** Exported so a door can name this funnel when it refuses early (`refuseIfBusy`). */
export const IN_APP_ENV: IngestEnv = { surface: 'magic-beans-capture', origin: 'in-app' };

/** What the magic-beans sheet can hand over. A camera shot and a picked file are the same
 *  thing once a `File` exists, so there are two arms rather than three. */
export type InAppInput =
  /**
   * `hint` on both first-read arms: the kind the person stated in the sheet before the read
   * (#108). Authoritative for the prompt; never sent to the meter. Absent = "let beanies
   * work it out", which is the default and the common case.
   */
  | { kind: 'file'; file: File; hint?: ShareKind; hintFromSurface?: boolean }
  | { kind: 'paste'; text: string; hint?: ShareKind; hintFromSurface?: boolean }
  /**
   * A re-read of a document the spine has ALREADY resolved, as the kind the user says it
   * actually is. Raised by `MagicMiscategorisedBanner` from inside a review modal.
   *
   * It carries the WHOLE envelope, not a `source` + `token` pair, and that is what makes
   * `sourceFile`, `compressedBlob`, `truncated`, `link` and `origin` survive BY CONSTRUCTION
   * rather than by four hand-copied fields. Without it a dish photo misread as travel and
   * corrected to recipe would open the recipe form with no photo to attach — silently.
   *
   * Skips triage (it already ran, on these exact bytes) and the text budget (it is free).
   */
  | { kind: 'correction'; env: ResultEnvelope; from: ShareKind; to: ShareKind };

/**
 * A door that fills ITSELF in rather than dispatching by kind.
 *
 * Exactly one exists: `RecipeFormModal`. It runs from five mount points (the meal editor, the
 * recipe rail, the favourite picker, the recipe detail page, the cookbook) and delivers into
 * its own fields — dispatching by kind would `router.push('/pod/cookbook')` and UNMOUNT the
 * form the user is filling in at four of those five.
 *
 * An OBJECT rather than a bare callback so a second concern becomes a field here rather than a
 * fourth parameter on `ingestInAppSource`, and `IngestEnv` stays the label its header insists
 * it is.
 */
export interface InAppDestination {
  /**
   * Offered the payload FIRST. `true` keeps it here; `false` or absent falls through to
   * `dispatchSharePayload`, so a school invite pasted into the recipe form still becomes an
   * activity on the Activities page.
   */
  claim(payload: SharePayload): boolean;
}

/**
 * Record that someone opened the magic-beans sheet (#84).
 *
 * ⚠️ This is the DENOMINATOR, so it must fire when the sheet OPENS — not when an ingest
 * starts. Fired at the ingest it would only ever count captures the user went through with,
 * making the rate equal to the numerator: opening the sheet and abandoning it would be
 * indistinguishable from never tapping the button at all, and "is anybody using this?" —
 * the first question this feature has to answer — would be unanswerable.
 *
 * Exported so the card can call it at the tap while `IN_APP_ENV` stays private here.
 */
export function logCaptureOpened(): void {
  logEvent({
    level: 'info',
    surface: IN_APP_ENV.surface,
    message: 'capture opened',
    context: { action: 'opened' },
  });
}

/**
 * Read something the user handed over from INSIDE beanies, and route it by what the AI says
 * it is — the same pipeline a share goes through (#84).
 *
 * ── Why this lives here, beside `ingestSharedContent` ─────────────────────────────────
 *
 * It uses four of this file's private helpers (`withIngestLock`, `runIngest`,
 * `sourceFromText`, `notReady`), and putting the two entry points on one screen is what makes
 * a divergence between them visible. A separate composable would hide exactly the drift this
 * change exists to remove.
 *
 * A plain exported FUNCTION, not a composable: `prepare` already runs from a native listener
 * outside `setup()`, and this file deliberately holds no lifecycle hooks.
 *
 * ⚠️ If a FIFTH source ever appears, the seam to cut is `prepare`/`read` into a `share/`
 * module pair — NOT "one composable per entry point". Two entry points is the maximum this
 * shape supports; a third means the split above.
 */
export async function ingestInAppSource(
  input: InAppInput,
  /**
   * A real grant, or (#107) the deferred marker the door passes for the Transactions pick,
   * whose consent is asked once the statement's page count is known. `runIngest` settles which
   * in its first lines; nothing below it ever sees the marker.
   */
  consent: ConsentGrant | DeferredStatementConsent,
  destination?: InAppDestination
): Promise<void> {
  const { showToast } = useToast();
  const { t } = useTranslation();
  // Read off the INPUT once, here, because the lock is taken before a `ShareSource` exists.
  // Everywhere downstream derives it from the source (`statedKind`).
  const hint = input.kind === 'correction' ? undefined : input.hint;

  await withIngestLock(
    IN_APP_ENV,
    async () => {
      // ⚠️ `awaitReadiness` is deliberately NOT called: auth and family are settled inside a
      // running app, and its polling loop would be dead time. But ONE of its four preconditions
      // still applies here — `isConfigured` is false for BYOK-without-a-key and for on-device,
      // and without this check the user pays a consent prompt for a call that is guaranteed to
      // fail at extraction. Same `notReady` site the share path uses, so there is one toast and
      // one log for "not set up yet" rather than two phrasings of it.
      if (!useAiCapability().isConfigured.value) {
        notReady(IN_APP_ENV, 'ai_unconfigured', 'ai.unavailable.title', 'ai.unavailable.message');
        return;
      }

      // The model-quality signal, emitted HERE rather than in the banner: the `from`/`to` pair
      // is the first thing to look at before touching the prompt, and a signal a caller has to
      // remember to emit is one a second caller will not.
      if (input.kind === 'correction') {
        logEvent({
          level: 'info',
          surface: IN_APP_ENV.surface,
          message: 'beanies read this as the wrong kind',
          context: { action: 'corrected', kind: input.to, detail: input.from },
        });
      }

      // The pick's DENOMINATOR (#108), beside the correction's for the same reason: emitted
      // before triage, so it counts every stated read, including one triage then refuses.
      // `classified` carries `detail: 'hinted'` for the post-triage count.
      // A surface's own pre-pick is logged apart (`surface_hinted`), so this stays a count of
      // PEOPLE telling beanies what a thing is.
      if (hint) {
        const bySurface = input.kind !== 'correction' && !!input.hintFromSurface;
        logEvent({
          level: 'info',
          surface: IN_APP_ENV.surface,
          message: bySurface ? 'the surface said what this is' : 'the person told us what this is',
          context: { action: bySurface ? 'surface_hinted' : 'hinted', kind: hint },
        });
      }

      const source = await inAppSource(input, showToast, t);
      if (!source) return; // already logged and toasted

      await runIngest(source, IN_APP_ENV, consent, destination);
    },
    {
      // A door that will CLAIM the payload is by definition the door the user is looking at,
      // so it scopes its own overlay and the app-shell one must stand down — from the first
      // frame, not from several awaits later.
      presentation: destination ? 'local' : 'global',
      hint,
    }
  );
}

/**
 * Turn an in-app input into a `ShareSource`, or refuse it out loud.
 *
 * Three lines of triage and then the shared tail — everything about WHAT is acceptable comes
 * from the same two helpers the share path uses (`withSniffedType` + `isAiPickerAcceptedFile`
 * for files, `sourceFromText` for text). There is deliberately no second accept policy and no
 * second text policy here.
 */
async function inAppSource(
  input: InAppInput,
  showToast: ReturnType<typeof useToast>['showToast'],
  t: ReturnType<typeof useTranslation>['t']
): Promise<ShareSource | null> {
  if (input.kind === 'paste') {
    // A statement the person SAID is a statement (#107) skips the share text policy: that
    // policy caps a message at 10 000 characters and refuses past 32 000, and a month of
    // transactions is routinely both. The statement reader bounds itself, in chunks, and its
    // consent states the read count. Only the floor still applies.
    if (input.hint === 'transactions') {
      return statedStatementText(input.text, input.hintFromSurface);
    }
    // The pick rides on whatever `sourceFromText` decided — text OR a link — so a pasted URL
    // keeps it too. Attached here, once, rather than inside the shared text policy.
    const source = await sourceFromText(input.text, IN_APP_ENV);
    return source && { ...source, hint: input.hint, hintFromSurface: input.hintFromSurface };
  }

  if (input.kind === 'correction') {
    // The banner only renders when `env.correction` exists, so this is a should-not-happen —
    // which is exactly why it refuses out loud rather than falling through to a re-prepare
    // that would be refused server-side and charged.
    const carried = input.env.correction;
    if (!carried) {
      notReady(IN_APP_ENV, 'no_prepared_source', 'ai.error.title', 'ai.error.generic');
      return null;
    }
    return {
      kind: 'correction',
      prepared: carried.source,
      token: carried.token,
      to: input.to,
      env: input.env,
    };
  }

  // Re-stamp with the type the BYTES say it is, exactly as `prepare` does — a PDF declared
  // `application/octet-stream` must not be accepted and then compressed as an image.
  const stamped = await withSniffedType(input.file);

  // ⚠️ Size is checked SEPARATELY from acceptance, on purpose. `isAiPickerAcceptedFile`
  // returns one boolean for "empty", "too big" and "not a type we read". At the share boundary
  // one message for all three was right, because the user did not choose the file. In-app they
  // did choose it, and "too big, here is the limit" is actionable where "can't read that" is
  // not. This check must come FIRST, or the size case falls into the generic message.
  if (stamped.size > AI_PICKER_MAX_BYTES) {
    logEvent({
      level: 'info',
      surface: IN_APP_ENV.surface,
      message: 'capture file too large',
      context: { action: 'rejected_type', detail: 'too_large' },
    });
    showToast('info', t('ai.picker.tooLarge.title'), t('ai.picker.tooLarge.message'));
    return null;
  }

  if (!(await isAiPickerAcceptedFile(stamped))) {
    logEvent({
      level: 'info',
      surface: IN_APP_ENV.surface,
      message: 'capture file unreadable',
      context: { action: 'rejected_type', detail: 'unsupported' },
    });
    showToast('info', t('shareTarget.unsupported.title'), t('shareTarget.unsupported.message'));
    return null;
  }

  // A text or CSV file (#107) is TEXT, never an image to compress. Through the same text
  // policy a paste gets, unless it is a stated statement, which bounds itself.
  if (isTextLikeFile(stamped)) {
    const stated = input.hint === 'transactions';
    const { text, overCeilingByBytes } = await readTextFile(stamped, stated);
    if (stated) return statedStatementText(text, input.hintFromSurface);
    const source = await sourceFromText(text, IN_APP_ENV, overCeilingByBytes);
    return source && { ...source, hint: input.hint, hintFromSurface: input.hintFromSurface };
  }

  logReceivedKind(IN_APP_ENV, 'file', 1);
  return {
    kind: 'documents',
    files: [stamped],
    hint: input.hint,
    hintFromSurface: input.hintFromSurface,
  };
}

/**
 * A statement's text, as the person handed it over (#107). Only the floor applies here; see the
 * paste arm for why the share text policy's cap and ceiling do not.
 */
function statedStatementText(text: string, hintFromSurface?: boolean): ShareSource | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_SHARE_TEXT_CHARS) {
    const { showToast } = useToast();
    const { t } = useTranslation();
    logEvent({
      level: 'info',
      surface: IN_APP_ENV.surface,
      message: 'shared text was too short to read',
      context: { action: 'rejected_type', detail: 'too_short', kind: 'transactions' },
    });
    showToast('info', t('shareTarget.text.tooShort.title'), t('shareTarget.text.tooShort.message'));
    return null;
  }
  logReceivedKind(IN_APP_ENV, 'text', 0);
  return { kind: 'text', text: trimmed, truncated: false, hint: 'transactions', hintFromSurface };
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
      return { kind: 'event', model: true, payload: { kind: 'event', data: data.event, env } };
    case 'travel':
      return { kind: 'travel', model: true, payload: { kind: 'travel', data: data.travel, env } };
    case 'recipe':
      return {
        kind: 'recipe',
        model: true,
        payload: { kind: 'recipe', source: { via: 'extraction', data: data.recipe }, env },
      };
    case 'transactions':
      // Lineless on purpose; the statement branch reads the lines (see `ReadOutcome`).
      return { kind: 'statement_detected' };
    default:
      return assertNever(data, 'shareKind');
  }
}
