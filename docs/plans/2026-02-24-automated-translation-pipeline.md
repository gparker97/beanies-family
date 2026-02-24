# Plan: Automated translation pipeline

> Date: 2026-02-24
> Related: Translation loading slow in production, incomplete zh.json

## Context

`public/translations/zh.json` has 287 of 531 UI string keys. The remaining 244 missing keys cause a slow fallback to the MyMemory API on every page load in production. The existing CLI script (`scripts/updateTranslations.mjs`) is **broken** — it tries to regex-match `export const UI_STRINGS = { ... } as const` but `UI_STRINGS` was refactored to be dynamically derived from `STRING_DEFS`. The script fails with "Could not parse UI_STRINGS from uiStrings.ts".

**Goal:** Fix the script to work with `STRING_DEFS`, make it handle arbitrary languages, create a GitHub Actions workflow that runs daily to auto-translate → commit → deploy, and update all relevant documentation.

## Approach

### 1. Fix and enhance `scripts/updateTranslations.mjs`

**Parser fix:** Rewrite `parseUIStrings()` to parse `STRING_DEFS` instead of `UI_STRINGS`:

- Match the block: `const STRING_DEFS = {` ... `} satisfies Record<string, StringEntry>;`
- Extract entries with format `'key': { en: 'English text' }` (some have optional `beanie` field — ignore it, only need `en`)
- The `hashString()` function is already correct (matches the runtime hash)

**Multi-language support:**

- `LANGUAGES` config object already exists — extend it to be the single source of truth for all supported languages
- `--all` flag: iterate through every language in `LANGUAGES` and translate each one
- No argument: defaults to `--all` (translate all languages)
- Single language arg: `node scripts/updateTranslations.mjs zh` still works
- Adding a new language = add one entry to `LANGUAGES` + create `npm run translate:<code>` script

**Stale key cleanup:**

- After translating, remove any keys from the JSON that no longer exist in `STRING_DEFS`
- Prevents stale translations from accumulating over time

**CI-friendly output:**

- Print summary at end with counts per language
- Exit 0 when no changes needed (important for CI)
- Non-zero exit on errors

### 2. Run the script to populate `zh.json`

Execute `npm run translate` to fill all 655 translations. Commit the complete `zh.json`.

### 3. Create `.github/workflows/translation-sync.yml`

**Triggers:**

- Scheduled: `cron: '0 3 * * *'` (daily 3 AM UTC — offset from existing 2 AM security scan)
- Manual: `workflow_dispatch` for on-demand runs

**Job 1: `translate`**

1. Checkout code with `persist-credentials: true` and `token: ${{ secrets.GITHUB_TOKEN }}`
2. Setup Node.js 20
3. Configure git user for automated commits
4. Run `node scripts/updateTranslations.mjs --all`
5. Check `git diff --quiet public/translations/` for changes
6. If changed: `git add public/translations/*.json` (only translation files), commit with `chore(i18n): auto-update translations [skip ci]`, push to main
7. Set output `has_changes=true/false`

**Job 2: `deploy` (conditional on `has_changes == 'true'`)**

- Replicates the deploy pattern from `deploy.yml`:
  1. Fresh checkout of main (after translate pushed)
  2. `npm ci` → build (with env secrets) → upload artifact
  3. S3 sync + CloudFront invalidation
- Uses same secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `REGISTRY_API_URL`, `REGISTRY_API_KEY`

**Safeguards:**

- `git add public/translations/*.json` — only translation files touched, nothing else
- `[skip ci]` in commit message prevents main-ci from re-triggering
- Deploy only when translations actually changed
- `concurrency` group prevents overlapping runs

### 4. Update `package.json` scripts

- `"translate": "node scripts/updateTranslations.mjs --all"` (translate all languages)
- `"translate:zh": "node scripts/updateTranslations.mjs zh"` (single language still works)

### 5. Update documentation

**`scripts/README.md`** — Update to reflect:

- Fixed parser (STRING_DEFS format)
- `--all` flag and multi-language support
- Automated daily pipeline via GitHub Actions
- How to add a new language (LANGUAGES config + npm script)

**`docs/adr/008-internationalization.md`** — Update architecture section:

- Add the automated pipeline to the architecture diagram
- Update "Consequences → Negative" to note the first-load delay is now mitigated by pre-populated JSON files
- Reference the GitHub Actions workflow

**`docs/TRANSLATION.md`** (new wiki doc) — Comprehensive guide covering:

- How the translation system works end-to-end (STRING_DEFS → JSON files → SW precache → browser)
- The automated daily pipeline (what it does, when it runs, how to trigger manually)
- How to add a new language (step-by-step)
- How to fix a bad translation (edit JSON directly — hash preserved, won't be overwritten)
- How the hash-based invalidation works
- Troubleshooting (API limits, parsing failures)
- Architecture diagram of the full flow

**`docs/STATUS.md`** — Add entry to Decision Log for the automated translation pipeline

## Files affected

| File                                     | Action                                                       |
| ---------------------------------------- | ------------------------------------------------------------ |
| `scripts/updateTranslations.mjs`         | **Modify** — fix parser, add `--all`, add stale cleanup      |
| `public/translations/zh.json`            | **Modified by script** — populated with all 655 translations |
| `.github/workflows/translation-sync.yml` | **New** — scheduled daily workflow                           |
| `package.json`                           | **Modify** — update `translate` script to use `--all`        |
| `scripts/README.md`                      | **Modify** — update documentation                            |
| `docs/adr/008-internationalization.md`   | **Modify** — update architecture and consequences            |
| `docs/TRANSLATION.md`                    | **New** — comprehensive translation wiki doc                 |
| `docs/STATUS.md`                         | **Modify** — add decision log entry                          |

## Verification

1. `node scripts/updateTranslations.mjs zh` — parses all 655 keys, translates missing ones
2. `node scripts/updateTranslations.mjs --all` — translates all configured languages
3. `public/translations/zh.json` has all 655 keys with matching hashes
4. `npm run build` — succeeds, SW precache includes updated `zh.json`
5. `npx vitest run` — full test suite still passes
6. `npm run type-check` — clean
7. Push to main → verify `translation-sync.yml` workflow appears in Actions tab
8. Manually trigger the workflow → verify it detects "no changes" and skips commit/deploy
9. Deploy to production — translations load instantly (no API fallback)
