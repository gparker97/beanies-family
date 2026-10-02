# ADR-040: Translations are hand-authored in the repo, completeness by type

- **Status:** Accepted
- **Date:** 2026-10-02
- **Related:** Notion tracker #38; supersedes the translation-pipeline part of ADR-008
- **Plan:** `docs/plans/2026-10-02-claude-authored-zh-strings.md`
- **Implementation:** `src/services/translation/zh.ts`, `src/stores/translationStore.ts`

## Context

Chinese UI text came from a machine pipeline: a nightly script asked MyMemory (a translation-memory lookup, not a translator) for every English value whose hash had changed, committed the result to `main`, and the app then called MyMemory live from the browser for anything still missing. The output was unreliable. Traditional characters reached the bundle twice in two weeks, and in June a spam link and a dictionary dump shipped as UI copy. The runtime call also sent UI strings and the user's IP to a third party, and it silently papered over missing translations.

## Decision

- Translations are authored in the repo by the session that writes the English. There is no machine pipeline, no nightly job and no runtime translation call.
- `zh` lives in `src/services/translation/zh.ts` as `ZH_STRINGS: Record<UIStringKey, string>`. A missing key and a removed key are both compile errors, so completeness is enforced by the type, not by a script or a test. A changed English meaning with an untouched Chinese value is not detectable, as for `beanie`.
- `translationStore` loads the module with a dynamic `import('./zh')`, so Chinese is a lazy chunk that the service worker precaches and that works offline.
- The glossary is `ZH_BRAND_TERMS` in `uiStrings.test.ts`; style and process live in `docs/TRANSLATION.md`.

## Consequences

- A string edit touches two files. The compile error names the exact key, so it cannot be forgotten.
- Staleness is undetectable: when the English changes and the Chinese does not, nothing fails. This is the same situation `beanie` is in, bounded by the English-passthrough test, and the authoring rule ("en, beanie and zh in the same edit") is the control.
- Adding a language is a module (a `LanguageCode` member, a `LOADERS` entry and a sibling file), not a pipeline.
- No third-party call is made from the client, and the `beanies-translations` IndexedDB cache, the hash machinery and `VITE_MYMEMORY_EMAIL` are gone.
- ADR-008's pipeline section no longer applies; its decision to support English and Chinese through `t()` stands.
