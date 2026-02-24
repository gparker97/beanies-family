# ADR-008: Internationalization with Dynamic Translation

**Status:** Accepted
**Date:** See commit "Add multilingual translation support to all page views"

## Context

The application needs to support multiple languages. Initially English and Chinese (Simplified) are required.

## Decision

Use a **dynamic translation approach** combining pre-translated static JSON files with a live translation API (MyMemory) fallback and IndexedDB caching, backed by an automated daily pipeline.

### Implementation Details

- **Supported languages**: English (`en`), Chinese Simplified (`zh`) — defined as `LanguageCode` type
- **Translation API**: MyMemory (`api.mymemory.translated.net`) — free, CORS-enabled, no API key required
- **API limits**: Up to 50,000 characters/day with email parameter
- **Caching**: Translations cached in IndexedDB `translations` store
- **Hash-based invalidation**: Source text is hashed; cached translations are re-fetched when source text changes
- **Static files**: Pre-translated JSON in `public/translations/{lang}.json` — precached by Service Worker
- **UI strings**: `src/services/translation/uiStrings.ts` — `STRING_DEFS` is the single source of truth
- **Translation script**: `scripts/updateTranslations.mjs` — batch pre-translation with stale key cleanup
- **Automated pipeline**: `.github/workflows/translation-sync.yml` — daily cron at 3 AM UTC

### Architecture

```
STRING_DEFS (uiStrings.ts)          ← Single source of truth
       │
       ▼
scripts/updateTranslations.mjs      ← Batch translator (daily via GitHub Actions)
       │
       ▼
public/translations/{lang}.json     ← Pre-translated JSON files
       │
       ▼
Service Worker (vite-plugin-pwa)    ← Precaches JSON for offline use
       │
       ▼
Component → useTranslation()
              ├── Check pre-loaded JSON (instant, no network)
              ├── Check IndexedDB cache (by key + language + hash)
              ├── If cached and hash matches → return cached
              ├── If missing or stale → call MyMemory API
              └── Cache result in IndexedDB
```

### Commands

- `npm run translate` — Update all translation files (all languages)
- `npm run translate:zh` — Update Chinese translations only

## Consequences

### Positive

- No large translation bundles shipped — translations fetched and cached on demand
- Pre-populated JSON files eliminate first-load delay for known strings
- Free API with reasonable limits for a personal/family app
- Cache prevents repeated API calls for the same text
- Hash-based invalidation ensures translations stay current when source changes
- Automated daily pipeline keeps translations in sync without manual intervention
- Stale key cleanup prevents accumulation of unused translations

### Negative

- First load of a **new** string (not yet in JSON) requires API call (visible delay)
- Depends on external API availability for new/changed strings
- Limited to languages supported by MyMemory
- Rate limiting (250ms between requests) makes bulk translation slow (~2 min for 400 strings)
