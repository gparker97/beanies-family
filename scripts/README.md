# Translation Scripts

## Update Translations

Automatically fetch and update translation files with missing or outdated translations.

### Usage

```bash
# Update Chinese translations
npm run translate:zh

# Or specify language manually
npm run translate zh
```

### What It Does

1. **Reads source strings** from `src/services/translation/uiStrings.ts`
2. **Compares** with existing translations in `src/services/translation/translations/{language}.json`
3. **Identifies** missing or outdated translations (based on hash)
4. **Fetches** translations from MyMemory API
5. **Updates** the JSON file with new translations

### Features

- ✅ **Smart detection**: Only translates changed or missing strings
- ✅ **Hash-based tracking**: Automatically detects when English text changes
- ✅ **Progress reporting**: Shows real-time progress with emojis
- ✅ **API-friendly**: Includes delays to respect API rate limits
- ✅ **Safe fallbacks**: Uses original text if translation fails

### Output

The script updates: `src/services/translation/translations/{language}.json`

Example output:
```
🌐 Updating translations for: 中文 (简体) (zh)

📖 Reading source strings from uiStrings.ts...
   Found 287 strings

📂 Loading existing translation file...
   Found 250 existing translations

🔍 Checking for missing or outdated translations...
   Missing: 35
   Outdated: 2
   Total to translate: 37

🔄 Translating 37 strings (this may take a few minutes)...

   [3%] 🆕 app.newFeature
        "New Feature" → "新功能"
   [5%] 🔄 settings.title
        "Settings" → "设置"
   ...

💾 Saving translation file...

✅ Successfully updated 37 translations!
   File: src/services/translation/translations/zh.json
   Total translations: 287/287

📝 Next steps:
   1. Review the changes in the JSON file
   2. Commit the updated translation file to git
   3. Test the translations in the app
```

### Adding New Languages

To add support for a new language, edit `scripts/updateTranslations.mjs`:

```javascript
const LANGUAGES = {
  zh: {
    code: 'zh',
    name: '中文 (简体)',
    myMemoryCode: 'zh-CN'
  },
  es: {  // Add new language
    code: 'es',
    name: 'Español',
    myMemoryCode: 'es'
  }
};
```

Then add a corresponding npm script in `package.json`:
```json
"translate:es": "node scripts/updateTranslations.mjs es"
```

### API Information

Uses [MyMemory Translation API](https://mymemory.translated.net/):
- Free tier: 50,000 characters/day
- Rate limit: ~1 request per 250ms (respectful)
- No API key required (but included for higher limits)

### Troubleshooting

**Translation quality issues?**
- Manually edit the JSON file to fix translations
- The hash will remain the same, so your fix won't be overwritten

**API rate limit errors?**
- Increase `REQUEST_DELAY_MS` in the script
- Wait a few minutes and try again

**Script fails to parse uiStrings.ts?**
- Ensure the `UI_STRINGS` object format hasn't changed
- Check for syntax errors in uiStrings.ts
