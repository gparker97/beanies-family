# Scripts

## Airport List Update (`updateAirports.mjs`)

Regenerates `src/constants/airports.ts` from [OurAirports](https://ourairports.com/data/) (public domain).

### Usage

```bash
npm run update-airports
```

### What It Does

1. **Fetches** the latest `airports.csv` from the OurAirports GitHub mirror
2. **Filters** to airports with `scheduled_service=yes` AND a valid 3-letter IATA code (~4,200 entries — covers every commercial airport globally; excludes general-aviation strips without scheduled flights)
3. **Cleans** names ("Singapore Changi Airport" → "Singapore Changi") and strips parenthetical suburb annotations from cities ("Sydney (Mascot)" → "Sydney")
4. **Renders** TypeScript matching the existing `AirportInfo` shape, plus an optional `country` field (ISO alpha-2)
5. **Runs Prettier** on the output so the diff stays clean
6. **Skips** writing if the regenerated content is identical to what's on disk (idempotent — CI uses this to decide whether to open a PR)

### Why scheduled-service-only

Going broader (all IATA-coded airports including GA fields like TOA Torrance) would balloon the list to ~9,000 entries / ~600 KB. The combobox already has an **Other** entry for the rare GA case. Scheduled-service is the right cut for a family travel planner.

### Automated Pipeline

`.github/workflows/airport-sync.yml` runs the script on the 1st of each month at 04:00 UTC. If the airport list changed, it pushes a branch and opens a PR for review.

### Adjusting the Filter

The inclusion rule is in `parseAirports()` inside the script. To change it (e.g. add general-aviation airports), edit the `if (sched !== 'yes') continue;` line.

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
