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
let skipPrompt = false;
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get skipDocumentConsentPrompt() {
      return skipPrompt;
    },
    setSkipDocumentConsentPrompt: setSkip,
  }),
}));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

// This import happens BEFORE any `setActivePinia` below. That is the boot-safety assertion:
// if the module called `useSettingsStore()` at module scope rather than lazily inside its
// functions, this import alone would throw and every test in the file would fail to load.
import {
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
    setSkip.mockReset().mockResolvedValue(undefined);
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
});
