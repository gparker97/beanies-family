# Plan: Re-fetch a recipe from its source, and stop leaving the times blank

> Date: 2026-09-07
> Related issues: None on GitHub — direct implementation. Notion tracker row **#93** (`3d4247d9-a99f-81ff-abda-e91cb8ed1242`)
> Plan file: `docs/plans/2026-09-07-recipe-refetch-and-times.md`
> Mockup: `docs/mockups/recipe-refetch-2026-09-07.html` (Direction B chosen for the review step)

> **No GitHub issue created.** Approved for direct implementation.

## User Story

As someone whose captured recipe came out wrong or thin, I want to ask beanies to read the
source again, so that I can pick up a better extraction or a new photo without re-adding
the recipe from scratch.

## Context

Two capture-quality gaps, related because both live on the same ladder.

**The times.** Prep, cook and servings come back empty far more often than they should, and
the reason is not a missing field. The prompt already asks for all three, the content-fetch
lambda already parses them deterministically out of `schema.org/Recipe` JSON-LD, and the
client already maps them through. They are empty because the system prompt forbids emitting
a time the source does not state, while the `inferred` escape hatch — which lets the model
supply an uncertain value and _declare_ it — exists only for ingredients and steps. For
these three the model can only copy verbatim or return `""`, so it returns `""`. It is
compounded by the JSON-LD ambiguity check, which deliberately falls through to the model
whenever a page describes several dishes, i.e. on most recipe-blog roundups.

**The re-fetch.** A captured recipe is frozen at the moment it was read, with no way to ask
beanies to look again.

## Requirements

1. Prep, cook and servings carry a value whenever the source states one **or** the model
   can reasonably infer it, with an inferred value **visibly marked**.
2. The no-guessing rule for ingredient quantities is **unchanged**. Only these three fields
   gain the ability to be inferred, and only when declared.
3. A re-fetch affordance on the recipe, present **only** when the recipe has a `sourceUrl`.
4. Re-fetch shows **what changed, old beside new**, and writes nothing until the user takes
   it. A hand-edited recipe never loses edits silently.
5. A re-fetch that finds nothing new says so, rather than showing an empty diff.
6. A new dish photo is **added alongside** the existing one, never replacing it.
7. Re-fetch is bounded: pressing it repeatedly must not be free.
8. All new user-visible text via `t()` with both `en` and `beanie`.

## Important Notes & Caveats

