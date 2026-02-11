#!/usr/bin/env node
/**
 * Translation Update Script
 *
 * Automatically updates translation JSON files by:
 * 1. Reading English source strings from uiStrings.ts
 * 2. Comparing with existing translations
 * 3. Fetching missing/outdated translations from API
 * 4. Updating the translation JSON files
 *
 * Usage: node scripts/updateTranslations.mjs [language]
 * Example: node scripts/updateTranslations.mjs zh
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MyMemory Translation API
const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';
const REQUEST_DELAY_MS = 250; // Delay between requests

// Language configuration
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
 * Parse UI_STRINGS from uiStrings.ts
 */
function parseUIStrings() {
  const filePath = path.join(__dirname, '../src/services/translation/uiStrings.ts');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Extract UI_STRINGS object
  const match = content.match(/export const UI_STRINGS = \{([\s\S]*?)\} as const;/);
  if (!match) {
    throw new Error('Could not parse UI_STRINGS from uiStrings.ts');
  }

  const stringsContent = match[1];
  const strings = {};

  // Parse key-value pairs using regex
  // Matches patterns like: 'key': 'value' or "key": "value"
  const regex = /['"]([^'"]+)['"]\s*:\s*['"]([^'"\\]*(\\.[^'"\\]*)*)['"]/g;
  let regexMatch;

  while ((regexMatch = regex.exec(stringsContent)) !== null) {
    const key = regexMatch[1];
    const text = regexMatch[2];
    strings[key] = {
      text,
      hash: hashString(text),
    };
  }

  console.log(`   Parsed ${Object.keys(strings).length} strings`);

  if (Object.keys(strings).length === 0) {
    throw new Error('Failed to parse any strings from uiStrings.ts. Check the file format.');
  }

  return strings;
}

/**
 * Load existing translation file
 */
function loadTranslationFile(language) {
  const filePath = path.join(
    __dirname,
    `../src/services/translation/translations/${language}.json`
  );

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
  const filePath = path.join(
    __dirname,
    `../src/services/translation/translations/${language}.json`
  );
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
      console.warn(`Translation failed for "${text}": ${data.responseDetails}`);
      return text; // Fallback to original
    }

    // Decode HTML entities
    const textarea = { innerHTML: data.responseData.translatedText };
    const decoded = data.responseData.translatedText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return decoded;
  } catch (error) {
    console.error(`Error translating "${text}":`, error.message);
    return text; // Fallback to original
  }
}

/**
 * Main update function
 */
async function updateTranslations(language) {
  console.log(`\n🌐 Updating translations for: ${LANGUAGES[language].name} (${language})\n`);

  // Step 1: Parse source strings
  console.log('📖 Reading source strings from uiStrings.ts...');
  const sourceStrings = parseUIStrings();
  const totalKeys = Object.keys(sourceStrings).length;
  console.log(`   Found ${totalKeys} strings\n`);

  // Step 2: Load existing translations
  console.log('📂 Loading existing translation file...');
  const translationFile = loadTranslationFile(language);
  const existingCount = Object.keys(translationFile.translations).length;
  console.log(`   Found ${existingCount} existing translations\n`);

  // Step 3: Find missing or outdated translations
  console.log('🔍 Checking for missing or outdated translations...');
  const toTranslate = [];

  for (const [key, { text, hash }] of Object.entries(sourceStrings)) {
    const existing = translationFile.translations[key];

    if (!existing) {
      toTranslate.push({ key, text, hash, reason: 'missing' });
    } else if (existing.hash !== hash) {
      toTranslate.push({ key, text, hash, reason: 'outdated' });
    }
  }

  console.log(`   Missing: ${toTranslate.filter((t) => t.reason === 'missing').length}`);
  console.log(`   Outdated: ${toTranslate.filter((t) => t.reason === 'outdated').length}`);
  console.log(`   Total to translate: ${toTranslate.length}\n`);

  if (toTranslate.length === 0) {
    console.log('✅ All translations are up to date!\n');
    return;
  }

  // Step 4: Translate missing/outdated strings
  console.log(`🔄 Translating ${toTranslate.length} strings (this may take a few minutes)...\n`);

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

  // Step 5: Update metadata and save
  console.log('\n💾 Saving translation file...');
  translationFile.meta.lastUpdated = new Date().toISOString().split('T')[0];
  translationFile.meta.translationCount = Object.keys(translationFile.translations).length;

  saveTranslationFile(language, translationFile);

  console.log(`\n✅ Successfully updated ${toTranslate.length} translations!`);
  console.log(`   File: src/services/translation/translations/${language}.json`);
  console.log(`   Total translations: ${translationFile.meta.translationCount}/${totalKeys}\n`);
  console.log('📝 Next steps:');
  console.log('   1. Review the changes in the JSON file');
  console.log('   2. Commit the updated translation file to git');
  console.log('   3. Test the translations in the app\n');
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const language = args[0] || 'zh';

  if (!LANGUAGES[language]) {
    console.error(`\n❌ Error: Unknown language "${language}"`);
    console.error(`   Supported languages: ${Object.keys(LANGUAGES).join(', ')}\n`);
    process.exit(1);
  }

  try {
    await updateTranslations(language);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
// Always run when this script is executed
main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
