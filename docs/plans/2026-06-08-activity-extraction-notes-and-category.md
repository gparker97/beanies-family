# Plan: Richer activity AI extraction — prep-info notes + list-driven category detection

> Date: 2026-06-08
> Related issues: None — direct implementation
> Final plan also to be saved at: `docs/plans/2026-06-08-activity-extraction-notes-and-category.md` (post-approval, per /beanies-plan)

## Context

The event/invitation → activity AI wedge (#133, ADR-030) is live in prod (beta) since 2026-06-07 (gate: `canEditActivities`). greg reported two real problems, both confirmed in code:

1. **Prep info ("what to bring") isn't captured into the activity the way travel captures it into segment notes.** Two stacked causes:
   - The event prompt frames its overflow `description` field as _"a **short** note"_ with **no one-fact-per-line rule** (travel's `notes` instructs _"Write each distinct fact on its own line… never a single run-on paragraph"_).
   - The mapper writes to `prefill.description`, but **ActivityModal never renders `description`** as an editable field — only `notes` is shown, and `notes` lives inside a **collapsed "Add more details" section**. So extracted prep info is invisible and uneditable.
2. **Category detection misses most categories.** A `field_trip` category exists, but the client-side `CATEGORY_KEYWORDS` table covers only ~24 of ~52 ids (the whole School group is absent), and the model's free-text `categoryHint` never matches "learning journey" (the SG term for a field trip). The raw model category signal is never logged, so misses can't be diagnosed.

**Decisions (greg confirmed):** (a) route prep info to the **visible Notes** field; (b) **model picks a category id from the real list**, with the keyword table kept as a fallback. Outcome: AI-prefilled activities arrive complete — prep notes visible & editable, correctly categorized — without manual cleanup.

## Approach

### A. Prompt — all THREE byte-identical copies, bump `PROMPT_VERSION`

Copies: `src/services/ai/extractionPrompt.ts`, `scripts/spikes/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`. The drift test (`extractionPromptDrift.test.ts`) deep-equals `PROMPT_VERSION`, the JSON shapes, required keys, and **`buildMessages(...)` output** across all three.

1. Rewrite `EXTRACTION_JSON_SHAPE.description` meaning → comprehensively capture prep / what-to-bring / dress-code / RSVP / anything a parent, helper, or child needs, **+ "Write each distinct fact on its own line (one per line), never a single run-on paragraph."** Add the same line to the event system message. Key `description` stays in `REQUIRED_KEYS` (only the instruction text changes).
2. Add an **OPTIONAL** key `category` to `EXTRACTION_JSON_SHAPE`: \_"the single best-matching category id from the list below, or '' if none fits; prefer an other\_\_ id in the right group over a wrong specific id."\* Keep `categoryHint` (free text) for fallback + diagnostics. **Do NOT** add `category` to `REQUIRED_KEYS` (backward-compat).
3. Add a hardcoded `CATEGORY_OPTIONS_TEXT` constant (identical in all three copies) and **interpolate it INTO `buildExtractionMessages`** (so the drift test actually guards it — it compares built-message output, not consts by name). One line per group, e.g. `School: after_school (After School Activity), field_trip (Field Trip), school_recital (School Recital / Presentation), other_school (Other School Activity)`. Above the literal, pin the rendering recipe in a comment (groups alphabetical, "Other" last; categories alphabetical, "Other-\*" last — exactly what `getActivityCategoriesGrouped()` produces).

### B. Parse layer — `src/services/ai/extractionPrompt.ts` (shared by both providers via `parseExtractionResult`)

1. Read `obj.category` via `asString`; include on the result **only when non-empty**, copying the exact `...(categoryHint ? { categoryHint } : {})` pattern so a response omitting it is byte-identical to today. Never throws.
2. Add `category?: string` to `ExtractionResult` in `src/services/ai/types.ts`, doc mirroring `categoryHint`.

### C. Mapper — `src/utils/extractionToActivity.ts`

1. **Notes routing:** change `prefill.description = result.description` → `prefill.notes = result.description` (model field stays `description`; it now flows to the visible `notes`).
2. **Validated category, flat precedence:** add a small helper `validatedModelCategory(result)` that looks the id up via the existing `getActivityCategoryById` (O(1) Map — no second Set), returns it when real, and on a present-but-unrecognized id emits **one** `console.warn('[activity-extract] model category id not recognized', { got, hint })` (matches the codebase `[travel-extract]` convention) then returns undefined. `inferActivityCategory` becomes a flat chain: `validatedModelCategory(result) ?? matchCategory(categoryHint) ?? matchCategory(title + description)`. Never throws, never toasts (a soft miss → the user just picks the category, an explicit visible step).
3. **Targeted, collision-free keyword fill (NOT near-parity):** the model list-pick is now primary, so the table is only the "" fallback — keep it shallow. Add the motivating School gaps — `field_trip` ← `/\b(field trip|excursion|learning journey|school outing|school visit)\b/i`, `after_school` ← `/\bafter[- ]school\b/i` — plus a couple of unambiguous extras (`spelling bee`, `cubing`). **Explicitly defer** broad Educational/Lessons/Sports rows (collision-prone with the existing `(game|match|tournament)→sporting_event` and `math` rows). Keep ids typed `ActivityCategory`, specific-before-generic.
4. Update the file-header comment so the "pure/standalone" wording acknowledges the one convention-matching `console.warn`.

### D. ActivityModal — `src/components/planner/ActivityModal.vue` (REQUIRED: route + reveal)

In `applyPrefill` (~:163) add:

```
if (p.notes !== undefined) { notes.value = p.notes; showMoreDetails.value = true; }
```

This both copies the routed notes **and** opens the collapsed "Add more details" section so the prep notes are visible without a manual click. Critical because `onNew()` sets `showMoreDetails = false` (:302) _before_ calling `applyPrefill()` (:305), and the Notes field lives inside `<div v-if="showMoreDetails">` (:1078/:1093). No template change. Leave the existing (now-dead-for-the-wedge but harmless) `p.description` line.

### E. Deploy

Redeploy the `ai-extract` Lambda (terraform) so the managed path uses the new prompt: `plan` with `-var-file` + `-out`, confirm a `source_code_hash`-only change with **0 destroy**, then `apply`. Backward-compatible (new field optional) so the Vue client can ship independently; document the Lambda-before/with-client sequencing in PR/CHANGELOG/STATUS.

## Critical files

- `src/services/ai/extractionPrompt.ts` + `scripts/spikes/extractionPrompt.mjs` + `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — identical prompt changes + `CATEGORY_OPTIONS_TEXT` (interpolated into `buildExtractionMessages`) + recipe comment + `category` parse + version bump
- `src/services/ai/types.ts` — `category?: string`
- `src/utils/extractionToActivity.ts` — notes routing, `validatedModelCategory`, flat precedence, targeted keyword fill
- `src/components/planner/ActivityModal.vue` — `applyPrefill` notes route + reveal
- `src/constants/activityCategories.ts` — read-only source of truth (`getActivityCategoriesGrouped`, `getActivityCategoryById`)

## Reuse (no new generic abstractions)

- `getActivityCategoryById` (Map lookup) for id validation — no second Set.
- `getActivityCategoriesGrouped()` for the sync-test expected literal.
- Travel's one-fact-per-line **philosophy** only — its `buildNotes`/`humanizeFieldKey` are unexported and inapplicable (event returns a single formatted string; nothing to fold). Do **not** import/generalize them.

## Backward-compat & invariants

- `category` optional, never in `REQUIRED_KEYS`; parse output byte-identical when omitted (older Lambda / BYOK / on-device still work via keyword fallback).
- Three prompt copies byte-identical; `PROMPT_VERSION` bumped from `2026-06-06.4`.
- ADR-030 intact — only the static category taxonomy is added to the prompt, never the family roster.
- No new user-visible string (routing reuses the existing `planner.field.notes` field); if any is added, en + beanie + zh.

## Testing / verification

1. **Unit — mapper** (`src/utils/__tests__/extractionToActivity.test.ts`): flip the existing "full timed event" expectation `description:'Bring a gift'` → `notes:'Bring a gift'`; add valid-id-wins, invalid-id-ignored→keyword-fallback (assert `console.warn` via spy), `field_trip` via "learning journey".
2. **Unit — parse:** `category` included when present, omitted when absent, non-string coerced to absent (no throw).
3. **Unit — NEW sync test** (client-only): build the expected literal from `getActivityCategoriesGrouped()` per the pinned recipe and assert it equals the client `CATEGORY_OPTIONS_TEXT` — fails CI if the taxonomy and the prompt list diverge.
4. **Unit — drift test:** no edits; identical three-copy edits + version bump keep it green. Confirm the taxonomy text appears in the compared `buildMessages` output.
5. **Unit — ActivityModal:** prefill with `notes` set → `showMoreDetails` true and Notes textarea visible; prefill without notes → stays collapsed (no spurious expansion).
6. **Manual (dev):** upload a real learning-journey notice with a "what to bring" list → Notes populated one-fact-per-line, "more details" already open, category = Field Trip; force a bad model id → warn fires, keyword fallback still categorizes. Upload a birthday invite → unchanged good behavior.
7. `npm run validate` green.
8. **Post-deploy:** redeploy the Lambda, re-test the managed tier in prod (beta).

## Out of scope (noted)

- Ripping out the vestigial activity `description` field (pre-existing; left saved/loaded). Pre-existing activities with `description` set since 2026-06-07 keep invisible text — possible later surface/migrate follow-up.
- Full ~52-id keyword parity (deliberately deferred; the model list-pick covers it).

## Review Passes (4-pass /beanies-plan discipline)

- **Pass 1 — Draft:** two-goal plan; honored drift guard, backward-compat, ADR-030, Lambda sequencing.
- **Pass 2 — DRY/error-handling:** made the modal `applyPrefill` notes line mandatory (else silent drop); ruled out reusing travel's unexported helpers; reused `getActivityCategoryById`; hard-decided hardcode+sync-test; pinned the parse to the `categoryHint` optional pattern; flagged keyword-ordering collisions + the test that must flip.
- **Pass 3 — Sustainability:** reframed keyword fill to shallow/collision-free; isolated validation+logging into `validatedModelCategory` so `inferActivityCategory` stays flat; switched diagnostic to `console.warn` per convention; pinned the rendering recipe.
- **Pass 4 — Fresh eyes:** found the load-bearing UX bug — Notes sits inside the collapsed "Add more details" section that `onNew` closes before `applyPrefill` runs, so routed notes would be invisible → made reveal-on-prefill mandatory + tested; clarified the taxonomy text must be interpolated into `buildExtractionMessages` for the drift test to guard it; doc-honesty fix for the `console.warn` side-effect. **Verified in code** (:302 false → :305 applyPrefill; field at :1078/:1093).

## Prompt Log

**Initial (verbatim):** "Let's make an update to the activity AI data extraction process - with travel plans, key information is added to the notes/comments section of the travel segment, however we are not doing something similar for the activities segment. For example, a field trip activity might say 'bring a small backpack, a snack, and a water bottle with a sling' - this is key information that we should add to the invite. if there is not a relevant or appropriate field, then as with travel plans, let's also add this information to the activity item, and as with travel plans, propoerly formatted and with newlines as appropriate. The goal is to ensure parents, helpers, kids, etc have all the pertinent information they needs which can be extracted from the invite or document to ensure they have everything prepared for the activity. Also wanted to note that just now I uploaded a document that was titled 'school learning journey to .... <etc>' - to me this sholud be properly categorized as a school - field trip category, however it came back uncategorized. Is it possible to check what the AI category came back as? How can we improve the category detection?"
**Clarifying answers:** category approach = "Model picks from the list + keyword fallback"; notes destination = "Route to the visible Notes field".
