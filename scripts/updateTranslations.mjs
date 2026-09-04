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
import { fileURLToPath, pathToFileURL } from 'url';

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
 * Resolve the JS string escapes a TEXT-level parse leaves behind.
 *
 * This script reads `uiStrings.ts` as text, not as a module, so a source
 * literal like `'A\u2013Z'` arrives here as the six characters `\u2013` and
 * was shipped to the translator verbatim — a zh user then saw the literal
 * `A\ u2013Z` in the cookbook sort dropdown, and roughly fifty older entries
 * carried the same corruption from `\u2014`. Unescape before hashing, so the
 * hash tracks the RENDERED string.
 *
 * ⚠️ ONE PASS, NOT A CHAIN OF `.replace()` CALLS. Sequential passes cannot see
 * which backslashes are already spoken for: with `\\` handled last, the source
 * `'…beef\\n3 carrots'` (an escaped backslash followed by `n`, which three
 * recipe placeholders really contain) has its SECOND backslash matched by the
 * `\n` pass and turned into a real newline. That corrupted text is what gets
 * hashed and sent to the translator, and the newline then trips the
 * suspicious-output check, so the key falls back to English.
 *
 * A single alternation consumes each escape exactly once, left to right, so a
 * backslash that has already been claimed cannot start another escape.
 */
