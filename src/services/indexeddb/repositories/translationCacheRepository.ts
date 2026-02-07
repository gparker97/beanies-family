import { getDatabase } from '../database';
import type { LanguageCode, TranslationCacheEntry } from '@/types/models';

/**
 * Get all cached translations for a specific language and version.
 * Only returns translations that match the current UI_STRINGS_VERSION.
 */
export async function getTranslationsForLanguage(
  language: LanguageCode,
  version: number
): Promise<TranslationCacheEntry[]> {
  const db = await getDatabase();
  const all = await db.getAllFromIndex('translations', 'by-language', language);

  // Only return entries matching current version
  return all.filter(entry => entry.version === version);
}

/**
 * Save multiple translations to the cache.
 */
export async function saveTranslations(
  translations: { key: string; translation: string }[],
  language: LanguageCode,
  version: number
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction('translations', 'readwrite');
  const store = tx.objectStore('translations');

  for (const { key, translation } of translations) {
    const entry: TranslationCacheEntry = {
      id: `${key}:${language}`,
      key,
      language,
      translation,
      version,
    };
    await store.put(entry);
  }

  await tx.done;
}

/**
 * Get a single cached translation.
 */
export async function getTranslation(
  key: string,
  language: LanguageCode,
  version: number
): Promise<string | null> {
  const db = await getDatabase();
  const entry = await db.get('translations', `${key}:${language}`);

  if (entry && entry.version === version) {
    return entry.translation;
  }

  return null;
}

/**
 * Clear all cached translations.
 */
export async function clearAll(): Promise<void> {
  const db = await getDatabase();
  await db.clear('translations');
}

/**
 * Clear cached translations for a specific language.
 */
export async function clearLanguage(language: LanguageCode): Promise<void> {
  const db = await getDatabase();
  const entries = await db.getAllFromIndex('translations', 'by-language', language);
  const tx = db.transaction('translations', 'readwrite');

  for (const entry of entries) {
    await tx.store.delete(entry.id);
  }

  await tx.done;
}

/**
 * Get the count of cached translations for a language.
 */
export async function getTranslationCount(language: LanguageCode): Promise<number> {
  const db = await getDatabase();
  const entries = await db.getAllFromIndex('translations', 'by-language', language);
  return entries.length;
}