- **⚠️ The extraction prompt exists THREE times, not two, and a test enforces parity across
  all of them.** `scripts/spikes/extractionPrompt.mjs`,
  `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, and
  `src/services/ai/extractionPrompt.ts`. `extractionPromptDrift.test.ts:7-13` imports
  **client, spike AND server** and asserts `jsonShape` equality spike-to-client and
  spike-to-server, plus `buildMessages` output equality for every task and every source
  fixture. Changing only two copies fails CI. Every copy's header also says "bump
  `PROMPT_VERSION` on ANY change" (currently `'2026-09-04.1'`) — and because the test asserts
  only _equality_, a missed bump passes silently, which is exactly the failure this plan must
  not make.
- **The share task inherits the change for free.** `buildShareExtractionMessages`
  interpolates `RECIPE_JSON_SHAPE` verbatim and `parseShareExtractionResult` delegates to
  `parseRecipeExtractionResult`. No second parser and no second shape — that composition is
  deliberate and must not be worked around.
- **Do not weaken the general no-guessing rule.** _"Never output a quantity, temperature or
  time that is not actually supported by the source"_ is what stops the model inventing
  "1 tsp salt" from "a shake of salt". The change is a **narrow carve-out** for three named
  fields, conditional on declaring the inference.
- **Enum validation goes in the MAPPER, never the parser.** `recipeExtractionToRecipe.ts:66-67`
  states the rule outright, and `validatedTaxonomy` is the pattern: the parser returns raw
  strings, the mapper filters with a type guard, records the rejection **and** `console.warn`s
  developer guidance. A parser-side filter would be both a layering violation and a silent drop.
- **The JSON-LD path must never report an inferred time,** and that guarantee belongs in
  `jsonLdToPrefill`, beside the existing `inferredIngredients: []` and its "marking it as such
  would be a lie" comment — not in the composable, which would split one guarantee across two
  files.
- **⚠️ Never clear on re-fetch.** `RecipePrefill.fields.ingredients`/`steps` are
  unconditional arrays, and the `titleOnly` rung produces both empty. `diffPayload`
  normalises empty to `undefined`, which is the repository's DELETE signal — so an unguarded
  diff would cheerfully offer "wipe every ingredient" as a change. Re-fetch may ADD or CHANGE
  to a non-empty value; it may never empty one.
- **⚠️ A re-fetch would attach a DUPLICATE photo.** `PhotoAttachment` carries no source URL,
  so there is no way to distinguish "the same og:image we already stored" from a new one.
  With no per-field toggles in v1, taking a text change would silently add a duplicate on
  every press. The photo is therefore offered **only when the recipe has no photo yet** —
  honest, needs no model change, and covers the case that actually hurts. Provenance-aware
  replacement is an explicit follow-up.
- **Re-fetch costs money and is rate-limited.** `attemptBudget` already exists for exactly
  this, with `peekAttempt`/`consumeAttempt`, a `resetsAt` on refusal, storage-failure
  tolerance and its own tests. `services/share/types.ts` explicitly names budgeting the LINK
  path as the deliberate follow-up this is. Do not hand-roll localStorage.
- **ADR-030 consent applies.** `processUrl` requires a branded `ConsentGrant`, so skipping
  the gate is a compile error — but state it, because `RecipeFormModal.vue:286-296` records
  an incident where a new mount point inherited a capture without its gate.
- **`attachAfterSave` has a documented aliasing trap**: the `dishImage` argument must be
  used, never re-read from a ref inside the async body. Its ownership note also claims
  "exactly one expression in the codebase passes this" — re-fetch makes that two, so the
  comment is updated in the same commit or the invariant becomes a lie.
- **The affordance is absent, not disabled, when there is no `sourceUrl`,** and it lives
  inside the existing `v-if="canEditActivities"` action row: re-fetch writes to a recipe.

## Assumptions

> Verified at planning time.

1. `RECIPE_JSON_SHAPE` is mirrored in spike, lambda and client, with parity enforced by
   `extractionPromptDrift.test.ts` across all three.
2. `recipeJsonLd.mjs:221-226` already returns all three fields, and the model is never
   invoked on that rung.
3. `RecipePrefill` already carries `inferredIngredients` and `inferredSteps`, and
   `RecipeFormModal.vue:644-662` renders them as a Heritage Orange hint.
4. `Recipe` has `photoIds?: UUID[]`, and `usePhotos.add` MERGES into it — so "added
   alongside, never replacing" is already guaranteed by the existing attach path.
5. `useRecipeCapture.processUrl` owns the whole ladder plus the in-flight guard, offline
   guard, routing, the four-way `assertNever` switch, per-rung telemetry and the
   `catch`/`finally`, terminating in `options.onRecipeReady`.
6. `useExtractionErrorToast` already maps EVERY `ExtractionErrorCode` to copy, and
   `processUrl` already calls it on every failure rung.
7. `diffPayload` iterates only `Object.keys(next)`, so keys the incoming prefill omits are
   untouched — omission IS exclusion.
8. `attemptBudget` provides `peekAttempt`/`consumeAttempt`, per-key, with `resetsAt`.
9. `RecipePrefill` has THREE construction sites: `recipeExtractionToPrefill`,
   `jsonLdToPrefill`, and the `titleOnly` literal in `useRecipeCapture`.

## Approach

Mockup: `docs/mockups/recipe-refetch-2026-09-07.html`. Direction B (compare, then choose) is
chosen; Direction A (a re-seeded edit form) is rejected because by the time the user looks,
the new values have already won.

The governing principle for Part B: **re-fetch is a capture with a different ending.** Every
line of the ladder, its guards, its telemetry and its failure copy already exist and are
reused verbatim. The only genuinely new code is the budget check, the diff, and the modal.

### Part A — the times

**1. One source of truth for the field list.** New `src/constants/recipeTimeFields.ts`,
mirroring `constants/mealSlots.ts`:

```ts
export type RecipeTimeField = 'prepTime' | 'cookTime' | 'servings';
export const RECIPE_TIME_FIELDS: readonly RecipeTimeField[] = ['prepTime','cookTime','servings'] as const;
export function isRecipeTimeField(v: unknown): v is RecipeTimeField { … }
```

The guard, the mapper filter and the UI all read this. No inline literal array anywhere.

**2. The wire shape, in ALL THREE copies**, byte-identical, with `PROMPT_VERSION` bumped in
all three:

```
inferredTimes: 'array of strings — any of "prepTime", "cookTime", "servings" whose value you
  worked out from general culinary knowledge rather than reading it in the source. Omit a
  field you actually read. Empty array if you read them all, or filled none.'
