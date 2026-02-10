# Translation Files

This directory contains translation files for the application UI strings.

## File Format

Each language has its own JSON file (e.g., `zh.json`, `es.json`).

### Structure

```json
{
  "meta": {
    "language": "zh",
    "languageName": "中文 (简体)",
    "lastUpdated": "2026-02-10",
    "translationCount": 123
  },
  "translations": {
    "app.name": {
      "translation": "GP家庭规划师",
      "hash": "abc123",
      "lastUpdated": "2026-02-10"
    }
  }
}
```

### Fields

- **meta.language**: ISO language code
- **meta.languageName**: Native language name
- **meta.lastUpdated**: Last update date
- **meta.translationCount**: Number of translations

For each translation:
- **translation**: The translated text
- **hash**: Hash of the source English text (auto-computed)
- **lastUpdated**: When this translation was last updated

## How It Works

1. English strings are defined in `uiStrings.ts`
2. Each string has a computed hash based on its content
3. When an English string changes, its hash changes
4. The system detects the hash mismatch and re-translates only that string
5. Translations are stored in these JSON files and committed to git

## Editing Translations

You can manually edit translations in these files. Just update the `translation` field for any key. The `hash` and `lastUpdated` fields will be updated automatically when the system detects changes.

## Adding New Languages

1. Create a new JSON file with the language code (e.g., `es.json`)
2. Copy the structure from `zh.json`
3. Update the `meta` section with the new language info
4. The system will automatically translate all strings when the language is selected
