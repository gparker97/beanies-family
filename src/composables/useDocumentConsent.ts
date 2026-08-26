// Shared per-document AI consent gate (ADR-030, #133 + #30).
//
// Every path that sends a document off the device must get the user's agreement first. This
// module owns the promise-based gate + the family-scoped "don't ask again"
// (skipDocumentConsentPrompt) so no caller re-declares the resolver lifecycle. The gate runs
// BEFORE the document leaves; a decline is a deliberate no-op for the caller.
//
// SINGLETON (#64). State is module-level and `DocumentExtractConsentModal` is mounted ONCE in
// `App.vue`, exactly like `useConfirm`/`ConfirmModal`. Consent used to be instantiated per
// page, which meant a new entry point had to remember to mount its own modal — and a share
// arriving at the app shell has no page to mount one. One resolver, one modal, any caller.
//
// THE GRANT IS A TOKEN, NOT A CONVENTION (#64). `requestConsent()` returns an opaque
// `ConsentGrant` that `ExtractOptions` requires, so reaching the AI pipeline without having
// awaited this gate is a COMPILE ERROR rather than a comment somebody has to notice. This
// project has already shipped one entry point that skipped the gate because the gate lived at
// the old entry point; the type closes that class of defect rather than one instance of it.

import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { reportError } from '@/utils/errorReporter';

declare const consentBrand: unique symbol;

/**
 * Opaque proof that the ADR-030 per-document consent gate ran for this action.
 *
 * Minted ONLY by `requestConsent()` — the brand has no public constructor, so application
 * code cannot forge one. Carried by `ExtractOptions`; the extraction service never inspects
 * it, it only demands it. Tests mint one via `__testConsentGrant` in the test utils.
 */
export type ConsentGrant = { readonly [consentBrand]: 'document-consent' };

const GRANT = {} as ConsentGrant;

/** Whether the consent modal is showing. Read by the single global modal mount. */
export const consentOpen = ref(false);

/**
 * The resolver for the CURRENT prompt, and a tail that SERIALIZES overlapping requests.
 *
 * These are DIFFERENT documents, so they must not share an answer. An earlier version
 * returned the same in-flight promise to every caller, which meant the answer given for the
 * in-app photo you chose also granted consent for a document a third-party app pushed in
 * behind it — no second prompt, and the branded grant could not detect it because a real
 * grant had genuinely been minted. ADR-030 is per-DOCUMENT consent; one prompt answers for
 * exactly one document.
 *
 * So a second request WAITS for the first to settle and then opens its own prompt. Resolvers
 * are never stacked and never dropped, and the tail always settles — a rejected link in the
 * chain would strand every later caller, so the chain is built from a promise that cannot
 * reject, and every wait is bounded (see WAIT_TIMEOUT_MS).
 */
let consentResolver: ((grant: ConsentGrant | null) => void) | null = null;
let tail: Promise<unknown> = Promise.resolve();

/**
 * How long a queued request will wait behind another before giving up.
 *
 * A backstop, not a feature. The tail only advances when `resolveConsent` fires, and every
 * path to that is the globally-mounted modal — but if one prompt ever failed to settle
 * (suppressed render, a route change that unmounts the host), every later `requestConsent()`
 * would await forever with no error, no toast and no telemetry, and the AI readers would
 * simply stop working with no clue why. Timing out declines, which is the safe direction:
 * the caller sends nothing.
 */
const WAIT_TIMEOUT_MS = 60_000;

/**
 * Await consent before any document leaves the device. Resolves to a `ConsentGrant` when the
 * user agrees, or `null` when they decline.
 *
 * If the family opted into "don't ask again" this resolves immediately WITHOUT touching the
 * modal lifecycle (no resolver assignment → none can be left dangling).
 *
 * `useSettingsStore()` is called HERE rather than at module scope on purpose: Pinia is not
 * active at import time, so a module-scope call would throw at app boot for every importer.
 */
export function requestConsent(): Promise<ConsentGrant | null> {
  if (useSettingsStore().skipDocumentConsentPrompt) return Promise.resolve(GRANT);

  const ahead = Promise.race([
    tail,
    new Promise((resolve) => setTimeout(resolve, WAIT_TIMEOUT_MS)),
  ]);
  const mine = ahead.then(
    () =>
      new Promise<ConsentGrant | null>((resolve) => {
        consentResolver = resolve;
        consentOpen.value = true;
      })
  );
  // The tail must never carry a rejection, or one failure would strand every later request.
  tail = mine.catch(() => undefined);
  return mine;
}

/** Settle the current prompt. Safe to call when nothing is pending. */
export function resolveConsent(granted: boolean): void {
  consentOpen.value = false;
  const resolver = consentResolver;
  consentResolver = null;
  resolver?.(granted ? GRANT : null);
}

/**
 * Confirm handler for the consent modal. Proceeds for this document regardless; if the user
 * ticked "remember", persist the family-scoped skip — but a persist failure must never strand
 * the caller, so consent resolves in `finally`.
 */
export async function onConsentConfirm(remember: boolean): Promise<void> {
  try {
    if (remember) await useSettingsStore().setSkipDocumentConsentPrompt(true);
  } catch (e) {
    reportError({
      surface: 'ai-consent',
      message: 'Failed to save the AI consent preference',
      error: e,
    });
  } finally {
    resolveConsent(true);
  }
}

/**
 * Consent gate accessors. Callers normally want `requestConsent` alone; the modal renderer
 * additionally reads `consentOpen` and calls `onConsentConfirm` / `resolveConsent`.
 */
export function useDocumentConsent() {
  return { consentOpen, requestConsent, resolveConsent, onConsentConfirm };
}
