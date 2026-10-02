/**
 * Tests for the one-phase language load and the language-switcher freeze
 * contract it keeps. Under test:
 *
 * 1. The switch applies once the language's lazy chunk (`zh.ts`) resolves;
 *    `t()` then resolves zh, falling back to English.
 * 2. `isLoading` stays a property of the active load — stale loads don't flip it.
 * 3. A mid-load language switch supersedes via `activeLoadToken`: the stale
 *    load never writes.
 * 4. A rotated chunk (chunk-load symptom) is reported as `chunk_load` with a
 *    toast + English fallback, and NEVER hard-reloads (a language switch is a
 *    user action mid-session; a reload would lose unsaved work).
 * 5. Catastrophic failures surface a toast + reportError and stay in English;
 *    stale catastrophic failures stay silent (intentional).
 *
 * See docs/plans/2026-04-30-language-switcher-freeze.md and
 * docs/plans/2026-10-02-claude-authored-zh-strings.md.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Controls the mocked `zh` chunk. `failWith` set → reading ZH_STRINGS throws,
// which is how the store's destructuring loader experiences a chunk that
// failed to load (the loader's promise rejects with that error).
const zhChunk = vi.hoisted(() => ({
  failWith: null as Error | null,
  strings: {
    'app.name': 'beanies.family',
    'app.tagline': '每一颗豆子都很重要',
    'error.translationLoadFailed': '无法加载翻译',
    'error.translationLoadFailedHelp': '请检查网络连接后重试。',
  } as Record<string, string>,
}));

vi.mock('@/services/translation/zh', () => ({
  get ZH_STRINGS() {
    if (zhChunk.failWith) throw zhChunk.failWith;
    return zhChunk.strings;
  },
}));

vi.mock('@/services/translation/uiStrings', () => ({
  UI_STRINGS: {
    'app.name': 'beanies.family',
    'app.tagline': 'Every bean counts',
    'app.taglineAccent': 'bean',
    'error.translationLoadFailed': "We couldn't load translations",
    'error.translationLoadFailedHelp': 'Check your connection and try again.',
  },
  BEANIE_STRINGS: {} as Record<string, string>,
}));

// Real `isChunkLoadError` (the store classifies with it); every reload entry
// point is replaced so a test can assert the store never reaches one.
vi.mock('@/utils/hardReload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/hardReload')>()),
  hardReload: vi.fn(),
  tryRecoverChunkLoad: vi.fn(() => false),
  startChunkRecovery: vi.fn(() => false),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { hardReload, startChunkRecovery, tryRecoverChunkLoad } from '@/utils/hardReload';
import { useTranslationStore } from '@/stores/translationStore';

const CHUNK_ERROR = () =>
  new TypeError('Failed to fetch dynamically imported module: https://app.beanies.family/zh-1.js');

describe('translationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    zhChunk.failWith = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('switching to Chinese', () => {
    it('applies the language and its strings once the chunk resolves', async () => {
      const store = useTranslationStore();
      const load = store.loadTranslations('zh');
      // Non-blocking: nothing is applied synchronously; the spinner is up.
      expect(store.currentLanguage).toBe('en');
      expect(store.isLoading).toBe(true);

      await load;

      expect(store.currentLanguage).toBe('zh');
      expect(store.isLoading).toBe(false);
      expect(store.t('app.tagline' as never)).toBe('每一颗豆子都很重要');
      expect(reportError).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('falls back to English for a key the table does not carry', async () => {
      const store = useTranslationStore();
      await store.loadTranslations('zh');
      expect(store.t('app.taglineAccent' as never)).toBe('bean');
    });

    it('switching back to English drops the table', async () => {
      const store = useTranslationStore();
      await store.loadTranslations('zh');
      await store.loadTranslations('en');
      expect(store.currentLanguage).toBe('en');
      expect(store.t('app.tagline' as never)).toBe('Every bean counts');
    });
  });

  describe('cancellation', () => {
    it('a superseded load does not write currentLanguage, the table or isLoading', async () => {
      const store = useTranslationStore();
      const zhLoad = store.loadTranslations('zh');
      // Supersede before the chunk resolves (zh → en, the rapid-toggle case).
      await store.loadTranslations('en');
      expect(store.isLoading).toBe(false);

      await zhLoad;

      expect(store.currentLanguage).toBe('en');
      expect(store.isLoading).toBe(false);
      expect(store.t('app.tagline' as never)).toBe('Every bean counts');
    });

    it('rapid zh → en → zh ends in Chinese', async () => {
      const store = useTranslationStore();
      const first = store.loadTranslations('zh');
      void store.loadTranslations('en');
      const last = store.loadTranslations('zh');
      await Promise.all([first, last]);
      expect(store.currentLanguage).toBe('zh');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('rotated chunk', () => {
    it('reports error_code chunk_load, toasts, stays in English and never reloads', async () => {
      zhChunk.failWith = CHUNK_ERROR();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const store = useTranslationStore();
      await store.loadTranslations('zh');

      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'translation-load',
          context: { error_code: 'chunk_load' },
        })
      );
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(store.currentLanguage).toBe('en');
      expect(store.isLoading).toBe(false);
      expect(tryRecoverChunkLoad).not.toHaveBeenCalled();
      expect(startChunkRecovery).not.toHaveBeenCalled();
      expect(hardReload).not.toHaveBeenCalled();
    });
  });

  describe('catastrophic failure', () => {
    it('surfaces a toast + reportError and stays in English when the load rejects', async () => {
      zhChunk.failWith = new Error('Network down');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const store = useTranslationStore();
      await store.loadTranslations('zh');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[translationStore] loadTranslations failed:',
        expect.any(Error)
      );
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'translation-load',
          severity: 'error',
          message: expect.stringContaining('zh'),
          error: expect.any(Error),
          // `language` is not an allowlisted context key; it travels in the message.
          context: { error_code: 'Error' },
        })
      );
      expect(showToast).toHaveBeenCalledWith(
        'error',
        expect.stringContaining("couldn't load translations"),
        expect.stringContaining('Check your connection')
      );
      expect(store.currentLanguage).toBe('en');
      expect(store.isLoading).toBe(false);
    });

    it('stale catastrophic failures do NOT toast or report (intentional silence)', async () => {
      zhChunk.failWith = new Error('Stale failure');

      const store = useTranslationStore();
      const zhLoad = store.loadTranslations('zh');
      await store.loadTranslations('en'); // supersede before the load settles
      await zhLoad;

      expect(showToast).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
      expect(tryRecoverChunkLoad).not.toHaveBeenCalled();
      expect(store.currentLanguage).toBe('en');
    });
  });
});
