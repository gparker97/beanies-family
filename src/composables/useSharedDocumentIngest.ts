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
import { consumeAttempt, peekAttempt } from '@/utils/attemptBudget';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTime12, toTimeInputValue } from '@/utils/date';
import { extractUrls } from '@/utils/url';
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
import type { ExtractionErrorCode, ShareExtractionResult } from '@/services/ai/types';
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
type ShareSource =
  | { kind: 'documents'; files: File[] }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string; truncated: boolean };

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
    default:
      return assertNever(source, 'shareSourceDetail');
  }
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
): Promise<ShareSource | null> {
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
  return { kind: 'text', text: boundText(trimmed, MAX_SHARE_TEXT_CHARS), truncated };
}

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
  // Whether `text` came from a shared `.txt` FILE rather than from a caption. The two are
  // treated differently below: a .txt IS the share, a caption merely accompanies files.
  let textFromFile = false;
  // Set when the FILE's byte size puts it unambiguously past the ceiling. See below for why
  // this is a flag and not an early return.
  let overCeilingByBytes = false;
  if (!usable.length && !text) {
    const textFile = stamped.find((f) => f.type === 'text/plain');
    if (textFile) {
      // Decide the band from `File.size` BEFORE decoding. Reading a fixed
      // `MAX_SHARE_TEXT_CHARS * 4` slice — as this did until #83 — silently reduced a
      // 50,000-character iOS share to 4,000 characters before any band logic could see it,
      // so it could never be classified `over_ceiling` and looked like an ordinary under-cap
      // share. That is exactly the "silently reads the first slice of a wall of text"
      // behaviour the size policy exists to prevent.
      //
      // ⚠️ This sets a FLAG rather than returning. iOS delivers a shared URL as a `.txt`, and
      // a mail-app selection can exceed the byte bound, so refusing here would break a `.txt`
      // that BEGINS WITH A LINK — which takes the link path today and must keep doing so. The
      // verdict is applied only in the no-URL fallback below.
      overCeilingByBytes = textFile.size > MAX_SHARE_TEXT_BYTES;
      // The slice in the non-over-ceiling arm is belt-and-braces against a lying `File.size`,
      // NOT the working bound — the two numbers are equal, so it never clips a file that is
      // actually used and can never split a UTF-8 sequence. Deliberate; not dead code.
      text = await textFile
        .slice(0, overCeilingByBytes ? MAX_SHARE_TEXT_CHARS * 4 : MAX_SHARE_TEXT_BYTES)
        .text();
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
type ReadOutcome = { kind: 'none' } | { kind: ShareKind; payload: SharePayload };

async function read(
  source: ShareSource,
  grant: ConsentGrant,
  env: IngestEnv
): Promise<ReadOutcome | null> {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  const { tier, byokConfig } = useAiCapability();
  const detail = sourceDetail(source);
  const opts = {
    tier: tier.value,
    todayIso: toDateInputValue(new Date()),
    byok: byokConfig.value ?? undefined,
    grant,
    // Lets the proxy rate-limit per family (#83). Absent is a supported state, not an error:
    // the Lambda falls back to its IP limit. Read from the context store rather than the AI
    // layer, which is deliberately store-free.
    familyId: useFamilyContextStore().activeFamilyId ?? undefined,
  };

  /** Report an extraction failure once, tagged with which funnel it came from. */
  function failed(errorCode: ExtractionErrorCode | undefined): null {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'share extraction failed',
      context: { action: 'failed', error_code: errorCode, detail },
    });
    reportExtractionFailure(errorCode);
    return null;
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
    if (!result.success || !result.data) return failed(result.errorCode);
    return classify(result.data, envelope);
  }

  if (source.kind === 'documents') {
    // ONE call that classifies AND extracts. The page cap lives in the funnel; this
    // orchestrator never counts pages or files.
    const result = await extractShareFromDocuments(source.files, opts);
    if (!result.success || !result.data) return failed(result.errorCode);
    return classify(result.data, {
      sourceFile: source.files[0],
      compressedBlob: result.compressedBlob,
      truncated: result.truncated,
      origin: env.origin,
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
      showToast('info', t('recipeExtract.titleOnly.title'), t('recipeExtract.titleOnly.message'));
      return {
        kind: 'recipe',
        payload: {
          kind: 'recipe',
          source: { via: 'titleOnly', title: resolved.title },
          env: {
            sourceFile: null,
            origin: env.origin,
            link: {
              pageUrl: resolved.sourceUrl,
              provenanceUrl: resolved.sourceUrl,
              imageUrl: '',
              path: resolved.path,
              kind: 'youtube',
            },
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

    await runIngest(source, SHARE_ENV);
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
async function withIngestLock(env: IngestEnv, run: () => Promise<void>): Promise<void> {
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
  isIngesting.value = true;

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
    isIngesting.value = false;
  }
}

/**
 * The shared tail: offline → consent → read → classify → none → reader gate → dispatch.
 *
 * Everything from here down is identical whichever door the content came in by, which is
 * exactly why it is one function. The ONLY thing the two entry points disagree about is how a
 * `ShareSource` was obtained.
 */
async function runIngest(source: ShareSource, env: IngestEnv): Promise<void> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  // Offline sits between triage and consent — every `ShareSource` is produced without a
  // network call, so the file path's original ordering (triage → offline → consent → extract)
  // is preserved.
  const { reportExtractionFailure } = useExtractionErrorToast();
  if (!useOnline().isOnline.value) {
    reportExtractionFailure('offline');
    return;
  }

  // ADR-030 consent, before a single byte leaves the device — and before the FETCH, not just
  // the extraction. A third-party app cannot cause a document or a page to be read without
  // the user seeing this, and neither can a mis-tap inside beanies.
  const grant = await requestConsent();
  if (!grant) {
    logEvent({
      level: 'info',
      surface: env.surface,
      message: 'consent declined',
      context: { action: 'consent_declined' },
    });
    return;
  }

  const outcome = await read(source, grant, env);
  if (!outcome) return; // already logged and toasted

  logEvent({
    level: 'info',
    surface: env.surface,
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
      surface: env.surface,
      message: 'target reader unavailable',
      context: { action: 'reader_disabled', kind: outcome.kind },
    });
    showToast('info', t('shareTarget.readerOff.title'), t('shareTarget.readerOff.message'));
    return;
  }

  dispatchSharePayload(outcome.payload);
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

const IN_APP_ENV: IngestEnv = { surface: 'magic-beans-capture', origin: 'in-app' };

/** What the magic-beans sheet can hand over. A camera shot and a picked file are the same
 *  thing once a `File` exists, so there are two arms rather than three. */
export type InAppInput = { kind: 'file'; file: File } | { kind: 'paste'; text: string };

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
export async function ingestInAppSource(input: InAppInput): Promise<void> {
  const { showToast } = useToast();
  const { t } = useTranslation();

  await withIngestLock(IN_APP_ENV, async () => {
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

    const source = await inAppSource(input, showToast, t);
    if (!source) return; // already logged and toasted

    await runIngest(source, IN_APP_ENV);
  });
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
    return sourceFromText(input.text, IN_APP_ENV);
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

  logReceivedKind(IN_APP_ENV, 'file', 1);
  return { kind: 'documents', files: [stamped] };
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