function unescapeLiteral(raw) {
  return raw.replace(
    /\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/gs,
    (match, brace, u4, x2, other) => {
      try {
        if (brace !== undefined) return String.fromCodePoint(parseInt(brace, 16));
      } catch {
        return match; // out of Unicode range — leave it alone rather than throw
      }
      if (u4 !== undefined) return String.fromCharCode(parseInt(u4, 16));
      if (x2 !== undefined) return String.fromCharCode(parseInt(x2, 16));
      const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
      // `\\` -> `\`, `\'` -> `'`, `\"` -> `"`, and any other escaped char is itself.
      return Object.prototype.hasOwnProperty.call(simple, other) ? simple[other] : other;
    }
  );
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
        const text = unescapeLiteral(enSingle[1]);
        strings[currentKey] = { text, hash: hashString(text) };
        currentKey = null;
        continue;
      }
      // Double-quoted en value
      const enDouble = line.match(/en\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (enDouble) {
        const text = unescapeLiteral(enDouble[1]);
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
 * Guard against garbage MyMemory output.
 *
 * The free MyMemory endpoint intermittently returns junk for short UI labels:
 * injected HTML/SVG markup (incl. gambling-spam `<a href>` links), phonetic
 * dictionary dumps, mangled escape sequences, and placeholder artifacts. Blindly
 * trusting it shipped strings like a `<a href="...gouwo8.com">` spam link in the
 * cruise "Embark" label and a dictionary definition for "Crypto". This rejects
 * such output so the caller falls back to English (always safe, and fixable by
 * hand in the JSON later) instead of persisting garbage.
 *
 * Returns a reason string if suspicious, or null if the translation looks clean.
 */
export function suspiciousTranslationReason(source, translated) {
  // 1. Control characters MyMemory INVENTED. A few strings legitimately contain
  //    newlines (the invite message, the multi-line recipe placeholders), so a
  //    blanket reject fell every one of them back to English.
  //
  //    Compared as a character SET, not "does the source have any": gating the
  //    whole test on one newline in the source would accept a NUL, a form feed
  //    or a stray CR in the translation of that same key.
  const controlRe = /[\t\r\n\x00-\x08\x0b\x0c]/g;
  const allowed = new Set(source.match(controlRe) ?? []);
  if ((translated.match(controlRe) ?? []).some((c) => !allowed.has(c))) {
    return 'control characters';
  }

  // 2. Markup in the translation that the English source did not have — injected.
  const tagRe = /<\/?[a-zA-Z][^>]*>|<[a-zA-Z]+\s+[a-zA-Z]/;
  if (tagRe.test(translated) && !tagRe.test(source)) return 'injected HTML/markup';

  // 3. Placeholder/escape artifacts MyMemory leaks (<x id>, <ph>, <g id>, \ u2192).
  if (/<(?:x|ph|g)\b/i.test(translated) && !/<(?:x|ph|g)\b/i.test(source))
    return 'placeholder artifact';
  if (/\\\s*u\s*\{?[0-9a-fA-F]{2,}/.test(translated) && !/\\\s*u/.test(source))
    return 'mangled escape sequence';

  // 4. URLs the source didn't contain (spam links).
  if (/https?:\/\//i.test(translated) && !/https?:\/\//i.test(source)) return 'injected URL';

  // 5. Phonetic dictionary dump (e.g. "crypto\n英 ['krɪptəʊ] ... n. ...").
  if (/[英美]\s*\[|\bn\.\s|；.*；.*；/.test(translated) && source.length < 40)
    return 'dictionary-definition dump';

  // 6. Implausibly long output for a short label (junk padding).
  if (source.length <= 24 && translated.length > source.length * 6 + 24)
    return 'implausible length';

  // 7. Every `{placeholder}` in the source must survive verbatim. MyMemory
  //    translates them ("{title}" → "标题"), which silently destroys the
  //    interpolation: `fillTemplate` finds no token, so the value is emitted
  //    raw. That shipped a zh notification titled "标题" for every reminder.
  //    This is a whole CLASS of defect — ~40 keys carry placeholders.
  const placeholders = source.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  if (placeholders.some((p) => !translated.includes(p))) return 'placeholder lost in translation';

  return null;
}

/**
 * Translate text using MyMemory API
 */
/**
 * @returns `{ text, fellBack }` — `fellBack` is true when the ENGLISH source is
 * being returned because the API failed or its output was rejected. Reported
 * explicitly rather than inferred from `result === source`, because ~50 entries
 * are identical by design and inferring re-requests them on every run forever.
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
      return { text, fellBack: true };
    }

    // Decode HTML entities
    const decoded = data.responseData.translatedText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Reject garbage output (HTML injection, spam links, dictionary dumps, etc.)
    // — fall back to English, which is always safe and hand-fixable in the JSON.
    const reason = suspiciousTranslationReason(text, decoded);
    if (reason) {
      console.warn(`   ⚠ Rejected suspicious translation for "${text}" (${reason}): "${decoded}"`);
      return { text, fellBack: true };
    }

    return { text: decoded, fellBack: false };
  } catch (error) {
    console.error(`   ✗ Error translating "${text}":`, error.message);
    return { text, fellBack: true };
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
  let fellBack = 0;
  for (const { key, text, hash, reason } of toTranslate) {
    const translation = await translate(text, language);

    // ⚠️ `translate()` returns the ENGLISH text on an API failure or a rejected
    // suspicious result. Stamping the current hash on that told the next run
    // "up to date", so the key stayed English forever and only a hand-edit of
    // the JSON could recover it — and it silently REPLACED four good Chinese
    // translations that way, including the family-invite message.
    //
    // The fallback is reported by `translate` itself rather than inferred from
    // `translation === text`: about fifty entries are identical by design
    // ('beanies.family', 'you@example.com', '{done}/{total}'), and inferring
    // would re-request every one of them on every run, forever, against a
    // rate-limited free tier.
    if (translation.fellBack) {
      fellBack++;
      const existing = translationFile.translations[key];
      if (existing?.translation && existing.translation !== text) {
        // Keep the good translation, but CLEAR its hash so the next run retries
        // rather than leaving the stale one in place to be re-requested forever
        // while the summary claims otherwise.
        console.warn(`   ⚠ Keeping the existing translation for ${key} (API fell back to English)`);
        translationFile.translations[key] = { ...existing, hash: '' };
      } else {
        // No hash: the next run sees it as outdated and retries.
        translationFile.translations[key] = {
          translation: translation.text,
          hash: '',
          lastUpdated: new Date().toISOString().split('T')[0],
        };
      }
      completed++;
      // Skip the "English → English" progress line, which read as a successful
      // translation for a key that deliberately was not written.
      if (completed < toTranslate.length) await sleep(REQUEST_DELAY_MS);
      continue;
      // Fall through to the sleep below. An early `continue` skipped it, so once
      // MyMemory starts refusing (quota) every remaining key fired back to back
      // with no throttle — the traffic shape that turns a soft quota into a
      // block.
    } else {
      translationFile.translations[key] = {
        translation: translation.text,
        hash,
        lastUpdated: new Date().toISOString().split('T')[0],
      };
      completed++;
    }

    const percentage = Math.round((completed / toTranslate.length) * 100);
    const reasonEmoji = reason === 'missing' ? '🆕' : '🔄';
    console.log(`   [${percentage}%] ${reasonEmoji} ${key}`);
    console.log(`        "${text}" → "${translation.text}"`);

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
  if (fellBack > 0) {
    // Loudly, because a clean-looking summary over silently-English keys is
    // exactly how four good Chinese strings were lost without anyone noticing.
    console.warn(
      `   ⚠ ${fellBack} key(s) fell back to English (API failure or rejected output). ` +
        'They are stored WITHOUT a hash and will be retried on the next run.'
    );
  }

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

// Run as a CLI only when invoked directly — NOT when a test imports
// `suspiciousTranslationReason`. Without this guard, importing the module calls
// the MyMemory API and rewrites public/translations/zh.json during the test run.
// Same pattern as scripts/derive-store-version.mjs.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}
