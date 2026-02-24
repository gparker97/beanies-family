#!/usr/bin/env node
/**
 * Translation Update Script
 *
 * Automatically updates translation JSON files by:
 * 1. Reading English source strings from uiStrings.ts (STRING_DEFS)
 * 2. Comparing with existing translations
 * 3. Fetching missing/outdated translations from API
 * 4. Removing stale keys no longer in STRING_DEFS
 * 5. Updating the translation JSON files
 *
 * Usage:
 *   node scripts/updateTranslations.mjs --all     # Translate all languages (default)
 *   node scripts/updateTranslations.mjs zh         # Translate a single language
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MyMemory Translation API
const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';
const REQUEST_DELAY_MS = 250; // Delay between requests

// Language configuration — single source of truth for all supported languages.
// To add a new language: add an entry here + create `npm run translate:<code>` in package.json.
const LANGUAGES = {
  zh: {
    code: 'zh',
    name: '中文 (简体)',
    myMemoryCode: 'zh-CN',
  },
};

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hash function (matches the one in uiStrings.ts)
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Parse STRING_DEFS from uiStrings.ts
 *
 * Extracts all { en: '...' } entries from the STRING_DEFS object.
 * Ignores optional 'beanie' fields — only the 'en' value is needed.
 *
 * Uses a line-by-line approach to handle values containing `{` and `}`
 * characters (e.g. 'Must be at least {min} characters').
 */
function parseUIStrings() {
  const filePath = path.join(__dirname, '../src/services/translation/uiStrings.ts');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Verify STRING_DEFS exists
  if (!content.includes('const STRING_DEFS')) {
    throw new Error(
      'Could not find STRING_DEFS in uiStrings.ts. Expected `const STRING_DEFS = { ... } satisfies Record<string, StringEntry>`.'
    );
  }

  const lines = content.split('\n');
  const strings = {};
  let currentKey = null;
  let inStringDefs = false;

  for (const line of lines) {
    // Detect start/end of STRING_DEFS block
    if (line.includes('const STRING_DEFS')) {
      inStringDefs = true;
      continue;
    }
    if (inStringDefs && line.match(/^\}\s*satisfies/)) {
      break;
    }
    if (!inStringDefs) continue;

    // Match a key line: 'some.key': { ... or 'some.key': {
    const keyMatch = line.match(/^\s+'([^']+)'\s*:\s*\{/);
    if (keyMatch) {
      currentKey = keyMatch[1];
    }

    // Match en value on same or subsequent line (single-quoted)
    if (currentKey) {
      const enSingle = line.match(/en\s*:\s*'((?:[^'\\]|\\.)*)'/);
      if (enSingle) {
        const text = enSingle[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        strings[currentKey] = { text, hash: hashString(text) };
        currentKey = null;
        continue;
      }
      // Double-quoted en value
      const enDouble = line.match(/en\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (enDouble) {
        const text = enDouble[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        strings[currentKey] = { text, hash: hashString(text) };
        currentKey = null;
        continue;
      }
    }
  }

  console.log(`   Parsed ${Object.keys(strings).length} strings from STRING_DEFS`);

  if (Object.keys(strings).length === 0) {
    throw new Error('Failed to parse any strings from uiStrings.ts. Check the STRING_DEFS format.');
  }

  return strings;
}

/**
 * Load existing translation file
 */
