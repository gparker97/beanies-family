/**
 * Tests for the language-switcher freeze fix. The contract under test:
 *
 * 1. Cosmetic switch is instant (after Phase 1 bundled-JSON load).
 * 2. `isLoading` stays a property of the active load — stale loads don't flip it.
 * 3. Mid-load language switches supersede via `activeLoadToken`.
 * 4. Cancellation latency is bounded (~200ms — one API loop iteration).
 * 5. Catastrophic failures surface a toast + reportError; stale catastrophic
 *    failures stay silent (intentional).
 * 6. Per-key API failures don't escalate to error.value.
 *
 * See docs/plans/2026-04-30-language-switcher-freeze.md.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the underlying services BEFORE importing the store. Mocks are
// hoisted by vi so the store's imports resolve to the mocked modules.
vi.mock('@/services/translation/translationFiles', () => ({
  loadTranslationFile: vi.fn(),
  getTranslation: vi.fn(
    (
      file: { translations: Record<string, { translation: string; hash: string }> },
      key: string,
      hash: string
    ) => {
      const entry = file.translations[key];
      return entry && entry.hash === hash ? entry.translation : null;
    }
  ),
}));

vi.mock('@/services/translation/translationApi', () => ({
  translate: vi.fn(),
  translateBatch: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/translationCacheRepository', () => ({
  getTranslationsForLanguageByKeys: vi.fn(async () => []),
  saveTranslationsWithHash: vi.fn(async () => {}),
  clearAll: vi.fn(async () => {}),
}));

vi.mock('@/services/translation/uiStrings', () => {
  // Tiny synthetic key set keeps the store's `getAllKeys`/`getAllHashes`
  // surface deterministic. Only need a few entries for the tests.
  const UI_STRINGS = {
    'app.name': 'beanies.family',
    'app.tagline': 'Every bean counts',
    'error.translationLoadFailed': "We couldn't load translations",
    'error.translationLoadFailedHelp': 'Check your connection and try again.',
  } as const;
  const HASHES = {
    'app.name': 'h-name',
    'app.tagline': 'h-tagline',
    'error.translationLoadFailed': 'h-fail',
    'error.translationLoadFailedHelp': 'h-fail-help',
  } as const;
  return {
    UI_STRINGS,
    BEANIE_STRINGS: {} as Record<string, string>,
    getAllKeys: () => Object.keys(UI_STRINGS),
    getAllHashes: () => HASHES,
    getSourceText: (key: keyof typeof UI_STRINGS) => UI_STRINGS[key],
  };
});

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

import * as translationFiles from '@/services/translation/translationFiles';
import * as translationApi from '@/services/translation/translationApi';
import * as translationCache from '@/services/indexeddb/repositories/translationCacheRepository';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';

/**
 * Build a synthetic bundled translation file. `coverage` controls which
 * keys are present (i.e. how many would be "missing" → triggering the API
 * loop in the store).
 */
function makeBundledFile(coverage: 'all' | 'partial' | 'none' = 'all') {
  const HASHES: Record<string, string> = {
    'app.name': 'h-name',
    'app.tagline': 'h-tagline',
    'error.translationLoadFailed': 'h-fail',
    'error.translationLoadFailedHelp': 'h-fail-help',
  };
  const keysToInclude =
    coverage === 'all'
      ? Object.keys(HASHES)
      : coverage === 'partial'
        ? ['app.name'] // others are missing → API loop runs for them
        : [];
  const translations: Record<string, { translation: string; hash: string; lastUpdated: string }> =
    {};
  for (const k of keysToInclude) {
    translations[k] = { translation: `[zh] ${k}`, hash: HASHES[k]!, lastUpdated: '2026-04-30' };
  }
  return {
    meta: {
      language: 'zh' as const,
      languageName: '中文',
      lastUpdated: '2026-04-30',
      translationCount: keysToInclude.length,
    },
    translations,
  };
}