```

A parallel array rather than turning each field into `{value, inferred}`: additive, leaves
the three fields' type and every existing consumer untouched, and mirrors the
`inferredIngredients`/`inferredSteps` idiom. It is **not** folded into `confidence`, which is
a 0..1 "how sure" number hard-set to `1` on the JSON-LD rung and rendered by no UI — a
different question from "did you read it".

`RECIPE_REQUIRED_KEYS` is **unchanged**: requiring the new key would make an older cached
client or an off-day model lose the entire recipe.

**3. The system rule, narrowed rather than relaxed.** The blanket sentence stays verbatim.
One sentence is added directly after it, in all three copies, naming the exemption and its
condition. Ingredient and step quantities remain forbidden.

**4. Parse — raw, no enum knowledge.** `parseRecipeExtractionResult` gains
`inferredTimes: toStringList(obj.inferredTimes)`, reusing the existing bounded collector.
Absent key → `[]`. `RecipeExtractionResult.inferredTimes: string[]`, non-optional.

**5. Validate in the mapper, loudly.** `recipeExtractionToPrefill` filters with
`isRecipeTimeField` and, on any drop, `console.warn`s in the `validatedTaxonomy` idiom,
naming the legal three so a developer knows what to fix. Nothing is dropped in silence.

**6. Prefill — REQUIRED, so all three sites must answer.** `RecipePrefill.inferredTimes:
RecipeTimeField[]` (not optional). This makes the compiler force an answer at
`recipeExtractionToPrefill`, at `jsonLdToPrefill` (`[]`, with the "nothing on this path was
guessed" comment), and at the `titleOnly` literal (`[]`). The JSON-LD guarantee therefore
lives in the code, beside the identical `inferredIngredients: []`.

**7. UI — via a `FormFieldGroup` hint prop, not five copies of a class string.** The exact
hint markup already appears twice and this change would add three more inside a 3-column
grid. Instead `FormFieldGroup` gains an optional `hint?: string` rendering the Heritage
Orange line once, app-wide; `RecipeFormModal` passes `:hint` on all five fields and its two
hand-written `<p>` blocks are deleted. `applyPrefill` records `localInferredTimes` beside the
two existing local refs, so both capture routes disclose identically.

### Part B — the re-fetch

**1. `src/utils/recipeComparable.ts` (hoisted, not new logic).** `RecipeFormModal`'s
`baselinePayload` moves here unchanged — including the load-bearing `sortSlots` and its
"array equality is by INDEX" comment — and the modal imports it. One definition of "the
recipe as a comparable payload"; that file's own "🚨 SITE 3 OF 4" warnings are the reason two
copies must not exist.

**2. `src/utils/recipeDiff.ts` (pure, wraps `diffPayload`).**
`diffRecipe(current: Recipe, prefill: RecipePrefill): RecipeDiff`:

a. Build the incoming side from `prefill.fields`, **omitting `sourceUrl` and `tags`** —
`sourceUrl` is rewritten to `provenanceUrl` on capture and would read as spurious churn;
`tags` are never supplied and `applyPrefill` refuses to touch them. Because `diffPayload`
iterates `Object.keys(next)`, omission IS the exclusion — no filter code.
b. `diffPayload(recipeComparable(current), incoming)`.
c. **Never-clear rule:** drop any key whose value is `undefined` or an empty array while the
baseline had content.
d. Project the survivors into `{ field, mine, theirs }[]` in a fixed display order.
e. `photo: boolean` — true only when a candidate exists **and** the recipe has no photo yet.
f. `changed = rows.length > 0 || photo`, so "nothing new" is a plain empty result rather
than a UI concern.

**3. `src/composables/useRecipeRefetch.ts` — a thin shell around the EXISTING capture.**

```
const capture = useRecipeCapture({ onRecipeReady: ({ prefill }) => { … diff … } });
```

`start(recipe)` then, in this order:

1. `peekAttempt(refetchBudgetKey(recipe.id), REFETCH_BUDGET)` — **before** consent, so a
   peek costs nothing and refuses cheaply.
2. `await requestConsent()` — ADR-030. A decline is a silent no-op by design.
3. `consumeAttempt(...)` — **immediately before** the call, so a declined consent never
   burns a slot.
4. `await capture.processUrl(recipe.sourceUrl, grant)`.

Everything else — offline, in-flight, routing, the four resolver outcomes, every
`ExtractionErrorCode` toast, `reportError` on a throw, the `finally` — is inherited unchanged.
**No failure mapping is written for this feature.** `capture.isProcessing` is re-exported for
the button spinner.

`onRecipeReady` calls `diffRecipe`; a `changed: false` result shows the "nothing new" toast
and does not open the modal. Otherwise the diff is stored and the modal opens.

**4. The budget.** `REFETCH_BUDGET: BudgetPolicy = { max: 1, windowMs: 10 * 60_000 }` and
`refetchBudgetKey(recipeId)`, declared next to `SHARE_TEXT_BUDGET` with the same "per DEVICE,
not a security boundary, the server limiter is the real bound" framing. A cooldown IS a
budget of one. One shared refusal helper: one `logEvent` at `warn` plus one toast built with
`fillTemplate({ resetsAt })`, so the refusal always says _when_ it lifts and peek/consume
cannot drift into two messages.

**5. `RecipeRefetchModal.vue`.** `BaseModal` with its `footer` slot. Renders the rows
old-beside-new per the mockup, an optional photo row, an explicit "nothing has been saved
yet" note, and two actions: **Keep mine** and **Take These Changes**. Presentational only: it
takes an already-computed `RecipeDiff` and emits `take` / `close`. No per-field toggles in v1.

**6. Applying.** One `recipesStore.updateRecipe(id, patch)` where `patch` is the diff's field
map — already minimal, already `diffPayload`-shaped, so it is the same write the edit form
makes. A taken photo goes through `capture.attachAfterSave(recipe.id, prefill.dishImage)` —
the existing path, which appends via `usePhotos`, honours the cap and cloud check, runs the
candidate ladder and logs `image_resolved`/`image_none`. Zero new attach code. The aliasing
rule is respected, and `attachAfterSave`'s "exactly one expression passes this" comment is
updated to name both owners.

**7. Failure of the APPLY (not the fetch).** `updateRecipe` is awaited inside a `try/catch`:
on failure the modal stays open, a toast fires, and `reportError({ surface:
'recipe-refetch', severity: 'error', context: { action: 'apply_failed' } })` runs with a
`console.error` naming the store call. The recipe is unchanged, so nothing is lost, but it is
never swallowed.

### Part C — copy

`recipes.refetch.*` (button, modal title/subtitle, yours/from-the-site labels, was-empty,
photo note, nothing-saved note, the two actions, the no-change toast, the cooldown refusal
with a `{resetsAt}` placeholder) and `recipeExtract.inferred.times` — all `en` + `beanie`.

## Files Affected

**Created**

- `src/constants/recipeTimeFields.ts`
- `src/utils/recipeComparable.ts` (hoisted from `RecipeFormModal.baselinePayload`)
- `src/utils/recipeDiff.ts`
- `src/composables/useRecipeRefetch.ts`
- `src/components/pod/RecipeRefetchModal.vue`
- `src/utils/__tests__/recipeDiff.test.ts`
- `src/composables/__tests__/useRecipeRefetch.test.ts`

**Modified**

- `scripts/spikes/extractionPrompt.mjs` — `inferredTimes` + the narrowed rule + `PROMPT_VERSION`
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — the mirrored change
- `src/services/ai/extractionPrompt.ts` — the mirrored change, plus `toStringList` in the parser
- `src/services/ai/types.ts` — `inferredTimes: string[]` on `RecipeExtractionResult`
- `src/utils/recipeExtractionToRecipe.ts` — required `inferredTimes` on `RecipePrefill`; the
  `isRecipeTimeField` filter + `console.warn`; `[]` in `jsonLdToPrefill`
- `src/composables/useRecipeCapture.ts` — `inferredTimes: []` on the `titleOnly` literal; the
  `attachAfterSave` ownership comment
- `src/components/ui/FormFieldGroup.vue` — optional `hint` prop
- `src/components/pod/RecipeFormModal.vue` — import the hoisted comparable;
  `localInferredTimes`; five `:hint` bindings replacing two inline `<p>` blocks
- `src/pages/RecipeDetailPage.vue` — the conditional re-fetch action (inside the existing
  `canEditActivities` row) + modal host
- `src/services/share/types.ts` — `REFETCH_BUDGET` + `refetchBudgetKey`
- `src/services/translation/uiStrings.ts`

**Deliberately NOT modified**

- `src/composables/useExtractionErrorToast.ts` — every code is already mapped; a second
  mapper is exactly what its header forbids.
- `src/utils/diffPayload.ts` — used, never grown (its complexity budget is pinned by a test).
- `src/utils/diagnosticContext.ts` — no new `ALLOWED_CONTEXT_KEYS`.

## Observability Coverage

Surface: **`recipe-refetch`** (the times work rides the existing `recipe-extract` surface, and
`processUrl`'s own start/failed/ready events fire unchanged underneath).

- `logEvent({ level:'info', surface:'recipe-refetch', message:'refetch produced a diff', context:{ action:'refetch_completed', count:<fields changed>, detail:<'with_photo'|'no_photo'> } })`
- `logEvent({ level:'info', …, message:'refetch found no changes', context:{ action:'refetch_nochange' } })` — distinguishes "worked, nothing new" from "did not work", which the failure rate depends on.
- `logEvent({ level:'info', …, message:'refetch changes taken', context:{ action:'refetch_applied', count:<n> } })` — the acceptance rate is the measure of whether the diff is any good.
- `logEvent({ level:'warn', …, message:'refetch refused by the local budget', context:{ action:'refused', detail:'quota' } })` — same vocabulary as the share budget, so the two are one query.
- `reportError({ surface:'recipe-refetch', severity:'error', context:{ action:'apply_failed' } })` — the write failed after the user said yes. Fetch failures are NOT reported here: `processUrl` already logs and toasts them on `recipe-extract`, and duplicating them would double-count the funnel.
- Times: `logEvent({ level:'info', surface:'recipe-extract', message:'times filled', context:{ action:'times_filled', count:<stated>, detail:<inferred count as a fixed bucket> } })`.

Counts ride the allowlisted `count` key rather than being embedded in `message`, because
`logEvent` buckets its rate limiter on the normalised message and a digit-bearing message is
a poor query key.

**Privacy gate:** no new `ALLOWED_CONTEXT_KEYS`; `action`, `count`, `detail`, `kind` and
`error_code` are all pre-existing. Never a recipe name, an ingredient, or a source URL.

## Acceptance Criteria

- [ ] A source stating prep, cook and servings yields all three, unmarked
- [ ] A source stating none yields inferred values, each visibly marked
- [ ] A JSON-LD capture never marks a time as inferred
- [ ] Ingredient quantities are still never invented — the existing rule is untouched
- [ ] All THREE prompt copies change together, `PROMPT_VERSION` is bumped in all three, and `extractionPromptDrift.test.ts` passes
- [ ] An unknown value in `inferredTimes` is dropped in the mapper with a `console.warn`, never in silence
- [ ] A recipe with no `sourceUrl` shows no re-fetch affordance at all
- [ ] Re-fetch shows the old value beside the new one and writes nothing until taken
- [ ] "Keep mine" leaves the recipe byte-identical
- [ ] An identical re-read says so instead of showing an empty diff
- [ ] A re-fetch that returns fewer or no ingredients NEVER offers to clear them
- [ ] A photo is offered only when the recipe has none, and is APPENDED to `photoIds`
- [ ] A second press inside the window is refused locally, with no network call, and the toast names when it lifts
- [ ] Declining the consent prompt does not consume a budget slot
- [ ] A dead link, paywall or non-recipe page each produce a specific message and change nothing — via the SHARED mapper, with no new mapping code
- [ ] A failed `updateRecipe` after "Take These Changes" toasts, reports, and leaves the modal open
- [ ] Every new string has `en` + `beanie`; lint passes i18n and dark-mode rules

## Testing Plan

1. `recipeDiff.test.ts` — identical inputs → empty diff; each field type; empty→filled; a
   field the user filled that the source omits (NOT a change); **a non-empty list vs an empty
   incoming list (never-clear)**; `sourceUrl`/`tags` never reported; photo offered only when
   `photoIds` is empty; `changed` false on a photo-less no-op.
2. `useRecipeRefetch.test.ts` — peek refuses before consent AND before any fetch; a declined
   consent consumes nothing; a successful re-fetch produces a diff; a resolver `failed` leaves
   the store untouched and emits no `recipe-refetch` error (the shared mapper owns it); a
   rejected `updateRecipe` reports and keeps the modal open.
3. `recipeExtractionParse.test.ts` (extend) — `inferredTimes` parsed as raw strings, absent
   key → `[]`, garbage entries dropped by `toStringList`.
4. `recipeExtractionToRecipe.test.ts` (extend) — legal names survive; an illegal name is
   dropped with a `console.warn`; `jsonLdToPrefill` and the `titleOnly` literal both yield `[]`.
5. `extractionPromptDrift.test.ts` must pass — the guard on the THREE-copy change.
6. `shareExtraction.test.ts` (extend) — the delegated recipe parse carries `inferredTimes`.
7. `RecipeFormModal` — a named time field renders the hint; an unnamed one does not; the two
   existing ingredient/step hint tests still pass through the new `FormFieldGroup` prop.
8. `npm run type-check`, `npm run lint`, full unit suite.
9. **Manual, both themes:** re-fetch a recipe from a site that has changed; one that has not;
   a dead link; press twice inside the window; capture from a page with no JSON-LD and
   confirm the times arrive marked.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup; found the prompt mirrored under a drift guard; chose a parallel `inferredTimes` array over restructuring the three fields; made the JSON-LD rung's empty `inferredTimes` an explicit guarantee; added a local cooldown because re-fetch is metered.
- **Pass 2 (DRY + error handling)**: Corrected the prompt to THREE mirrored copies — the spike copy is in the drift guard and Pass 1 missed it, so the plan as drafted would have failed CI — and added the `PROMPT_VERSION` bump every copy's header requires. Replaced the hand-rolled localStorage cooldown with the existing `attemptBudget` (already carries `resetsAt`, pruning and storage-failure tolerance, and `services/share/types.ts` names the link path as its intended next user). Replaced new comparison logic with a wrapper over `diffPayload`, and hoisted `RecipeFormModal.baselinePayload` so "the recipe as a payload" has one definition. Deleted the per-code failure mapping entirely: `useExtractionErrorToast` already maps every code and `processUrl` already calls it, so re-fetch now reuses `useRecipeCapture` wholesale rather than re-specifying the ladder's endings. Moved the enum filter out of the parser into the mapper and made the drop `console.warn` rather than silent. Made `inferredTimes` required so all THREE prefill construction sites must answer. Closed a data-loss hole — `ingredients`/`steps` are always-present arrays, so an empty re-read would have offered a DELETE — with a never-clear rule. Closed a duplicate-photo hole (`PhotoAttachment` has no source URL) by offering the photo only when the recipe has none. Added the missing ADR-030 consent step with peek-before-consent ordering, a `try/catch` around the apply, the `canEditActivities` gate, and folded five Heritage-Orange hints into one `FormFieldGroup` prop instead of tripling the class string.
- **Pass 3 (Sustainability)**: _pending_
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Let's make some improvements to the recipe and cookbook features: … provide a "refresh / re-fetch" type affordance for each recipe to search the link again to review and reload the recipe detail and/or populate a new or changed photo
>
> Another thing i noticed is that the prep time / cook time / servings fields are usually not populated from the AI response even though, for the most part, these details are either in the recipe or could probably be reasonably inferred. can we include these items in the response if they exist?
>
> Please review this and let me know if any questions. If all clear then create a new issue with /beanies-new-issue then move straight to /beanies-pre-plan and once done move to /beanies-plan

### Follow-up 1 (decisions)

> Re-fetch: "Show a review step before applying". Scope: "Two issues".

### Follow-up 2

> yes [create issue #93]

### Follow-up 3

> yes. work autonomous as i will be going to sleep now. … move to /beanies-plan and create the full plan for both issues. then move to implementation for both … once done, run /code-review max … fix all issues found … then /end-session

### Follow-up 4

> correct, social share first, and then capture-quality issue is fine. for both issues, i am fine with your proposal to view and choose the best mockup as necessary and appropriate for the design. you can go straight to implementation once done

</details>
