# ADR-008: Internationalization with Dynamic Translation

**Status:** Accepted
**Date:** See commit "Add multilingual translation support to all page views"

## Context

The application needs to support multiple languages. Initially English and Chinese (Simplified) are required.

## Decision

Use a **dynamic translation approach** combining static translation files with a live translation API (MyMemory) and IndexedDB caching.

### Implementation Details

- **Supported languages**: English (`en`), Chinese Simplified (`zh`) — defined as `LanguageCode` type
- **Translation API**: MyMemory (`api.mymemory.translated.net`) — free, CORS-enabled, no API key required
- **API limits**: Up to 50,000 characters/day with email parameter
- **Caching**: Translations cached in IndexedDB `translations` store
- **Hash-based invalidation**: Source text is hashed; cached translations are re-fetched when source text changes
- **Static files**: `src/services/translation/translationFiles.ts` for pre-translated strings
- **UI strings**: `src/services/translation/uiStrings.ts` for component labels
- **Translation script**: `scripts/updateTranslations.mjs` for batch pre-translation

### Architecture

```
Component → useTranslation composable
              ├── Check IndexedDB cache (by key + language + hash)
              ├── If cached and hash matches → return cached
              ├── If missing or stale → call MyMemory API
              └── Cache result in IndexedDB
```

### Commands

- `npm run translate` — Update all translation files
- `npm run translate:zh` — Update Chinese translations only

## Consequences

### Positive

- No large translation bundles shipped — translations fetched and cached on demand
- Free API with reasonable limits for a personal/family app
- Cache prevents repeated API calls for the same text
- Hash-based invalidation ensures translations stay current when source changes

### Negative

- First load in a new language requires API calls (visible delay)
- Depends on external API availability
- Limited to languages supported by MyMemory
- Rate limiting (200ms between requests) makes batch translation slow
