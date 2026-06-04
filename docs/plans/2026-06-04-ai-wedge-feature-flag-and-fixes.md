# Plan: #133 AI wedge — ship behind a dev feature flag + three behaviour fixes

> Date: 2026-06-04
> Related issues: #133 (Private AI capability). Deploy unblocks PR #240 (webhook guards).
> Plan file: `docs/plans/2026-06-04-ai-wedge-feature-flag-and-fixes.md`
>
> **No GitHub issue created.** This plan was approved for direct implementation (work tracked under #133). Full prompt history is embedded below.

## User Story

As greg (developer), I want to ship the existing photo→activity AI wedge to production hidden behind a simple developer feature flag, and fix three rough edges (consent ordering, AI-assisted category, recurrence default), so that deploying `main` through the proper CI workflow ALSO restores the dead Slack/Plausible/error-webhook pipeline — without exposing the unfinished AI feature to users.

## Context

A manual `dev` build was shipped to `app.beanies.family` outside the `Deploy beanies PROD` workflow, so CI env injection never ran — Slack webhooks, `#beanies-errors` reporting, and Plausible analytics were all silently dead. Prod was recovered by deploying `hotfix/deploy-webhook-hardening` (off the pre-AI commit `1fede3d`), so production currently runs **no** #133 AI code (`build_sha adad44ce`).

`main` already holds all #133 AI commits. We want prod back on the `main` lineage — which **also restores the dead Slack/Plausible/error pipeline** — but the AI wedge isn't ready for users. So: deploy `main` through the proper workflow with the AI entry point hidden behind a simple developer feature flag, and fix three rough edges. greg deploys; this plan ends at "ready to deploy."

Built via the `/beanies-plan` 4-pass discipline plus a focused validation pass on the AI-category design (which caught a real regex bug, a module-load side-effect, and a test-invariant conflict — all resolved below).

## Requirements

1. **Dev feature flag** — `src/config/flags.ts` (new). `isFlagEnabled('aiPhotoExtract')` returns the `localStorage` override (`beanies:flag:aiPhotoExtract` = `'true'`/`'false'`) if set, else `import.meta.env.DEV` → dev-on, prod-off. Guarded storage access. Typed `DevFlag` union. `setFlagOverride`/`clearFlagOverride` exported.
2. **Gate the entry point** — optional `canAddFromPhoto?: boolean` prop on `CalendarCommandBar`; the 📸 button renders `v-if="canAddFromPhoto ?? canAdd"`. Page passes `canEditActivities && isFlagEnabled('aiPhotoExtract')`.
3. **Fix 1 — consent before picker** — page `handleAddFromPhoto()` awaits consent then opens the picker; remove the consent responsibility from `useDocumentToActivity`.
4. **Fix 2 — AI-assisted category (hybrid)** — model returns a free-text `categoryHint`; client maps it to our taxonomy via keyword logic, falling back to title/description, then empty. Keyword logic is the backup and serves all tiers. App-first; the `ai-extract` Lambda redeploy (greg) lights up the managed/prod tier later.
5. **Fix 3 — recurrence default one-time** — handled in `ActivityModal.applyPrefill` (photo-only), not the mapper.

## Important Notes & Caveats

- ROOT CAUSE (recurrence): `ActivityModal.onNew` sets `recurrence.value = 'weekly'`; `applyPrefill()` never mapped recurrence/category, so the photo flow inherited weekly. Fix lives in `applyPrefill` (runs only for prefills) → mapper stays pure, the `not.toHaveProperty('recurrence')` mapper-test invariant is preserved, manual adds untouched.
- The `category` watch in ActivityModal auto-sets icon + color when category becomes truthy — do NOT duplicate that in the mapper or `applyPrefill`.
- `categoryHint` is **optional** in the prompt contract (NOT in `REQUIRED_KEYS`) so the currently-deployed Lambda (old prompt, 9 keys) keeps working and the app ships independently of the Lambda redeploy. The Lambda `index.mjs` passes the full parsed model object through (only checks REQUIRED_KEYS present), so the hint flows through once the model returns it.
- `parseExtractionResult` includes the hint only when present + non-empty → existing parse-shape tests stay byte-identical.
- BYOK path uses the client prompt copy locally → it gets the hint immediately, no Lambda dependency. Managed/prod needs the redeploy.
- Removing `requestConsent` from `useDocumentToActivity` changes its interface; the "decline = silent no-op" contract moves to the page handler. Offline guard stays in `processFile` (consent-first means an offline user may pass consent + picker before the offline toast — acceptable, privacy-correct).
- `import.meta.env.DEV` is read at call time inside `isFlagEnabled` → testable via `vi.stubEnv('DEV', …)` with no `resetModules` dance.
- Help Center: feature stays hidden → no article; `PRIVACY_ARTICLE_LIVE` stays `false`.

## Assumptions

1. `main` merges cleanly with PR #240 (disjoint files). No conflict expected.
2. Nothing NEW user-facing reaches users this deploy (AI flag-hidden; restored Slack/Plausible invisible to users) → no user-facing CHANGELOG entry (#133 precedent). greg confirms at deploy.
3. Free-text-hint + client mapping is acceptable; recording unmapped hints to grow the taxonomy is a noted future enhancement.

## Approach

### A. Feature flag — `src/config/flags.ts`

Typed `DevFlag` union; `isFlagEnabled` = override (localStorage `beanies:flag:<name>`) else `import.meta.env.DEV`. All storage access try/caught with `console.warn` + fallback. `setFlagOverride`/`clearFlagOverride` exported. Documented console flip.

### B. Gate the button

`CalendarCommandBar`: optional `canAddFromPhoto?: boolean`; 📸 button `v-if="canAddFromPhoto ?? canAdd"` (the "+" button unchanged). `FamilyPlannerPage`: `canAddFromPhoto = computed(() => canEditActivities.value && isFlagEnabled('aiPhotoExtract'))`, passed as `:can-add-from-photo`.

### C. Fix 1 — consent before picker

`handleAddFromPhoto()` in the page: `await requestPhotoConsent()` → on grant `photoPicker.open()`. Rewire `@add-from-photo`. Drop `requestConsent` from `UseDocumentToActivityOptions` + `processFile`; update comments.

### D. Fix 2 — AI category (hybrid)

- Prompt (3 copies, byte-identical): add `categoryHint` to `EXTRACTION_JSON_SHAPE`; bump `PROMPT_VERSION` to `'2026-06-04.1'`; keep `REQUIRED_KEYS` at 9; parse the hint optionally. `categoryHint?: string` on `ExtractionResult`.
- `extractionToActivity.ts`: exported `CATEGORY_KEYWORDS` (word-bounded grouped-alternation regex → `ActivityCategory`), `matchCategory(text)`, `inferActivityCategory(result)` = hint first, else title/description, else undefined. `extractionToActivityPrefill` sets `prefill.category` when matched. No module-load side-effect; id validity covered by the tuple type + a unit-test invariant.

### E. Fix 3 — recurrence in applyPrefill

`recurrence.value = p.recurrence ?? 'none'` and `if (p.category) category.value = p.category` inside `applyPrefill()`.

### F. Deploy / back-on-track (greg triggers)

Merge PR #240 → greg runs `Deploy beanies PROD` on `main` → verify bundle (Slack/build_sha/Plausible). Lambda redeploy deferred (greg). No user-facing CHANGELOG.

## Files Affected

- `src/config/flags.ts` (new) + `src/config/flags.test.ts` (new — co-located like `features.test.ts`)
- `src/components/planner/CalendarCommandBar.vue`
- `src/pages/FamilyPlannerPage.vue`
- `src/composables/useDocumentToActivity.ts` (+ `__tests__/useDocumentToActivity.test.ts`)
- `src/services/ai/extractionPrompt.ts` + `scripts/spikes/extractionPrompt.mjs` + `infrastructure/lambda/ai-extract/extractionPrompt.mjs`
- `src/services/ai/types.ts`
- `src/utils/extractionToActivity.ts` (+ `__tests__/extractionToActivity.test.ts`)
- `src/components/planner/ActivityModal.vue`

## Acceptance Criteria

- [ ] Flag OFF (prod default) → 📸 button absent, wedge unreachable.
- [ ] Flag ON → 📸 → consent FIRST → on grant picker opens → on decline nothing (no picker/network/toast).
- [ ] Photo-extracted activity opens with recurrence = one-time and (when inferred) the right category + icon/color; unmatched category empty.
- [ ] Manual "+" add still defaults weekly + empty category (no prefill leak).
- [ ] Old deployed Lambda keeps working (categoryHint optional); BYOK gets the hint immediately.
- [ ] No silent failures (storage-disabled → env default + warn; bad keyword id → tsc/test fails).
- [ ] `npm run validate` green.
- [ ] After greg's deploy: bundle has Slack webhooks + real build_sha + Plausible; app root 200.

## Testing Plan

1. `flags.test.ts`: dev/prod defaults via `vi.stubEnv('DEV', …)`; overrides; unrecognised → env default; getItem throws → env default + warn; set/clear round-trip.
2. `extractionToActivity.test.ts`: hint-first mapping; title/desc fallback; grouped-alternation ("bat mitzvah" → `bar_mitzvah`); no-match → category absent + `not.toHaveProperty('recurrence')` holds; invariant: every `CATEGORY_KEYWORDS` id ∈ `ACTIVITY_CATEGORIES`.
3. `extractionPromptDrift.test.ts` green (3 copies identical).
4. `useDocumentToActivity.test.ts`: in-flight/offline guards, extract → onActivityReady, isEvent=false toast, failures; consent-decline test removed.
5. Manual dev pass.

## Review Passes

- Pass 1 (Initial draft): flag + button gating + 3 fixes + deploy/back-on-track, grounded in code (recurrence root cause).
- Pass 2 (DRY / error-handling): data-driven category table; guarded localStorage with env-default fallback + warning; consent-decline contract moved to the page; icon/color stay on the existing watch; v-if scoped to 📸; corrected category ids.
- Pass 3 (Sustainability): removed module-load DEV side-effect (→ unit-test invariant); fixed `\b`-only-first-alternative regex bug (grouped alternation + `i`); clarified type-vs-test id-safety; corrected test path; flagged stale JSDoc.
- Pass 4 (Fresh-eyes): verified `import.meta.env.DEV` mockability (call-time read, no resetModules); reviewed offline-vs-consent ordering (acceptable); verified no recurrence/category leak into manual adds.
- Post-approval revision (greg chose hybrid AI category + app-first): switched Fix 2 from deterministic-only to AI free-text hint → client mapping (keyword backup, all tiers); a focused validation pass confirmed the optional-field/drift/Lambda-tolerance design and caught that `prefill.recurrence='none'` would break the mapper's `not.toHaveProperty('recurrence')` invariant → moved Fix 3 to `applyPrefill` (mapper stays pure).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial context (good-morning ritual)

greg ran `/good-morning`; session sync surfaced the webhook outage + hotfix state.

### Prompt 1 (the task)

> Note that this morning we identified an issue where the slack key/variables were not present in the deploy bundle, meaning that somehow a manual deploy was done which did not go through the usual workflow. Due to this it seems we've missed slack messages (all slack triggers not working) and no plausible data was coming through.
>
> In another session claude pushed some hardening fixes and we deployed again, but since we are not ready to push the AI stuff yet, I _believe_ that he created a hotfix branch without the AI commits and deployed that, but I'm not fully sure, pls check what was done so you are aware of the current status. there should be a PR created that can deploy the hotfix back to main and get us back on track once ready to deploy the AI stuff.
>
> what i would like to do today is push a few (somewhat minor) fixes to the AI functionality (such as moving the confirmation prompt before the file picker, adding some functionalty such as selecting the activity category automatically based on the activity details, etc) and then push to prod, but hide the functiojlaity in the UI behind a feature flag. we do not need to implement a sophisticated feature flag system, just something very simple to use when we are developing features but do not want them exposed to users yet.
>
> Pls take note and ensure you are up to date on the latest state of the repo and activities.

### Clarifying answers

- Flag default: **Dev-on, prod-off + localStorage override**.
- Fix scope: consent-before-picker + auto-category + (added) recurrence default one-time (photo events should default to one-time, not recurring).

### Prompt 2 (in plan mode)

> show me the plan in plan mode

### Prompt 3 (AI vs logic for category)

> Regarding the auto-category selection - are we using AI to determine the category, or logic/deterministic category selection? I would like to use AI, but if we are also using logic in the code, we can keep that as a backup

### Clarifying answers (AI category)

- AI approach: **hybrid** — AI returns a free-text hint, code maps it to our taxonomy (mapping applies even for non-AI users); future enhancement: record AI-suggested categories that don't map, to grow the category list.
- Lambda sequencing: **app first, Lambda when ready**.

</details>
