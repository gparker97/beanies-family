# Translation System

How beanies.family strings are written, enforced and loaded.

## Enforcement — no hardcoded UI strings (CI-blocking)

**Every user-visible string in the app must go through `t()`.** Partial translation (some strings localized, some bare English) is worse than none: it leaves multi-language users confused and is a real drop-off cause. This is enforced, not just documented.

- **ESLint rule `vue/no-bare-strings-in-template` (error)** in `eslint.config.js` fails CI on any hardcoded text node OR user-facing attribute (`title`, `aria-label`, `alt`, `placeholder`) in a `.vue` template. To fix a flag: move the string to `uiStrings.ts` and bind it — `{{ t('key') }}` for text, `:title="t('key')"` for attributes.
- **Allowlist** (in the rule config): brand terms (`beanies.family`, `.beanpod`), third-party product names (Google Drive, PDF, OneDrive…), non-linguistic symbols, and **decorative emoji/glyphs** (they render identically in every language, so carry no translatable content). A NEW decorative glyph trips the rule → add it to the allowlist _intentionally_ (this keeps the decorative-glyph set reviewed). Prefer `aria-hidden="true"` on glyphs that sit next to real text.
- **Dev-only UI** (`src/components/settings/DevFeatureFlagsCard.vue`, rendered only under `import.meta.env.DEV`) is exempt via a scoped `files` override — its copy is developer-facing.
- **Out of scope**: the Astro marketing site (`web/`), blog, and help center are English-first by decision and are not linted by this rule.

- **Custom rule `beanies-i18n/no-bare-render-strings` (error)** closes the `.ts` blind spot that `vue/no-bare-strings-in-template` can't see (that rule only scans `.vue` templates). It flags bare user-facing English assigned to display-bound keys (`label`/`title`/`heading`/`subtitle`/`placeholder`/`tooltip`/`ariaLabel`/`text`) in rendered data sources under `src/constants/**` and `src/composables/**` — exactly how the travel-segment labels and the transaction-category names once shipped as bare English. It is intentionally narrow to avoid false positives: it skips translation keys (anything with a `.`), camelCase identifiers (`'useBeanTips'`), all-caps acronyms (`'IRA'`, `'PDF'`), `<expr> as UIStringKey` casts, and a small brand/product allowlist. Rule source: `eslint-rules/no-bare-render-strings.js`. To fix a flag: route the value through `t()` — add the key to `uiStrings.ts` and resolve at the render site (see `useCategoryLabel` / `useActivityCategoryLabel` for the id→`t()` label-resolver pattern). For a genuinely non-translatable token, add it to the rule's `allowlist` in `eslint.config.js` (keeps the exempt set reviewed).

**The lint rules cannot catch every script-level string** (the `.ts` rule only checks display-bound object keys, the template rule only `.vue`) — the rest are review-enforced:

- `showToast('error', title, message)`, `confirm({ title, message })`, `setFatal(...)` args, and any option-label array rendered in a template must use `t()`.
- In `.ts` files (composables/services), use `useTranslationStore().t('key')`. In a **foundational** util that may run before Pinia is active, wrap the lookup in `try/catch` with an English fallback so a translation lookup can never swallow the user's feedback (see `invokeToastAction` in `useToast.ts` / `safeT` in `useStoreActions.ts`).
- **Rendered data in `constants/` / `composables/`**: any user-facing label/name in a data definition must resolve through `t()` at the render site (the `no-bare-render-strings` rule enforces the common keys; `name`-keyed reference data like `categories.ts` is routed via a label-resolver composable). Proper-noun reference data (airports, airlines, countries, currencies, cruise lines, institutions) is not translated.

**Interpolation:** `t()` takes ONLY a key — no params object. Use `fillTemplate(t('key'), { name })` (`@/utils/fillTemplate`); keys hold `{placeholder}` tokens, which every translation must preserve. Pluralization uses explicit `.one`/`.other` key pairs, chosen in-template by count (no ICU plurals).

## How It Works

```
uiStrings.ts (en, beanie)  +  zh.ts (zh)
        │                         │
        └──────► translationStore ┘  (dynamic import('./zh'), lazy chunk)
                        │
                        ▼
                      t('key')
```

- `src/services/translation/uiStrings.ts` holds every key with its `en` and `beanie` values.
- `src/services/translation/zh.ts` exports `ZH_STRINGS: Record<UIStringKey, string>`, one Simplified Chinese value per key.
- `translationStore` loads the module for the active language with a dynamic `import('./zh')`. It becomes its own chunk, is precached by the service worker, and works offline. English and beanie mode need no load.
- `t('key')` returns the value for the current language. There is no network call, no cache database and no fallback API.

