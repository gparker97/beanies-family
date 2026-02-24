# Translation System

Comprehensive guide for the beanies.family translation pipeline.

## How It Works

```
STRING_DEFS (uiStrings.ts)          ← Single source of truth for English strings
       │
       ▼
scripts/updateTranslations.mjs      ← Batch translator (MyMemory API)
       │
       ▼
public/translations/{lang}.json     ← Pre-translated JSON files
       │
       ▼
Service Worker (vite-plugin-pwa)    ← Precaches JSON files for offline use
       │
       ▼
useTranslation() composable         ← Runtime: checks JSON → IndexedDB cache → API fallback
       │
       ▼
{{ t('key') }} in Vue templates     ← Displays translated text
```

### Flow in Detail

1. **Source strings** are defined in `src/services/translation/uiStrings.ts` as `STRING_DEFS` entries with `{ en: 'English text' }` format
2. **Hash-based invalidation**: each English string is hashed using a simple hash function. When the English text changes, the hash changes, triggering re-translation
3. **Pre-translated JSON files** in `public/translations/` contain translations with their hashes
4. **At runtime**, `useTranslation()` checks:
   - Pre-loaded JSON file (fastest, no network)
   - IndexedDB cache (local, persisted)
   - MyMemory API (online fallback, cached after first call)
5. **Service Worker** precaches the JSON files so translations work offline

## Automated Daily Pipeline

A GitHub Actions workflow (`.github/workflows/translation-sync.yml`) runs daily at 3 AM UTC:

1. Parses `STRING_DEFS` from `uiStrings.ts`
2. Compares with existing translations in all `public/translations/*.json` files
3. Translates missing/outdated strings via MyMemory API
4. Removes stale keys no longer in `STRING_DEFS`
5. If changes detected: commits and pushes to `main`
6. If translations changed: triggers a production deploy (S3 + CloudFront)

### Manual Trigger

You can trigger the workflow manually from the GitHub Actions tab:

1. Go to **Actions** → **Translation Sync**
2. Click **Run workflow** → **Run workflow**

### CLI Usage

```bash
# Translate all languages (default)
npm run translate

# Translate a specific language
npm run translate:zh
```

## Adding a New Language

1. **Add to `LANGUAGES`** in `scripts/updateTranslations.mjs`:

   ```javascript
   const LANGUAGES = {
     zh: { code: 'zh', name: '中文 (简体)', myMemoryCode: 'zh-CN' },
     es: { code: 'es', name: 'Español', myMemoryCode: 'es' }, // ← new
   };
   ```

2. **Add npm script** in `package.json`:

   ```json
   "translate:es": "node scripts/updateTranslations.mjs es"
   ```

3. **Add to app language picker** in the relevant UI configuration

4. **Run the translator**:

   ```bash
   npm run translate:es
   ```

5. **Commit** the new `public/translations/es.json` file

The daily pipeline will keep it updated automatically going forward.

## Fixing a Bad Translation

To correct a translation manually:

1. Edit `public/translations/{lang}.json` directly
2. Change only the `"translation"` value — **do not change the `"hash"`**
3. Commit the change

The translation script uses hashes to detect when the **English source** has changed. As long as the hash matches the current English text, your manual fix will be preserved and not overwritten.

Example:

```json
"nav.goals": {
  "translation": "目标",         ← Fix this value
  "hash": "152c9s",              ← Keep this unchanged
  "lastUpdated": "2026-02-24"
}
```

## Hash-Based Invalidation

Each English string is hashed at build time and at translation time:

```
hashString('Goals') → '152c9s'
```

- If you change the English text in `uiStrings.ts`, the hash changes
- The translation script detects the hash mismatch and re-translates that key
- Manual translation fixes are preserved as long as the English source hasn't changed

## Stale Key Cleanup

When UI strings are removed from `STRING_DEFS`, the translation script automatically removes the corresponding keys from all JSON files. This prevents stale translations from accumulating.

## Troubleshooting

### "Could not find STRING_DEFS in uiStrings.ts"

The parser expects `const STRING_DEFS = { ... } satisfies Record<string, StringEntry>` in `uiStrings.ts`. If the format has changed, update the parser in `scripts/updateTranslations.mjs`.

### API Rate Limits

MyMemory allows ~50,000 characters/day with email parameter. If you hit limits:

- Increase `REQUEST_DELAY_MS` in the script (default: 250ms)
- Wait and retry the next day
- The script only translates missing/changed strings, so subsequent runs are fast

### Translations Not Updating in Production

1. Check that the Service Worker has updated (look for `UpdatePrompt` in the app)
2. Clear browser cache / IndexedDB translations store
3. Verify `public/translations/{lang}.json` has the expected content
4. Check the GitHub Actions **Translation Sync** workflow for errors

### Script Fails to Parse New Format

If `uiStrings.ts` is refactored, the parser in `scripts/updateTranslations.mjs` may need updating. The parser uses a line-by-line approach and expects:

- Keys as single-quoted strings: `'key.name': {`
- English values as `en: 'text'` or `en: "text"`
- Each entry on its own line(s) within the `STRING_DEFS` block
