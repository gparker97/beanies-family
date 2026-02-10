import type { LanguageCode } from '@/types/models';

/**
 * Structure of a translation file
 */
export interface TranslationFile {
  meta: {
    language: LanguageCode;
    languageName: string;
    lastUpdated: string;
    translationCount: number;
  };
  translations: Record<string, TranslationEntry>;
}

/**
 * Individual translation entry
 */
export interface TranslationEntry {
  translation: string;
  hash: string;
  lastUpdated: string;
}

/**
 * Load translation file for a language.
 * Returns null if file doesn't exist or fails to load.
 */
export async function loadTranslationFile(language: LanguageCode): Promise<TranslationFile | null> {
  try {
    const response = await fetch(`/src/services/translation/translations/${language}.json`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as TranslationFile;
    return data;
  } catch (error) {
    console.warn(`Failed to load translation file for ${language}:`, error);
    return null;
  }
}

/**
 * Get a translation from a translation file.
 * Returns null if translation doesn't exist or hash doesn't match.
 */
export function getTranslation(
  file: TranslationFile,
  key: string,
  expectedHash: string
): string | null {
  const entry = file.translations[key];
  if (!entry) {
    return null;
  }

  // Check if hash matches (translation is up-to-date)
  if (entry.hash !== expectedHash) {
    return null;
  }

  return entry.translation;
}

/**
 * Check if a translation is outdated (hash mismatch).
 */
export function isTranslationOutdated(
  file: TranslationFile,
  key: string,
  currentHash: string
): boolean {
  const entry = file.translations[key];
  if (!entry) {
    return true; // Missing translation is considered outdated
  }
  return entry.hash !== currentHash;
}

/**
 * Get all outdated or missing translation keys.
 */
export function getOutdatedKeys(
  file: TranslationFile | null,
  allKeys: string[],
  hashMap: Record<string, string>
): string[] {
  if (!file) {
    return allKeys; // All keys are missing
  }

  return allKeys.filter(key => {
    const currentHash = hashMap[key];
    if (!currentHash) {
      return false;
    }
    return isTranslationOutdated(file, key, currentHash);
  });
}

/**
 * Create a new translation entry.
 */
export function createTranslationEntry(
  translation: string,
  hash: string
): TranslationEntry {
  return {
    translation,
    hash,
    lastUpdated: new Date().toISOString().split('T')[0] || '',
  };
}

/**
 * Update a translation file with new translations.
 * Returns a new TranslationFile object (immutable).
 */
export function updateTranslationFile(
  file: TranslationFile,
  updates: Array<{ key: string; translation: string; hash: string }>
): TranslationFile {
  const newTranslations = { ...file.translations };

  for (const { key, translation, hash } of updates) {
    newTranslations[key] = createTranslationEntry(translation, hash);
  }

  return {
    meta: {
      ...file.meta,
      lastUpdated: new Date().toISOString().split('T')[0] || '',
      translationCount: Object.keys(newTranslations).length,
    },
    translations: newTranslations,
  };
}

/**
 * Create a new empty translation file for a language.
 */
export function createEmptyTranslationFile(
  language: LanguageCode,
  languageName: string
): TranslationFile {
  return {
    meta: {
      language,
      languageName,
      lastUpdated: new Date().toISOString().split('T')[0] || '',
      translationCount: 0,
    },
    translations: {},
  };
}

/**
 * Serialize translation file to JSON string.
 * Pretty-printed for easy editing.
 */
export function serializeTranslationFile(file: TranslationFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Download translation file as JSON.
 * This allows developers to save updated translations to the file system.
 */
export function downloadTranslationFile(file: TranslationFile, filename: string): void {
  const json = serializeTranslationFile(file);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
