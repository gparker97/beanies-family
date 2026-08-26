/**
 * The consent gate's own contract (#64). These cover the three things the singleton form
 * changed, each of which is a real failure mode rather than a coverage exercise:
 *
 *  - concurrency: two callers must share ONE modal and ONE promise, never stack resolvers;
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

describe('useDocumentConsent (singleton, #64)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    skipPrompt = false;
    setSkip.mockReset().mockResolvedValue(undefined);
    reportError.mockReset();
    resolveConsent(false);
  });

  it('opens the modal once for two concurrent requests and resolves both together', async () => {
    const { consentOpen: open } = useDocumentConsent();

    const a = requestConsent();
    const b = requestConsent();

    // ONE modal. If resolvers were stacked, the second request would have replaced the
    // first's and the first caller would hang forever.
    expect(open.value).toBe(true);

    resolveConsent(true);

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    expect(ra).toBe(rb);
    expect(open.value).toBe(false);
  });

  it('starts a fresh prompt after the previous one settled', async () => {
    const { consentOpen: open } = useDocumentConsent();

    const first = requestConsent();
    resolveConsent(false);
    expect(await first).toBeNull();

    const second = requestConsent();
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
    resolveConsent(false);
    expect(await pending).toBeNull();
  });

  it('still resolves when persisting the remembered choice fails', async () => {
    setSkip.mockRejectedValue(new Error('quota'));
    const pending = requestConsent();

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
