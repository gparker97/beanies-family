// The one shape every share-target platform implements (#64).
//
// Adapters exist to turn a platform's delivery mechanism into `File[]` and nothing else.
// They contain NO branching on kind, flag, consent or route — every one of those decisions
// belongs to `useSharedDocumentIngest`, so a fourth platform is one file plus one registry
// entry rather than another copy of the flow. If an adapter needs a second decision, that is
// the signal the decision belongs in the orchestrator.

import type { ShareMeta } from '@/composables/useSharedDocumentIngest';
import type { BudgetPolicy } from '@/utils/attemptBudget';

export type SharePlatform = ShareMeta['platform'];

/**
 * What a share actually carried. Adapters produce this and nothing else.
 *
 * `text` is whatever the sender attached as text — a bare link, prose around a link, or
 * plain text with no link at all. Deciding what to DO with it (files win, extract the URL,
 * or say there is no link) belongs to the orchestrator, not to three adapters.
 */
export interface SharedContent {
  files: File[];
  text?: string;
}

// ── The text-size policy, all three bounds in one place (#83) ────────────────────────────
//
// Three bands, and they answer different questions — do NOT "reconcile" them:
//
//   ≤ MAX_SHARE_TEXT_CHARS            read in full
//   ≤ MAX_SHARE_TEXT_CEILING          truncate to the cap, and TELL the user
//   > MAX_SHARE_TEXT_CEILING          refuse outright, with no AI call
//
// Bands are decided from the ORIGINAL string's trimmed length, never from the capped copy
// `prepare()` builds for URL extraction — that copy is ≤ the cap by construction, so band
// logic reading it could never see the truncate or refuse bands at all.

/**
 * The share-boundary cap on sender-supplied text: how much we actually READ.
 *
 * Enforced in the ORCHESTRATOR so every platform is bounded identically — an earlier draft
 * capped only in the Android plugin, which left the PWA path feeding an unbounded string
 * into a whole-string `split`.
 */
export const MAX_SHARE_TEXT_CHARS = 4000;

/**
 * Above this, a text share is refused outright rather than truncated.
 *
 * Deliberately EQUAL to the Lambda's `MAX_TEXT_CHARS` (32,000), but the two answer different
 * questions and must not be folded together: the client truncates to `MAX_SHARE_TEXT_CHARS`
 * before sending, so this value never governs a request body. It is a client-side refusal
 * band — "this is more than a person meant to share" — not a wire bound.
 *
 * `ShareIntentPlugin.java` mirrors `CEILING + 1` (not the read cap) as defence-in-depth, so
 * that JS still sees `length > CEILING` and reaches the same verdict on every platform.
 */
export const MAX_SHARE_TEXT_CEILING = 32_000;

/**
 * Below this — measured AFTER `trim()`, or 30 spaces would pass — a share is refused without
 * an AI call. A couple of words cannot yield a date, time and title, and paying the model to
 * discover that is pure cost.
 */
export const MIN_SHARE_TEXT_CHARS = 25;

/**
 * The DECODE bound for a shared `.txt`, in bytes.
 *
 * Bounds the decode, not just its result: another app can hand over a 100 MB file declaring
 * itself text, and decoding it whole before slicing is the very OOM the cap exists to
 * prevent. UTF-8 is ≤4 bytes per character, so `bytes > 4 · CEILING ⇒ chars > CEILING` — the
 * gate can therefore refuse on size alone, before any decoding. The `+1` is what lets JS
 * distinguish "exactly at the ceiling" from "clipped at the ceiling".
 */
export const MAX_SHARE_TEXT_BYTES = (MAX_SHARE_TEXT_CEILING + 1) * 4;

/**
 * The client-side text-share budget.
 *
 * 20/hour comfortably covers a parent working through an inbox in one sitting (realistic
 * intense use is 5–10). There is deliberately NO cooldown on top: its only purpose would be
 * defeating a scripted loop, and `isIngesting` already serialises shares app-wide and refuses
 * a concurrent one audibly — as do the route throttle and the two server-side limits. Five
 * overlapping limits is four copy strings and four support conversations too many.
 *
 * ⚠️ Per DEVICE, not per family — it lives in `localStorage`. A two-parent, two-device
 * household legitimately reaches 40, which is why the server's family limit is 80 rather
 * than 40.
 *
 * ⚠️ And this budget covers ONLY the bare-text arm. The server's per-family limit is gated on
 * `hasText`, which is also true for a shared LINK (its fetched page text) and for an in-app
 * recipe URL — neither of which touches this budget. So a family that mostly shares links can
 * reach the server limit without ever having seen the friendlier client message. Do not write
 * "a legitimate family always meets the client limit first"; that was asserted here once and
 * is not true as built. Closing the gap means budgeting the link path too, which is a
 * deliberate follow-up, not an accident.
 */
export const SHARE_TEXT_BUDGET: BudgetPolicy = { max: 20, windowMs: 60 * 60_000 };

/**
 * Budget key for a family's text shares.
 *
 * Scoped to the family so switching families cannot inherit a budget — the same reasoning
 * `usePinAttemptLimit`'s `scope` documents. It embeds a family id, so like `scope` it is
 * NEVER logged; the telemetry context is allowlisted and this is not on it.
 */
export function shareTextBudgetKey(familyId: string): string {
  return `share-text:${familyId}`;
}

export interface ShareAdapter {
  name: SharePlatform;
  /** Whether this adapter can run here at all (right platform, plugin present). */
  isSupported(): boolean;
  /**
   * Begin listening. Returns a teardown function.
   *
   * The callback body is the adapter's ONLY logic. Implementations must wrap their own
   * async work in try/catch and report it: a rejection inside a native event listener
   * escapes Vue's error handler entirely, so an unguarded throw here is a share that
   * vanishes with the user told nothing.
   */
  start(onShare: (content: SharedContent, meta: ShareMeta) => void): () => void;
}
