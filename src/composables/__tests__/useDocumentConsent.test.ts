/**
 * The consent gate's own contract (#64). These cover the three things the singleton form
 * changed, each of which is a real failure mode rather than a coverage exercise:
 *
 *  - concurrency: overlapping requests are SERIALIZED, never merged — they are different
 *    documents, and ADR-030 consent is per-document;
 *  - boot safety: `useSettingsStore()` must be called lazily, or every importer throws
 *    before Pinia is active;
 *  - the persist failure must still resolve, so a storage error cannot strand a caller.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const setSkip = vi.fn();
const acknowledge = vi.fn();
const acknowledgeIngredients = vi.fn();
let skipPrompt = false;
let statementAckAt: string | null = null;
let ingredientsAckAt: string | null = null;
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get skipDocumentConsentPrompt() {
      return skipPrompt;
    },
    get aiStatementConsentAcknowledgedAt() {
      return statementAckAt;
    },
    get aiIngredientsConsentAcknowledgedAt() {
      return ingredientsAckAt;
    },
    setSkipDocumentConsentPrompt: setSkip,
    acknowledgeStatementConsent: acknowledge,
    acknowledgeIngredientsConsent: acknowledgeIngredients,
  }),
}));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

// This import happens BEFORE any `setActivePinia` below. That is the boot-safety assertion:
// if the module called `useSettingsStore()` at module scope rather than lazily inside its
// functions, this import alone would throw and every test in the file would fail to load.
import {
  deferConsentForStatement,
  isDeferredStatementConsent,
  requestConsent,
  resolveConsent,
  onConsentConfirm,
  useDocumentConsent,
} from '@/composables/useDocumentConsent';

/**
 * Serialization makes opening ASYNCHRONOUS: `requestConsent()` waits for any prompt ahead of
 * it before opening its own, so a caller that resolves synchronously would settle nothing.
 * In the app the modal is always resolved by a user interaction, which is necessarily after
 * render — this helper just gives the tests the same ordering.
 */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useDocumentConsent (singleton, #64)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    skipPrompt = false;
    statementAckAt = null;
    ingredientsAckAt = null;
    setSkip.mockReset().mockResolvedValue(undefined);
    acknowledge.mockReset().mockResolvedValue(undefined);
    acknowledgeIngredients.mockReset().mockResolvedValue(undefined);
    reportError.mockReset();
    // Settle anything a previous test left open, then let the serialization tail drain.
    resolveConsent(false);
    await flush();
    resolveConsent(false);
  });

  it('asks SEPARATELY for a second document rather than reusing the first answer', async () => {
    const { consentOpen: open } = useDocumentConsent();

    // The dangerous case this pins: the user opens the in-app photo reader, and while that
    // prompt is up a third-party app pushes a share in behind it. Merging them meant the
    // answer given for the user's OWN photo also sent the stranger's document, with no
    // second prompt — and the branded grant could not detect it, because a real grant had
    // genuinely been minted.
    const first = requestConsent();
    const second = requestConsent();

    await flush();
    expect(open.value).toBe(true);

    resolveConsent(true);
    expect(await first).not.toBeNull();

    // The second request gets its OWN prompt.
    await flush();
    expect(open.value).toBe(true);

    resolveConsent(false);
    expect(await second).toBeNull();
  });

  it('a decline on the first document does not decline the second', async () => {
    const first = requestConsent();
    const second = requestConsent();

    await flush();
    resolveConsent(false);
    expect(await first).toBeNull();

    await flush();
    resolveConsent(true);
    expect(await second).not.toBeNull();
  });

  it('starts a fresh prompt after the previous one settled', async () => {
    const { consentOpen: open } = useDocumentConsent();

    const first = requestConsent();
    await flush();
    resolveConsent(false);
    expect(await first).toBeNull();

    const second = requestConsent();
    await flush();
    expect(open.value).toBe(true);
    resolveConsent(true);
    expect(await second).not.toBeNull();
  });

  it('short-circuits without touching the modal when the family opted out of the prompt', async () => {
    const { consentOpen: open } = useDocumentConsent();
    skipPrompt = true;

    const grant = await requestConsent();

    expect(grant).not.toBeNull();
    // No resolver was assigned, so none can be left dangling.
    expect(open.value).toBe(false);
  });

  it('declining resolves null, so the caller can distinguish it from a grant', async () => {
    const pending = requestConsent();
    await flush();
    resolveConsent(false);
    expect(await pending).toBeNull();
  });

  it('still resolves when persisting the remembered choice fails', async () => {
    setSkip.mockRejectedValue(new Error('quota'));
    const pending = requestConsent();
    await flush();

    await onConsentConfirm(true);

    // The caller is not stranded, and the failure was reported rather than swallowed.
    expect(await pending).not.toBeNull();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ surface: 'ai-consent' }));
  });

  it('resolveConsent is safe when nothing is pending', () => {
    expect(() => resolveConsent(true)).not.toThrow();
  });

  it('exposes consentOpen through the accessor for the single global mount', () => {
    expect(useDocumentConsent().consentOpen.value).toBe(false);
  });

  // ── The bank-statement variant (#107) ────────────────────────────────────────────────
  describe('statement consent', () => {
    it('shows the statement variant with its read count', async () => {
      const { consentOpen: open, consentRequest } = useDocumentConsent();
      const pending = requestConsent({ kind: 'transactions', reads: 5 });
      await flush();
      expect(open.value).toBe(true);
      expect(consentRequest.value).toEqual({ kind: 'transactions', reads: 5 });
      resolveConsent(true);
      expect(await pending).not.toBeNull();
    });

    it('a generic prompt carries no variant', async () => {
      const { consentRequest } = useDocumentConsent();
      const pending = requestConsent();
      await flush();
      expect(consentRequest.value).toBeNull();
      resolveConsent(false);
      await pending;
    });

    it('"don\'t ask again" does NOT skip a statement the family has never acknowledged', async () => {
      // The merchant list is a new disclosure: a family that skips the generic prompt still
      // sees the statement one once.
      skipPrompt = true;
      const { consentOpen: open } = useDocumentConsent();
      const pending = requestConsent({ kind: 'transactions', reads: 1 });
      await flush();
      expect(open.value).toBe(true);
      resolveConsent(true);
      expect(await pending).not.toBeNull();
    });

    it('skips a statement once the family has acknowledged it and chose "don\'t ask again"', async () => {
      skipPrompt = true;
      statementAckAt = '2026-09-25T00:00:00.000Z';
      const { consentOpen: open } = useDocumentConsent();
      const grant = await requestConsent({ kind: 'transactions', reads: 3 });
      expect(grant).not.toBeNull();
      expect(open.value).toBe(false);
    });

    it('still asks for a statement when acknowledged but the family asks every time', async () => {
      statementAckAt = '2026-09-25T00:00:00.000Z';
      const { consentOpen: open } = useDocumentConsent();
      const pending = requestConsent({ kind: 'transactions', reads: 2 });
      await flush();
      expect(open.value).toBe(true);
      resolveConsent(false);
      expect(await pending).toBeNull();
    });

    it('confirming the statement variant records the acknowledgement once', async () => {
      const pending = requestConsent({ kind: 'transactions', reads: 2 });
      await flush();
      await onConsentConfirm(false);
      expect(await pending).not.toBeNull();
      expect(acknowledge).toHaveBeenCalledTimes(1);
      expect(setSkip).not.toHaveBeenCalled();
    });

    it('does not re-record an acknowledgement that already exists', async () => {
      statementAckAt = '2026-09-25T00:00:00.000Z';
      const pending = requestConsent({ kind: 'transactions', reads: 2 });
      await flush();
      await onConsentConfirm(false);
      await pending;
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('a failed acknowledgement still resolves the caller with a grant', async () => {
      acknowledge.mockRejectedValueOnce(new Error('disk full'));
      const pending = requestConsent({ kind: 'transactions', reads: 1 });
      await flush();
      await onConsentConfirm(false);
      expect(await pending).not.toBeNull();
      expect(reportError).toHaveBeenCalledTimes(1);
    });

    it('the deferred marker is distinguishable from a real grant', async () => {
      skipPrompt = true;
      statementAckAt = '2026-09-25T00:00:00.000Z';
      const grant = await requestConsent();
      expect(isDeferredStatementConsent(deferConsentForStatement())).toBe(true);
      expect(isDeferredStatementConsent(grant!)).toBe(false);
    });
  });

  // ── The shopping-list ingredients variant (#116): NOT a document read, so it has its own
  // "don't ask again" and never reads or writes the family-wide document skip ──
  describe('ingredients consent', () => {
    it('shows the ingredients variant', async () => {
      const { consentOpen: open, consentRequest } = useDocumentConsent();
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      expect(open.value).toBe(true);
      expect(consentRequest.value).toEqual({ kind: 'ingredients' });
      resolveConsent(true);
      expect(await pending).not.toBeNull();
    });

    it('"don\'t ask again" does NOT skip it before the family has acknowledged it', async () => {
      // Sending recipe ingredient lines is family data the generic prompt promises never to
      // send, so a family that skips the generic prompt still sees this one once.
      skipPrompt = true;
      const { consentOpen: open } = useDocumentConsent();
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      expect(open.value).toBe(true);
      resolveConsent(false);
      expect(await pending).toBeNull();
    });

    it('skips it once its own "don\'t ask again" is recorded', async () => {
      ingredientsAckAt = '2026-09-30T00:00:00.000Z';
      const { consentOpen: open } = useDocumentConsent();
      const grant = await requestConsent({ kind: 'ingredients' });
      expect(grant).not.toBeNull();
      expect(open.value).toBe(false);
    });

    it('an acknowledged STATEMENT does not skip the ingredients prompt, nor the reverse', async () => {
      skipPrompt = true;
      statementAckAt = '2026-09-25T00:00:00.000Z';
      const { consentOpen: open } = useDocumentConsent();
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      expect(open.value).toBe(true);
      resolveConsent(false);
      await pending;

      statementAckAt = null;
      ingredientsAckAt = '2026-09-30T00:00:00.000Z';
      const statement = requestConsent({ kind: 'transactions', reads: 1 });
      await flush();
      expect(open.value).toBe(true);
      resolveConsent(false);
      await statement;
    });

    it('ticking "don\'t ask again" records ONLY its own skip, never the family-wide one', async () => {
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      await onConsentConfirm(true);
      expect(await pending).not.toBeNull();
      expect(acknowledgeIngredients).toHaveBeenCalledTimes(1);
      expect(acknowledge).not.toHaveBeenCalled();
      // The family never saw the photo/document prompt described, so it must not be skipped.
      expect(setSkip).not.toHaveBeenCalled();
    });

    it('confirming without ticking records nothing, so it asks again next time', async () => {
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      await onConsentConfirm(false);
      expect(await pending).not.toBeNull();
      expect(acknowledgeIngredients).not.toHaveBeenCalled();
      expect(setSkip).not.toHaveBeenCalled();
    });

    it('the generic prompt still shows after the ingredients "don\'t ask again"', async () => {
      // The state onConsentConfirm(true) leaves behind: only the ingredients stamp.
      ingredientsAckAt = '2026-09-30T00:00:00.000Z';
      const { consentOpen: open } = useDocumentConsent();
      expect(await requestConsent({ kind: 'ingredients' })).not.toBeNull();
      expect(open.value).toBe(false);
      const generic = requestConsent();
      await flush();
      expect(open.value).toBe(true);
      resolveConsent(false);
      expect(await generic).toBeNull();
    });

    it('does not re-record a skip that already exists', async () => {
      // Reachable only via a prompt queued before the stamp landed (a skip resolves early).
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      ingredientsAckAt = '2026-09-30T00:00:00.000Z';
      await onConsentConfirm(true);
      await pending;
      expect(acknowledgeIngredients).not.toHaveBeenCalled();
    });

    it('a generic confirm records no acknowledgement at all', async () => {
      const pending = requestConsent();
      await flush();
      await onConsentConfirm(false);
      await pending;
      expect(acknowledgeIngredients).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('a failed acknowledgement still resolves the caller with a grant', async () => {
      acknowledgeIngredients.mockRejectedValueOnce(new Error('disk full'));
      const pending = requestConsent({ kind: 'ingredients' });
      await flush();
      await onConsentConfirm(true);
      expect(await pending).not.toBeNull();
      expect(reportError).toHaveBeenCalledTimes(1);
    });
  });
});