## Adding a string (three values)

1. Add the key to `uiStrings.ts` with `en` (Title Case for labels, Sentence case for sentences) and `beanie` (lowercase overlay).
2. Add the same key to `zh.ts` with the Chinese value.
3. Run `npm run type-check`. A missing key and a removed key (one that no longer exists in `uiStrings.ts`) are both compile errors that name the key. The type cannot see a Chinese value whose English later changed meaning; editing all three values in the same change is what prevents that, exactly as for `beanie`.

Write all three in the same edit as the feature. Renaming or deleting a key means editing both files.

## Glossary

The canonical list is `ZH_BRAND_TERMS` in `src/services/translation/uiStrings.test.ts`; this document references it rather than restating it. Check there first, then use these consistency renderings.

| English                  | Chinese  | English             | Chinese    |
| ------------------------ | -------- | ------------------- | ---------- |
| family                   | 家庭     | pod (in a sentence) | Pod        |
| family file              | 家庭文件 | family data         | 家庭数据   |
| member                   | 成员     | magic beans         | 魔法豆     |
| bean (AI allowance unit) | 豆子     | beanie mode         | 豆豆模式   |
| magic link               | 魔法链接 | recovery kit        | 恢复套件   |
| sign in                  | 登录     | sign out            | 退出登录   |
| sync                     | 同步     | device              | 设备       |
| activity                 | 活动     | to-do               | 待办       |
| list                     | 清单     | recipe              | 食谱       |
| cookbook                 | 家庭食谱 | meal planner        | 餐食计划   |
| shopping list            | 购物清单 | scrapbook           | 家庭纪念册 |
| travel plan              | 旅行计划 | Who Owns What       | 家务分工   |
| Finance Corner           | 财务角   | Piggy Bank          | 存钱罐     |
| account                  | 账户     | transaction         | 交易       |
| budget                   | 预算     | goal                | 目标       |
| asset                    | 资产     | settings            | 设置       |
| wall display             | 家庭看板 | care & safety       | 关爱与安全 |
| medication               | 用药     | emergency contact   | 紧急联系人 |

**Kept in English (brand terms):** beanies.family, The Pod / Pod, The Treehouse, Little Bean, Parent Bean, Meet the Beans, Nook, The Beanie Lab, beanies AI, Discord Beanies, .beanpod, Google Drive, Dropbox, iCloud, OneDrive.

## Style rules

- Simplified Chinese only; Traditional characters fail a test.
- Natural app register: read it as a Chinese-speaking parent would in a family app, not as a word-for-word render.
- Preserve every `{placeholder}` token exactly; word order around it may change.
- Write both `.one` and `.other` naturally. Chinese has no plural, so they are often identical.
- Use full-width punctuation inside sentences (，。！？：；（）).
- No trailing punctuation unless the `en` value has it.
- Worked examples live in `.claude/skills/beanies-theme/SKILL.md` § Chinese (zh) authoring.

## Adding a language

1. Add the code to the `LanguageCode` union.
2. Add a `LOADERS` entry in `translationStore` that does `import('./<code>')`.
3. Create the sibling module `src/services/translation/<code>.ts` exporting a `Record<UIStringKey, string>`.
4. Add the language to the picker and its glossary to `docs/TRANSLATION.md`.

Type-check then lists every key the new module is missing.

## What the tests enforce

- Completeness by type: `zh.ts` is `Record<UIStringKey, string>`, so a missing or removed key fails `npm run type-check`. A changed English meaning with an untouched Chinese value is not detectable (same as `beanie`).
- Placeholders: every `{placeholder}` in `en` appears in `zh`, and no extra ones.
- Script: no Traditional characters in the Chinese values.
- English passthrough: a `zh` value made only of Latin text must be a brand term, a product name or a format literal, and no value may contain a run of two or more untranslated English words outside the glossary. This bounds the worst staleness case (English pasted into `zh.ts`), not a changed meaning.
- Glossary consistency (to-do always 待办, and so on) is NOT tested; it is a review discipline, with the renderings listed above.
- Beanie mode: the important-surface `beanie` rule in `uiStrings.test.ts`.

Staleness (English changed, Chinese not) is not detectable by design; the same-edit authoring rule is the control.

## History

Until 2026-10-02 Chinese came from a nightly MyMemory pipeline plus a live in-browser call, which produced Traditional characters, spam and dictionary dumps. It was retired and every string was rewritten by hand. See `docs/plans/2026-10-02-claude-authored-zh-strings.md` and `docs/adr/040-hand-authored-translations.md`.