function loadTranslationFile(language) {
  const filePath = path.join(__dirname, `../public/translations/${language}.json`);

  if (!fs.existsSync(filePath)) {
    return {
      meta: {
        language,
        languageName: LANGUAGES[language].name,
        lastUpdated: new Date().toISOString().split('T')[0],
        translationCount: 0,
      },
      translations: {},
    };
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Save translation file
 */
function saveTranslationFile(language, data) {
  const filePath = path.join(__dirname, `../public/translations/${language}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Translate text using MyMemory API
 */
async function translate(text, targetLang) {
  const langCode = LANGUAGES[targetLang].myMemoryCode || targetLang;

  try {
    const params = new URLSearchParams({
      q: text,
      langpair: `en|${langCode}`,
      de: 'gpsp2001@gmail.com',
    });

    const response = await fetch(`${MYMEMORY_API_URL}?${params.toString()}`);
    const data = await response.json();

    if (data.responseStatus !== 200) {
      console.warn(`   ⚠ Translation failed for "${text}": ${data.responseDetails}`);
      return text; // Fallback to original
    }

    // Decode HTML entities
    const decoded = data.responseData.translatedText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return decoded;
  } catch (error) {
    console.error(`   ✗ Error translating "${text}":`, error.message);
    return text; // Fallback to original
  }
}

/**
 * Remove stale keys from translation file that no longer exist in STRING_DEFS.
 * Returns the number of keys removed.
 */
function removeStaleKeys(translationFile, sourceStrings) {
  const validKeys = new Set(Object.keys(sourceStrings));
  const staleKeys = Object.keys(translationFile.translations).filter((key) => !validKeys.has(key));

  for (const key of staleKeys) {
    delete translationFile.translations[key];
  }

  return staleKeys.length;
}

/**
 * Update translations for a single language.
 * Returns { translated, staleRemoved, total, upToDate } counts.
 */
async function updateTranslations(language, sourceStrings) {
  console.log(`\n🌐 ${LANGUAGES[language].name} (${language})`);
  console.log(`${'─'.repeat(40)}`);

  const totalKeys = Object.keys(sourceStrings).length;

  // Load existing translations
  const translationFile = loadTranslationFile(language);
  const existingCount = Object.keys(translationFile.translations).length;
  console.log(`   Existing: ${existingCount} translations`);

  // Remove stale keys
  const staleRemoved = removeStaleKeys(translationFile, sourceStrings);
  if (staleRemoved > 0) {
    console.log(`   Removed ${staleRemoved} stale key(s)`);
  }

  // Find missing or outdated translations
  const toTranslate = [];

  for (const [key, { text, hash }] of Object.entries(sourceStrings)) {
    const existing = translationFile.translations[key];

    if (!existing) {
      toTranslate.push({ key, text, hash, reason: 'missing' });
    } else if (existing.hash !== hash) {
      toTranslate.push({ key, text, hash, reason: 'outdated' });
    }
  }

  const missing = toTranslate.filter((t) => t.reason === 'missing').length;
  const outdated = toTranslate.filter((t) => t.reason === 'outdated').length;

  if (toTranslate.length === 0) {
    console.log(`   ✅ All ${totalKeys} translations up to date`);
    // Still save if stale keys were removed
    if (staleRemoved > 0) {
      translationFile.meta.lastUpdated = new Date().toISOString().split('T')[0];
      translationFile.meta.translationCount = Object.keys(translationFile.translations).length;
      saveTranslationFile(language, translationFile);
      console.log(`   💾 Saved (stale keys removed)`);
    }
    return { translated: 0, staleRemoved, total: totalKeys, upToDate: true };
  }

  console.log(
    `   Missing: ${missing} | Outdated: ${outdated} | To translate: ${toTranslate.length}`
  );

  // Translate missing/outdated strings
  let completed = 0;
  for (const { key, text, hash, reason } of toTranslate) {
    const translation = await translate(text, language);

    translationFile.translations[key] = {
      translation,
      hash,
      lastUpdated: new Date().toISOString().split('T')[0],
    };

    completed++;
    const percentage = Math.round((completed / toTranslate.length) * 100);
    const reasonEmoji = reason === 'missing' ? '🆕' : '🔄';
    console.log(`   [${percentage}%] ${reasonEmoji} ${key}`);
    console.log(`        "${text}" → "${translation}"`);

    // Delay to be respectful to the API
    if (completed < toTranslate.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Update metadata and save
  translationFile.meta.lastUpdated = new Date().toISOString().split('T')[0];
  translationFile.meta.translationCount = Object.keys(translationFile.translations).length;
  saveTranslationFile(language, translationFile);

  console.log(`   💾 Saved: ${translationFile.meta.translationCount}/${totalKeys} translations`);

  return { translated: toTranslate.length, staleRemoved, total: totalKeys, upToDate: false };
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Determine which languages to translate
  let languagesToTranslate;

  if (args.length === 0 || args[0] === '--all') {
    // Default: translate all languages
    languagesToTranslate = Object.keys(LANGUAGES);
  } else {
    const language = args[0];
    if (!LANGUAGES[language]) {
      console.error(`\n❌ Error: Unknown language "${language}"`);
      console.error(`   Supported languages: ${Object.keys(LANGUAGES).join(', ')}`);
      console.error(`   Use --all to translate all languages\n`);
      process.exit(1);
    }
    languagesToTranslate = [language];
  }

  console.log(`\n📖 Reading source strings from uiStrings.ts...`);
  const sourceStrings = parseUIStrings();
  const totalKeys = Object.keys(sourceStrings).length;
  console.log(`   Found ${totalKeys} source strings\n`);

  console.log(
    `🌍 Translating ${languagesToTranslate.length} language(s): ${languagesToTranslate.join(', ')}`
  );

  // Track results for summary
  const results = {};
  let hasErrors = false;

  for (const lang of languagesToTranslate) {
    try {
      results[lang] = await updateTranslations(lang, sourceStrings);
    } catch (error) {
      console.error(`\n   ❌ Error processing ${lang}: ${error.message}`);
      hasErrors = true;
      results[lang] = { error: error.message };
    }
  }

  // Print summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Translation Summary`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`   Source strings: ${totalKeys}`);

  for (const [lang, result] of Object.entries(results)) {
    if (result.error) {
      console.log(`   ${LANGUAGES[lang].name} (${lang}): ❌ Error — ${result.error}`);
    } else if (result.upToDate && result.staleRemoved === 0) {
      console.log(`   ${LANGUAGES[lang].name} (${lang}): ✅ Up to date`);
    } else {
      const parts = [];
      if (result.translated > 0) parts.push(`${result.translated} translated`);
      if (result.staleRemoved > 0) parts.push(`${result.staleRemoved} stale removed`);
      console.log(`   ${LANGUAGES[lang].name} (${lang}): ${parts.join(', ')}`);
    }
  }

  console.log(`${'═'.repeat(50)}\n`);

  if (hasErrors) {
    process.exit(1);
  }
}

// Run if called directly
main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
