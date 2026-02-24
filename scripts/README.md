# Scripts

## Translation Update (`updateTranslations.mjs`)

Automatically updates translation JSON files by parsing `STRING_DEFS` from `uiStrings.ts` and translating missing or outdated strings via the MyMemory API.

### Usage

```bash
# Translate all configured languages (default)
npm run translate

# Translate a single language
npm run translate:zh
```

### What It Does

1. **Parses `STRING_DEFS`** from `src/services/translation/uiStrings.ts` (line-by-line parser)
2. **Compares** with existing translations in `public/translations/{language}.json`
3. **Identifies** missing or outdated translations (hash-based comparison)
4. **Removes stale keys** no longer present in `STRING_DEFS`
5. **Fetches** translations from MyMemory API for missing/outdated strings
6. **Saves** updated JSON files

### Features

- **Multi-language**: `--all` flag (default) translates all configured languages
- **Hash-based tracking**: Only re-translates when English source text changes
- **Stale key cleanup**: Removes translations for deleted source strings
- **CI-friendly**: Summary output, exit 0 when up to date, non-zero on errors
- **API-friendly**: 250ms delay between requests to respect rate limits
- **Safe fallbacks**: Uses original text if translation API fails

### Automated Pipeline

A GitHub Actions workflow (`.github/workflows/translation-sync.yml`) runs this script daily at 3 AM UTC, commits any changes, and deploys to production. See `docs/TRANSLATION.md` for full details.

### Adding a New Language

1. Add an entry to `LANGUAGES` in `scripts/updateTranslations.mjs`:

```javascript
const LANGUAGES = {
  zh: { code: 'zh', name: '中文 (简体)', myMemoryCode: 'zh-CN' },
  es: { code: 'es', name: 'Español', myMemoryCode: 'es' }, // new
};
```

2. Add an npm script in `package.json`:

```json
"translate:es": "node scripts/updateTranslations.mjs es"
```

3. Run `npm run translate:es` to generate the initial translation file.

### API Information

Uses [MyMemory Translation API](https://mymemory.translated.net/):

- Free tier: 50,000 characters/day
- Rate limit: ~1 request per 250ms (respectful)
- No API key required (email parameter for higher limits)

### Troubleshooting

**Translation quality issues?**

- Edit the JSON file directly to fix translations
- Keep the `hash` unchanged — your fix won't be overwritten

**API rate limit errors?**

- Increase `REQUEST_DELAY_MS` in the script
- Wait and retry the next day

**Script fails to parse uiStrings.ts?**

- Ensure `const STRING_DEFS = { ... } satisfies Record<string, StringEntry>` format
- Keys must be single-quoted: `'key.name': {`
- `en:` values can be single or double-quoted