describe('translationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // resetAllMocks (not just clearAllMocks) — clears call history AND
    // resets implementations, so mockImplementationOnce queues from a prior
    // test don't leak into the next.
    vi.resetAllMocks();
    // Re-establish stable defaults for mocks that need them
    vi.mocked(translationCache.getTranslationsForLanguageByKeys).mockResolvedValue([]);
    vi.mocked(translationCache.saveTranslationsWithHash).mockResolvedValue(undefined);
    vi.mocked(translationCache.clearAll).mockResolvedValue(undefined);
    vi.mocked(translationFiles.getTranslation).mockImplementation(
      (
        file: { translations: Record<string, { translation: string; hash: string }> },
        key: string,
        hash: string
      ) => {
        const entry = file?.translations?.[key];
        return entry && entry.hash === hash ? entry.translation : null;
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('cosmetic switch is instant', () => {
    it('applies currentLanguage and bundled translations after Phase 1, before any API loop', async () => {
      const file = makeBundledFile('all');
      vi.mocked(translationFiles.loadTranslationFile).mockResolvedValue(file);

      const store = useTranslationStore();
      await store.loadTranslations('zh');

      expect(store.currentLanguage).toBe('zh');
      expect(store.t('app.name' as never)).toBe('[zh] app.name');
      // No API loop ran (full coverage in bundled file)
      expect(translationApi.translate).not.toHaveBeenCalled();
    });
  });

  describe('isLoading toggling', () => {
    it('starts false, true during, false after a successful all-bundled load', async () => {
      vi.mocked(translationFiles.loadTranslationFile).mockResolvedValue(makeBundledFile('all'));

      const store = useTranslationStore();
      expect(store.isLoading).toBe(false);

      const promise = store.loadTranslations('zh');
      expect(store.isLoading).toBe(true);

      await promise;
      expect(store.isLoading).toBe(false);
    });

    it('stale-load resolution does NOT flip isLoading off — active load owns it', async () => {
      // Phase-1 fetch hangs forever for the first call so we can supersede
      // it before it resolves. Second call resolves normally.
      let resolveStaleFetch: (v: translationFiles.TranslationFile) => void = () => {};
      vi.mocked(translationFiles.loadTranslationFile)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveStaleFetch = resolve;
            })
        )
        .mockResolvedValueOnce(makeBundledFile('all'));

      const store = useTranslationStore();
      const stalePromise = store.loadTranslations('zh');
      // No await — kick off a fresh load that will become the active one.
      const activePromise = store.loadTranslations('en');

      await activePromise;
      expect(store.isLoading).toBe(false);
      expect(store.currentLanguage).toBe('en');

      // Now resolve the stale fetch. The stale load proceeds, hits its first
      // staleness check, and returns. It must NOT flip isLoading or overwrite
      // currentLanguage.
      resolveStaleFetch(makeBundledFile('all'));
      await stalePromise;

      expect(store.isLoading).toBe(false); // unchanged by stale finally
      expect(store.currentLanguage).toBe('en'); // not clobbered to 'zh'
    });
  });

  describe('stale-load bailout', () => {
    it('Phase 1/2: superseded load does not write currentLanguage or translations', async () => {
      // First (Chinese) fetch hangs. Second (English) load is direct.
      let resolveZh: (v: translationFiles.TranslationFile) => void = () => {};
      vi.mocked(translationFiles.loadTranslationFile).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveZh = resolve;
          })
      );

      const store = useTranslationStore();
      const zhPromise = store.loadTranslations('zh');
      // English short-circuits (no fetch needed) and supersedes the zh load
      await store.loadTranslations('en');

      expect(store.currentLanguage).toBe('en');

      // Now let the zh fetch resolve. The post-fetch staleness check should
      // early-return BEFORE writing to currentLanguage.
      resolveZh(makeBundledFile('all'));
      await zhPromise;

      expect(store.currentLanguage).toBe('en');
      // The translations map should be EMPTY (English path clears it)
      expect(store.translationCount).toBe(0);
    });

    it('Phase 4 (API loop): superseded load aborts within one iteration', async () => {
      // Real timers — fake timers + nested async + the store's inter-call
      // 200ms sleep deadlocks `vi.runAllTimersAsync()`. Using real timers
      // with short delays keeps the test fast (~400ms) and reliable.

      // Bundled file has only 'app.name' — 3 keys missing → up to 3 API calls.
      vi.mocked(translationFiles.loadTranslationFile).mockResolvedValue(makeBundledFile('partial'));
      // Each translate call takes 30ms — fast enough for the test, slow
      // enough that we can interleave the supersede.
      vi.mocked(translationApi.translate).mockImplementation(async (text: string) => {
        await new Promise((r) => setTimeout(r, 30));
        return `[zh] ${text}`;
      });

      const store = useTranslationStore();
      const zhPromise = store.loadTranslations('zh');

      // Let Phase 1 (bundled fetch) + the first iteration's translate() resolve.
      await new Promise((r) => setTimeout(r, 50));
      const callsBeforeSupersede = vi.mocked(translationApi.translate).mock.calls.length;

      // Supersede mid-loop (English short-circuits and supersedes immediately).
      await store.loadTranslations('en');

      // Wait long enough for the zh load to wake from its 200ms inter-call
      // sleep, hit the post-sleep staleness check, and exit cleanly.
      await new Promise((r) => setTimeout(r, 250));
      await zhPromise;

      // After supersede, at most ONE more translate() call should have been
      // made (the one already in flight when supersede happened). The
      // staleness checks at the top of each iteration prevent further calls.
      const callsAfterSupersede = vi.mocked(translationApi.translate).mock.calls.length;
      expect(callsAfterSupersede).toBeLessThanOrEqual(callsBeforeSupersede + 1);

      // Final state: English won
      expect(store.currentLanguage).toBe('en');
    });
  });

  describe('catastrophic failure', () => {
    it('surfaces a toast + reportError when the bundled JSON fetch rejects', async () => {
      vi.mocked(translationFiles.loadTranslationFile).mockRejectedValue(new Error('Network down'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const store = useTranslationStore();
      await store.loadTranslations('zh');

      expect(store.error).toBe('Network down');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[translationStore] loadTranslations failed:',
        expect.any(Error)
      );
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'translation-load',
          message: expect.stringContaining('zh'),
          error: expect.any(Error),
          context: { language: 'zh' },
        })
      );
      expect(showToast).toHaveBeenCalledWith(
        'error',
        expect.stringContaining("couldn't load translations"),
        expect.stringContaining('Check your connection')
      );
      // App falls back to English when nothing was applied
      expect(store.currentLanguage).toBe('en');
    });

    it('stale catastrophic failures do NOT toast (intentional silence)', async () => {
      // First call hangs then rejects; second call (active) succeeds.
      let rejectZh: (err: Error) => void = () => {};
      vi.mocked(translationFiles.loadTranslationFile)
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectZh = reject;
            })
        )
        .mockResolvedValueOnce(makeBundledFile('all'));

      const store = useTranslationStore();
      const zhPromise = store.loadTranslations('zh');
      await store.loadTranslations('ja' as never); // supersede with a different lang

      // Now reject the stale zh fetch
      rejectZh(new Error('Stale failure'));
      await zhPromise;

      // No user-facing surfaces fired for the superseded load
      expect(showToast).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });
  });

  describe('per-key failure', () => {
    it('is non-fatal — the loop continues and error.value stays null', async () => {
      // Real timers — same fake-timer-deadlock reason as Phase 4 test.
      vi.mocked(translationFiles.loadTranslationFile).mockResolvedValue(makeBundledFile('partial'));

      // 3 missing keys. The first translate call throws; the rest succeed.
      let callCount = 0;
      vi.mocked(translationApi.translate).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('mymemory blip');
        return `[zh] ok`;
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const store = useTranslationStore();
      await store.loadTranslations('zh');

      // The loop kept going — translate was called for each missing key
      expect(vi.mocked(translationApi.translate).mock.calls.length).toBeGreaterThanOrEqual(2);
      // Per-key failure logged with the right prefix
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[translationStore] missed key'),
        expect.any(Error)
      );
      // error.value never set — per-key failure isn't catastrophic
      expect(store.error).toBe(null);
      // The catastrophic surfaces were NOT fired
      expect(reportError).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    });
  });
});
