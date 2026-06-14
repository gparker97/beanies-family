# Plan: Activity Category Taxonomy Expansion (Fun rename + Work/Pets/Social/Religious groups + new items)

> Date: 2026-06-14
> Related issues: None — direct implementation (greg, in-session)
> Plan file: `docs/plans/2026-06-14-activity-category-taxonomy-expansion.md`

## User Story

As a family using the planner, I want a richer, better-organized set of activity categories — a "Fun" bucket (not just "Entertainment"), plus Work, Pets, Social, and Religious groupings and several missing everyday items — so I can categorize real family life (pool trips, work dinners, vet visits, date nights, worship) accurately, and the photo/document AI can auto-assign those categories.

## Context

`src/constants/activityCategories.ts` is the **single source of truth** for the activity taxonomy: a flat `ACTIVITY_CATEGORIES` array of `{ id, name, emoji, color, group }`, from which all emoji/color/group maps and the grouped picker are derived. greg wants to (1) rename the "Entertainment" group to "Fun" and broaden it, (2) add four new groups (Work, Pets, Social, Religious), and (3) fill gaps in Sports, Lessons, Party, Appointments, and Competitions.

The taxonomy has **four downstream couplings enforced by tests** — all must move together or CI fails:

1. **`ActivityCategory` string-literal union** (`src/types/models.ts:404`). A sync test (`src/constants/__tests__/activityCategories.test.ts`) asserts every `ACTIVITY_CATEGORIES` id is in the union and vice-versa. (The test header notes a past ship that "missed the type union" — this is the exact trap.)
2. **`activityCategoryToExpenseCategory(...)` map** (`src/constants/categories.ts:753`). A sync test asserts every category id has an expense-category mapping and every mapping key is a real category. Activities with a fee/cost project into the expense ledger via this map (`activityStore.ts:395`).
3. **AI extraction taxonomy `CATEGORY_OPTIONS_TEXT`**, hardcoded **byte-identical in three copies**: client `src/services/ai/extractionPrompt.ts`, spike `scripts/spikes/extractionPrompt.mjs`, Lambda `infrastructure/lambda/ai-extract/extractionPrompt.mjs`. Two tests guard it: `extractionPromptCategory.test.ts` (client copy must equal `getActivityCategoriesGrouped()` rendering) and `extractionPromptDrift.test.ts` (`PROMPT_VERSION` + built messages identical across all three copies).
4. **`ACTIVITY_GROUP_EMOJI_MAP`** (same file) — keyed by group name; the picker falls back to 📌 if a group is missing.

### Key discovery — the `planner.category.*` / `planner.group.*` i18n keys are orphaned

The 48 `planner.category.*` / `planner.group.*` entries in `uiStrings.ts` are **not consumed anywhere**. Every surface that displays a category/group name reads it **straight from the constant**:

- `ActivityCategoryPicker.vue` uses `g.name` / `cat.name`, lowercasing for beanie mode (`isBeanieMode ? name.toLowerCase() : name`).
- `getActivityCategoryName(id)` (constant lookup) is used by `OnboardingActivity.vue`, `ActivityViewEditModal.vue`, `FamilyPlannerPage.vue`, again `.toLowerCase()`'d for beanie.
- A grep for `t('planner.category.…')` / ``t(`planner.category.${…}`)`` / `planner.group.` dynamic lookups returns **zero** runtime consumers.

**Consequence:** new categories need **no** i18n keys to display correctly in English or beanie mode. Chinese (zh) does **not** translate category names today (the picker shows English regardless of locale) — that is pre-existing behavior, not a regression this plan introduces. We will **not** add 35 new dead keys (that would be DRY-violating cargo-culting). The English name + beanie lowercasing come entirely from the constant. See Assumptions for the flagged decision on the orphaned keys / zh gap.

## Requirements

### Group rename

