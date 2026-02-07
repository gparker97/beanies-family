import type { LanguageCode } from '@/types/models';

/**
 * MyMemory Translation API
 * - Free, CORS-enabled, no API key required
 * - 1000 words/day free, 10000 with free API key
 * - Supports all major languages
 */
const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_DELAY_MS = 200; // Delay between batch requests to be respectful

interface MyMemoryResponse {
  responseData: {
    translatedText: string;
    match: number;
  };
  responseStatus: number;
  responseDetails?: string;
}

// Map our language codes to MyMemory language codes
function getMyMemoryLangCode(code: LanguageCode): string {
  const langMap: Record<LanguageCode, string> = {
    'en': 'en',
    'zh': 'zh-CN', // Simplified Chinese
  };
  return langMap[code] || code;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Translate a single text string from source to target language.
 */
export async function translate(
  text: string,
  source: LanguageCode,
  target: LanguageCode
): Promise<string> {
  if (source === target || !text.trim()) {
    return text;
  }

  const sourceLang = getMyMemoryLangCode(source);
  const targetLang = getMyMemoryLangCode(target);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const params = new URLSearchParams({
        q: text,
        langpair: `${sourceLang}|${targetLang}`,
        de: 'gpsp2001@gmail.com', // Increases daily limit from 5000 to 50000 chars
      });

      const response = await fetch(`${MYMEMORY_API_URL}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data: MyMemoryResponse = await response.json();

      if (data.responseStatus !== 200) {
        throw new Error(data.responseDetails || 'Translation failed');
      }

      // MyMemory sometimes returns HTML entities, decode them
      const translated = decodeHtmlEntities(data.responseData.translatedText);
      return translated;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        console.error('Translation failed after all retries:', error);
        return text; // Fallback to original text
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return text; // Fallback
}

/**
 * Decode HTML entities that MyMemory sometimes returns
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Translate multiple texts in batch.
 * Translates one at a time with small delays to be respectful to free API.
 */
export async function translateBatch(
  texts: string[],
  source: LanguageCode,
  target: LanguageCode,
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const results: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    try {
      const translated = await translate(text!, source, target);
      results.push(translated);
    } catch {
      results.push(text!); // Fallback to original
    }

    onProgress?.(i + 1, texts.length);

    // Small delay between requests to be respectful
    if (i < texts.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return results;
}