1. Rename group **"Entertainment" → "Fun"** across `ACTIVITY_CATEGORIES` (all 8 current members' `group` field), the `ACTIVITY_GROUP_EMOJI_MAP` key (`Entertainment: '🎬'` → `Fun: '🎈'`), and the AI taxonomy line label. The 7 specific items keep their ids and names (movie, show, concert, theme_park, sporting_event, museum, festival). The catch-all id `other_entertainment` keeps its **id** (persisted) but its **name** → "Other Fun Thing" and **group** → "Fun".

### New items (all NEW ids — additive, never reusing an existing id)

2. **Fun** (+6): `beach` (Beach 🏖️), `pool` (Pool / Swim 🏊 — recreational; intentionally distinct from the Lessons `swimming` lesson), `playground` (Playground / Park 🛝), `zoo` (Zoo / Aquarium 🦁), `bowling` (Bowling 🎳), `arcade` (Arcade 🕹️).
3. **Work** (new group, header 💼): `work_dinner` (Work Dinner 🍽️), `work_drinks` (Work Drinks 🍻), `team_building` (Team Building / Outing 🤝), `conference` (Conference 🎤), `work_party` (Office Party 🎊), `networking` (Networking 🧑‍💼), `other_work` (Other Work 🏢).
4. **Pets** (new group, header 🐾): `vet` (Vet 🩺), `pet_grooming` (Grooming ✂️), `other_pet` (Other Pet 🐾).
5. **Social** (new group, header 🧑‍🤝‍🧑): `date_night` (Date Night 💑), `playdate` (Playdate 🧒), `family_visit` (Family Visit 👵), `other_social` (Other Social 🧑‍🤝‍🧑).
6. **Religious** (new group, header ⛪): `worship` (Worship / Service 🙏), `religious_class` (Religious Class 📿), `other_religious` (Other Religious ⛪).
7. **Sports** (+1): `basketball` (Basketball 🏀).
8. **Lessons** (+4): `chess` (Chess ♟️), `coding` (Coding / Robotics 🤖), `voice` (Singing / Voice 🎤), `drama` (Drama / Acting 🎭).
9. **Party** (+3): `graduation` (Graduation 🎓), `baby_shower` (Baby Shower 🍼), `anniversary` (Anniversary 💍).
10. **Appointments** (+1): `therapy` (Therapy 🛋️).
11. **Competitions** (+3): `swimming_competition` (Swimming Competition 🏊), `track_field` (Track & Field 🏃), `gymnastics_competition` (Gymnastics Competition 🤸).

### Coupled updates (each is test-enforced)

12. Add all 35 new ids to the `ActivityCategory` union in `models.ts`.
13. Add all 35 new ids to `activityCategoryToExpenseCategory` (mapping table below).
14. Regenerate `CATEGORY_OPTIONS_TEXT` in **all three** prompt copies, byte-identical, and bump `PROMPT_VERSION`.
15. Add the 4 new group headers to `ACTIVITY_GROUP_EMOJI_MAP` and rename Entertainment→Fun there.
16. Assign each new item a `color` (palette below); verify ordering invariants still hold.

### Proposed expense-category mapping (Requirement 13)

Every target below is a real `EXPENSE_CATEGORIES` id (verified against `categories.ts`). Rationale follows existing patterns (e.g. all current Party items → `entertainment`).

| New id                                                        | → expense category | Note                                                                                                             |
| ------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| beach, pool, playground, zoo, bowling, arcade                 | `entertainment`    | matches existing Fun items                                                                                       |
| work_dinner, work_drinks                                      | `dining_out`       | food/drink spend                                                                                                 |
| team_building, conference, networking, work_party, other_work | `other_expense`    | no "work/business" expense category exists; neutral bucket                                                       |
| vet, pet_grooming, other_pet                                  | `pets`             | dedicated category exists                                                                                        |
| date_night                                                    | `entertainment`    |                                                                                                                  |
| playdate, other_social                                        | `other_personal`   |                                                                                                                  |
| family_visit                                                  | `other_family`     | dedicated category exists                                                                                        |
| worship, other_religious                                      | `other_charity`    | tithe/donation context                                                                                           |
| religious_class                                               | `other_education`  | it is a class                                                                                                    |
| chess, coding, drama                                          | `other_lessons`    | no tech/games lesson category                                                                                    |
| voice                                                         | `music_lessons`    | vocal training                                                                                                   |
| graduation, baby_shower, anniversary                          | `entertainment`    | matches existing Party items                                                                                     |
| therapy                                                       | `healthcare`       |                                                                                                                  |
| swimming_competition, track_field, gymnastics_competition     | `other_sports`     | **diverges** from existing academic competitions (`other_education`) because these are sports — flagged for greg |

### Proposed colors (Requirement 16)

Existing hue families: Appointments=reds, Competitions=ambers, Educational=purples, Fun(was Entertainment)=pinks/roses, Food=cyans/teals, Party=heritage-orange/amber, Lessons=blues/indigos, School=blues, Sports=greens, Other=gray. New items within an existing group take an unused shade from that group's family. The four NEW groups need fresh families; the wheel is nearly full, so exact uniqueness is impossible — the **group emoji + label carry identity, color is secondary**. Proposed:

- **Work** → slate/neutral (`#475569`, `#334155`, `#64748B`, `#1E293B`, `#0F172A`, `#94A3B8`, `#52525B`). Distinct (neutral) from all saturated families; mild proximity to brand Deep Slate — acceptable on chips.
- **Pets** → warm orange/terracotta (`#EA580C`, `#C2410C`, `#9A3412`). ⚠️ proximity to Party's heritage-orange — distant in the list, distinct emoji; verify in QA or shift Pets toward brown if it reads too close.
- **Social** → fuchsia (`#C026D3`, `#A21CAF`, `#86198F`, `#D946EF`). ⚠️ proximity to Fun's pink/magenta — verify; nudge toward violet if needed.
- **Religious** → indigo (`#4F46E5`, `#4338CA`, `#6366F1`). ⚠️ proximity to Lessons blue / Educational purple — verify.

New-item shades within existing groups (proposed, all unused within the group): Fun — beach `#F9A8D4`, pool `#FB7185`, playground `#FDA4AF`, zoo `#FB6F92`, bowling `#C2185B`, arcade `#AD1457`; Sports basketball `#15803D`-adjacent unused green e.g. `#65A30D`(lime) or `#84CC16` — pick an unused green; Lessons chess `#6366F1`/coding `#818CF8`/voice `#A5B4FC`/drama `#C7D2FE` (unused indigos); Party graduation/baby_shower/anniversary — unused ambers `#FBBF24`/`#FCD34D`/`#FB923C`; Appointments therapy — unused red `#FCA5A5`; Competitions swimming_competition/track_field/gymnastics_competition — unused ambers `#FBBF24`/`#FDE68A`/`#FCD34D`. **These are starting points; the implementer picks final hex values, asserting no exact duplicate within a group (see Testing).**

## Important Notes & Caveats

- **NEVER change an existing id.** Ids are persisted on activity records (Automerge). Renames touch `name`/`group` only. `other_entertainment` is the canonical example: id frozen, name+group change. Reusing an id for a different concept would silently re-label historical activities.
- **All three prompt copies must stay byte-identical** and `PROMPT_VERSION` must bump in all three, or `extractionPromptDrift.test.ts` fails. The `.mjs` copies cannot `import` the taxonomy — they are hand-maintained literals. Generate the new `CATEGORY_OPTIONS_TEXT` once from `getActivityCategoriesGrouped()` and paste the identical block into all three.
- **Do not add `planner.category.*` / `planner.group.*` i18n keys** for the new ids — they are orphaned (see Context). Adding them is dead code. (Optionally rename the existing `planner.group.entertainment` value, but since it is unread, leave it untouched to keep the diff minimal — or delete the whole orphaned block as a _separate_ cleanup, out of scope here.)
- **Group ordering is derived, not manual.** `getActivityCategoriesGrouped()` sorts groups alphabetically with `Other` forced last, and items within a group alphabetically with `Other *` last. New groups Fun, Pets, Religious, Social, Work slot in alphabetically automatically — no ordering code changes. Verify the AI taxonomy regeneration reflects the new alphabetical order (Appointments, Competitions, Educational, Fun, Lessons, Party, Pets, Religious, School, Social, Sports, Work, Other).
- **Preserve the file's array layout convention.** Although array order is cosmetic (helpers sort at runtime), append the 35 new defs following the existing "one comment block per group, members alphabetical, `Other *` last" arrangement, and slot the new group blocks alphabetically. This keeps the source readable as the taxonomy grows; do not append new entries in an ad-hoc order.
- **Keep `activityCategoryToExpenseCategory` a single flat map.** At ~105 entries it stays greppable and the sync test guards completeness. Do not refactor it into nested per-group sub-objects or derive it from the taxonomy — the expense category is an independent concern, and nesting would add coupling for no gain.
- **Emoji reuse across groups is fine** (different ids): 🏊 appears on Lessons `swimming`, Fun `pool`, and Competitions `swimming_competition`; 🎭 on Fun `show`, School `school_recital`, Lessons `drama`; 🩺 on Appointments `doctor` and Pets `vet`. These are independent ids — acceptable.
- **Keyword-inference collision: new Party id `graduation`.** `CATEGORY_KEYWORDS` in `src/utils/extractionToActivity.ts:34` already maps the word "graduation" → `school_recital` (it sits in the `(recital|graduation|ceremony|presentation)` alternation). The model's direct list-pick runs first (`validatedModelCategory`), so a model that returns `category: 'graduation'` resolves correctly; the collision only bites the fallback path (no model id, free text says "graduation" — older proxy / BYOK / on-device), which will infer `school_recital`, not the new `graduation` id. This is a **deliberate, accepted** behaviour for this plan (the keyword table is an intentionally shallow backstop and the list-pick is primary) — we do **not** retune it here. Flagged so it is a conscious decision, not a silent inconsistency. (To change it later: pull `graduation` out of the `school_recital` alternation and add a `\bgraduation\b → 'graduation'` rule _above_ the `school_recital` rule.) No other new id collides with the keyword table (verified).
- **`other_entertainment` expense mapping** currently → `other_entertainment` (expense id). It stays (id unchanged), so no expense-map change for it.
- **`vacation.activityCategory.*`** is a **separate** taxonomy (`VacationActivityCategory` union, `models.ts:762`) for the travel feature. Out of scope — do not touch.

## Assumptions

> Review before implementation.

1. **~~Orphaned i18n keys stay orphaned.~~ SUPERSEDED 2026-06-14 — greg: "all categories should be translated to Chinese as needed."** Chinese category/group translation is now **in scope** (see "Phase 2: Chinese translation" in Approach). Design: route category + group display through `t('planner.category.<id>')` / `t('planner.group.<slug>')`, ensure **every** category id (95) and group has a key (en = constant `name`, beanie = `name` lowercased — preserving today's exact beanie behavior, **not** adopting the existing unused cutesy "X beans" group values), run `npm run translate` to generate zh, and add a sync test that every category id + group has a key whose `en` mirrors the constant. A new composable centralizes label resolution with a constant-name fallback. Shipped as a **second commit** after the core taxonomy so each diff stays reviewable.
2. The four new groups are top-level peers of existing groups (greg specified them as groups), each with its own `other_*` catch-all (matching every existing group and the AI prompt's "prefer an `other_*` id in the right group" guidance).
3. Sports-flavored competitions mapping to `other_sports` (not `other_education` like academic competitions) is acceptable. **Flagged** — trivial to switch to `other_education` for consistency if greg prefers.
4. No component hardcodes the "Entertainment" group string or an out-of-band category list; all derive from the constant (verified by grep during implementation — see Acceptance).
5. The picker/`GroupedChipPicker` renders arbitrarily many groups/items without layout breakage at ~14 groups / ~95 items (visual QA confirms).
6. **Client prompt copy stays a hand-maintained literal (for now).** The client `CATEGORY_OPTIONS_TEXT` in `extractionPrompt.ts` _could_ be derived from `getActivityCategoriesGrouped()` (the generator already lives in `extractionPromptCategory.test.ts`), which would reduce the hand-maintained prompt copies from three to two and make the client copy self-healing. This plan keeps it a literal to stay a pure data change; deriving it is a flagged optional follow-up. **Flagged for greg.**

## Approach

1. **`src/constants/activityCategories.ts`** — the hub:
   - Change `group: 'Entertainment'` → `'Fun'` on the 8 existing members; rename `other_entertainment`'s `name` → "Other Fun Thing".
   - Append the 35 new `ActivityCategoryDef` entries (grouped in the array by their group for readability; the helpers sort at runtime so array order is cosmetic — but follow the file's existing "grouped, Other last" arrangement convention).
   - `ACTIVITY_GROUP_EMOJI_MAP`: rename `Entertainment` key → `Fun: '🎈'`; add `Work: '💼'`, `Pets: '🐾'`, `Social: '🧑‍🤝‍🧑'`, `Religious: '⛪'`. (Map literal order is cosmetic.)
2. **`src/types/models.ts`** — add the 35 new ids to the `ActivityCategory` union (keep the file's formatting; the sync test parses the union via regex `/\|\s*'([^']+)'/`, so keep each id on its own `| 'id'` line). Rename the existing `// Entertainment` comment header above that union block to `// Fun`, and add `// Work`, `// Pets`, `// Social`, `// Religious` headers for the new groups (comments are cosmetic — the regex ignores them — but keep them consistent with the constant so a future grep for "Entertainment" comes back clean).
3. **`src/constants/categories.ts`** — add the 35 new ids to the `activityCategoryToExpenseCategory` mapping object (table above).
4. **AI taxonomy (3 copies)** — regenerate `CATEGORY_OPTIONS_TEXT` from the new grouped taxonomy (one line per group, `id (Name)`, groups alphabetical with Other last), paste identical into all three copies, bump `PROMPT_VERSION` (e.g. `'2026-06-14.1'`) in all three.
5. **Tests** — update `activityCategories.test.ts` expectations (any hardcoded counts/group lists), run the two AI prompt guard tests (they pass automatically once copies are in sync), and scan `extractionToActivity.test.ts` for hardcoded category assumptions.
6. **i18n** — run `npm run translate` only if any `uiStrings.ts` value actually changed (it won't, given we add no keys) — so likely a no-op; confirm parser unaffected.
7. **Verify** — `npm run validate`; manual visual QA of the picker (all groups render, ordering correct, colors legible light/dark) and a quick beanie-mode pass (lowercased names).

### DRY / reuse confirmation

- All display/ordering logic already lives in `getActivityCategoriesGrouped()` + the derived maps — **reused as-is, nothing duplicated.** The change is pure data plus three hand-maintained mirror literals (the `.mjs` copies, which structurally cannot import — the drift test is the guardrail that keeps them honest).
- No new component, composable, or helper is introduced. The picker, onboarding, and modals already derive from the constant and need **zero** edits.

## Files Affected

- `src/constants/activityCategories.ts` — rename group + 35 new defs + group-emoji map (modify)
- `src/types/models.ts` — `ActivityCategory` union += 35 ids (modify)
- `src/constants/categories.ts` — `activityCategoryToExpenseCategory` += 35 ids (modify)
- `src/services/ai/extractionPrompt.ts` — `CATEGORY_OPTIONS_TEXT` + `PROMPT_VERSION` (modify)
- `scripts/spikes/extractionPrompt.mjs` — same literal + `PROMPT_VERSION` (modify)
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — same literal + `PROMPT_VERSION` (modify)
- `src/constants/__tests__/activityCategories.test.ts` — update expectations if any hardcoded counts/lists (modify)
- `CHANGELOG.md` — user-facing "Added/Changed" entry (modify)

No new files. No migration files (see Data Safety).

## Data Safety (no migration)

No migration is required. Category **ids are the persisted key**; every existing id is preserved. The Entertainment→Fun change touches only the display `name`/`group` fields (not stored on activities — activities store the category **id**, and group is derived at render time via `ACTIVITY_GROUP_MAP`). Historical activities keep working: an activity with `category: 'other_entertainment'` now renders under "Fun" as "Other Fun Thing" with no data change. All 35 additions are new ids that no existing record references. Confirmed there is no code path that persists or matches on a group **name** rather than a category id.

## Acceptance Criteria

- [ ] "Entertainment" group renders as "Fun" 🎈 everywhere (picker, onboarding, modals, list cards); `other_entertainment` shows "Other Fun Thing"; its id is unchanged in the constant.
- [ ] All 35 new categories appear in the picker under the correct (alphabetically-sorted) groups, with `Other *` last in each group and the `Other` group last overall.
- [ ] `ActivityCategory` union, `activityCategoryToExpenseCategory`, and `ACTIVITY_CATEGORIES` are mutually in sync (the two sync tests pass).
- [ ] `CATEGORY_OPTIONS_TEXT` is identical across all three prompt copies; `PROMPT_VERSION` bumped in all three; both AI prompt guard tests pass.
- [ ] Each new item has a color that is not an exact duplicate of another item **within the same group**; new-group palettes verified legible in light + dark.
- [ ] No new `planner.category.*`/`planner.group.*` keys were added; a repo-wide grep for `Entertainment` returns **no stale references** — the rename covers the 8 `group:` fields, the `ACTIVITY_GROUP_EMOJI_MAP` key, the `// Entertainment` union comment header, and the AI taxonomy line label (the `other_entertainment` **id** and the `other_entertainment` **expense id** legitimately remain and are expected). No component hardcodes "Entertainment" or an out-of-band category list.
- [ ] A photo/document extraction can return a new category id (e.g. `work_dinner`) and it maps to an activity correctly (spot-check via the extraction-to-activity path).
- [ ] `npm run validate` green; CHANGELOG updated.

## Testing Plan

1. **Unit/sync (automated):** `npm run validate` runs `activityCategories.test.ts` (union ↔ array ↔ expense-map sync), `extractionPromptCategory.test.ts` (client taxonomy == grouped rendering), `extractionPromptDrift.test.ts` (3-copy `PROMPT_VERSION` + message parity). Update any hardcoded count assertions in `activityCategories.test.ts`.
2. **Add two guards** to the existing `activityCategories.test.ts` (reuse the file; do not create a new one), closing the only silent-failure gaps in this change:
   - **No within-group color collision** — assert no two items in the same group share an exact `color` (cheap regression net for the expanded palette).
   - **Group-emoji-map completeness** — assert every group present in `ACTIVITY_CATEGORIES` has a key in `ACTIVITY_GROUP_EMOJI_MAP` (and no orphan keys). Today this map is **not** test-covered, so a new group whose key is forgotten (we add 4: Fun-rename, Work, Pets, Social, Religious) would **silently** fall back to 📌 in the picker (`ACTIVITY_GROUP_EMOJI_MAP[g.name] || '📌'` in `ActivityCategoryPicker.vue`). This guard turns that silent degradation into a CI failure with a clear message.
3. **Manual visual QA:** open the planner Activity picker — confirm all 14 groups, alphabetical order, `Other` last, new emojis/colors legible in light **and** dark; toggle **beanie mode** and confirm names lowercase correctly (constant-driven). Edit an existing `other_entertainment` activity → shows "Other Fun Thing" under "Fun".
4. **AI spot-check:** run an extraction (or unit-feed a model response with `category: 'vet'` / `work_dinner`) through `extractionToActivity` and confirm the category survives and the expense projection resolves.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted full plan grounded in code reconnaissance — caught the `ActivityCategory` union + `activityCategoryToExpenseCategory` couplings, the 3-copy `PROMPT_VERSION` drift guard, and the orphaned-i18n-keys discovery (no new keys needed); proposed expense mappings + color palette with collision flags.
- **Pass 2 (DRY + error handling)**: Verified all DRY/reuse claims against the code (derived maps + `getActivityCategoriesGrouped()` reused as-is; no new component/composable/helper; the 3 `.mjs` prompt copies are a runtime necessity guarded by the drift test; `extractionToActivity` already validates the model's category id and logs unknowns via `console.warn`; `parseExtractionResult` throws on malformed output) — no duplication to remove. Closed the one genuine silent-failure gap: `ACTIVITY_GROUP_EMOJI_MAP` is untested, so a forgotten new-group key would silently render 📌 — added a group-emoji-map completeness guard to the Testing Plan (alongside the within-group color-collision guard) so the picker can't degrade silently.
- **Pass 3 (Sustainability)**: Verified all structures stay flat (no new nesting/coupling) — pure data into existing arrays/maps, all display/ordering logic reused. Flagged that the _client_ `CATEGORY_OPTIONS_TEXT` can be derived from `getActivityCategoriesGrouped()` (cutting hand-maintained prompt copies 3→2) as an optional follow-up (Assumption 6); added an explicit "preserve grouped/Other-last array layout" maintainability requirement; affirmed the flat expense map should stay flat (do not nest).
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every coupling against the code — the two sync-test regexes (`/\|\s*'([^']+)'/` for the union, `/^\s*([a-z_]+):\s*'/` for the expense map) accept all 35 lowercase/underscore ids; every proposed expense target id is a real `EXPENSE_CATEGORIES` entry; the drift guard + `getActivityCategoriesGrouped()` regeneration recipe are exact; `extractionToActivity` validates unknown model ids and falls back, so new ids flow through safely. Caught one missed coupling: the new Party id `graduation` collides with the existing `CATEGORY_KEYWORDS` "graduation" → `school_recital` rule on the fallback (no-model-id) path — documented as deliberate, accepted behaviour (list-pick is primary) in Important Notes. Added union comment-header rename and tightened the "Entertainment" grep acceptance criterion. No DRY/robustness gaps remain; plan is ready to implement.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> i'd like to make some adjustments to the activity categories:
>
> - i think we should rename the "entertainment" high level category to "fun" and add other fun events, such as swimming (swimming already exists under swimming lessons, but things like pool trips, beach, etc should be under fun. we should also change "other entertainment" to "other fun thing"
> - let's add a work category, to capture work-related activities - for example a work dinner, work drinks, work outing / teambuilding, etc - can you suggest some items we could put there?
> - any other categories or types of activities you think are still missing?

### Follow-up 1

> good point, add all the high confidence omissions, as well as the below medium confidence:
>
> - religious (worship / service, religious class)
> - lessons - add chess, coding, voice, drama (we already have music to handle others)
> - party: add graduation, baby shower, anniversary
> - appointments: add therapy
> - competitions: add swimming competition, track and field, gymnastics competition

</details>
