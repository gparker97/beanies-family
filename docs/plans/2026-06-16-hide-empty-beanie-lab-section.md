# Plan: Hide The Beanie Lab section when no features are gated into it

> Date: 2026-06-16
> Related issues: None — direct implementation (Notion tracker #35; no GitHub issue)
> Plan file: `docs/plans/2026-06-16-hide-empty-beanie-lab-section.md`

## User Story

As a user, I don't want to see an empty "The Beanie Lab" section in Settings when there are no experimental features available to opt into, so the page stays clean and every section earns its place.

## Context

The Beanie Lab (shipped 2026-06-12, `docs/plans/2026-06-12-the-beanie-lab.md`) is a quiet, collapsed, per-device opt-in at the bottom of Settings that reveals in-development features (currently beanies AI and Google Calendar). It is conceptually permanent. But today the section renders unconditionally — so if every Lab feature is later removed or its kill-switch flag turned off, an empty, purposeless disclosure (header, beaker glyph, opt-in toggle) would remain at the bottom of Settings. greg's direction (2026-06-14): "beanie lab will always stay, but if there are no features in the lab then it shouldn't be displayed."

This is a display-time emptiness guard only. The Lab concept, the persisted opt-in flag (`settingsStore.beanieLabEnabled`), and all existing behavior are unchanged. Note: in the CURRENT prod state all flags are committed true, so the Lab is non-empty and this change is invisible today — it is forward-looking for when features graduate out.

## Requirements

1. When zero features are currently available in the Beanie Lab, hide `BeanieLabSection` entirely from Settings — no header, no beaker glyph, no opt-in toggle, and no leftover gap/divider.
2. When one or more features are available, render exactly as today.
3. The show/hide is reactive — adding/removing an available feature flips the section visibility without a manual reload beyond the normal flag-reload contract.
4. The persisted `beanieLabEnabled` opt-in state is preserved across an empty period (we never write it; an empty Lab simply isn't shown).
5. Deep-link/drawer guards in `SettingsPage` must not error when the section isn't rendered.
6. No new data model, no new feature flag, no new user-visible strings.

## Important Notes & Caveats

- "Available" must be defined independently of the opt-in toggle (`beanieLabEnabled`). The section must show for users who have NOT yet opted in (so they can), as long as a feature exists to opt into. Therefore the emptiness check keys off the underlying feature flags, NOT `labEnabled`.
- Today `aiVisible` is defined as `labEnabled` alone (AI has no dedicated surface flag). For the emptiness guard to hold the invariant "section hidden ⟹ no Lab feature can be visible or mount", AI's availability must be expressed via its real kill-switches (`aiPhotoExtract`/`aiTravelExtract`). In current prod (both true) this is behaviorally identical to today.
- `space-y-6` on the settings root container (`SettingsPage.vue:617`) means a `v-if` on the section auto-collapses spacing — no manual divider/margin cleanup needed. There is no standalone divider element wrapping the section. (Verified: the section is a direct child of the `space-y-6` container at line 781.)
- Do NOT make `BeanieLabSection` self-hide (render nothing) — guard at the mount point in `SettingsPage` instead. A component that renders nothing is a smell, and the spacing/deep-link concerns live in the page.
- No new try/catch is warranted. The two failure surfaces this change touches are already handled and never fail silently: (a) every flag read goes through `isFlagEnabled`, whose `localStorage` access is wrapped in `flags.ts` (falls back to default + `console.warn` on storage failure); (b) the opt-in write is already guarded in `BeanieLabSection.onToggleLab`, which surfaces a toast + `console.error` and re-throws. This plan adds only pure derived `computed`s, which have no failure surface of their own.
- DRY guardrail: the doc-comment at the top of `useBeanieLab.ts` currently states AI "gates on the Lab alone" — that becomes FALSE under this change. The comment MUST be rewritten in the same edit, and the two inline deep-link-map comments in `SettingsPage` (lines 118 and 122) that describe the AI/calendar gates MUST be refreshed, so the documentation does not silently drift from the code.
- Maintainability guardrail (invariant): `hasAnyLabFeature` must stay the OR of exactly the same availability terms that back the entries in `BeanieLabSection`'s `labFeatures` list (calendar→`calendarAvailable`, ai→`aiAvailable`). If these two lists ever desync — e.g. a future feature is added to `labFeatures` but its availability term is not OR'd into `hasAnyLabFeature` — the section can hide while a card wants to show (or render empty while opted in). To keep the coupling impossible to miss, the `useBeanieLab` doc-comment MUST state this invariant explicitly at the point of change (see step 1), and the unit tests (below) assert it for all three flags. This is a deliberate single-composable coupling, not accidental complexity: it is the very thing that prevents the card list and the section guard from drifting.
- **Test-doc guardrail (Pass 4):** the test file's own header comment (`useBeanieLab.test.ts:1-8`) pins the contract as `aiVisible = labEnabled`. That line becomes FALSE under this change and MUST be rewritten in the same edit, alongside the assertions it documents (see Testing Plan). Documentation drift in the test header is as harmful as in the source.

## Assumptions

> Review these before implementation.

1. The Lab's feature set remains {AI, Calendar}. Adding a future feature means TWO coupled edits in `useBeanieLab` (its `*Available` computed, and OR-ing that into `hasAnyLabFeature`) plus its `labFeatures` entry in `BeanieLabSection` — the doc-comment invariant calls this out so it can't be half-done.
2. AI's presence in the Lab is meaningful only while at least one AI reader kill-switch (`aiPhotoExtract` / `aiTravelExtract`) is alive; if both are off, the AI surface has no working reader and should not count as a Lab feature. (This refines today's `aiVisible = labEnabled`.)
3. `isFlagEnabled` remains the single read point for committed flag state (verified — `src/config/flags.ts:71`), and `aiPhotoExtract` / `aiTravelExtract` / `googleCalendarSync` are all current registry ids (verified — `src/config/flagRegistry.ts`).

## Approach

All visibility logic stays centralized in `useBeanieLab` (the existing single source of truth shared by `BeanieLabSection` and `SettingsPage`'s deep-link/drawer guards), so the card list, the section guard, and the drawer guards can never drift. `aiVisible` / `calendarVisible` are derived FROM the availability computeds (not by re-reading flags), so each flag is read in exactly one place.

**1. `src/composables/useBeanieLab.ts`** — add an availability layer (independent of opt-in), derive everything from it, and rewrite the doc-comment so the AI rationale matches the new model and states the list-coupling invariant:

```ts
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { isFlagEnabled } from '@/config/flags';

/**
 * Single source of truth for "The Beanie Lab" visibility.
 *
 * Two layers, both centralized here so the card list, the section's mount-point
 * guard, and SettingsPage's drawer / deep-link guards can never drift:
 *
 *  - AVAILABILITY (hasAnyLabFeature / *Available): does a feature EXIST to opt
 *    into, independent of the per-device opt-in? Drives whether the whole
 *    section renders — it must show for users who have NOT opted in yet, so
 *    they still can. AI has no dedicated surface flag, so it is "available"
 *    while EITHER reader kill-switch (aiPhotoExtract / aiTravelExtract) is
 *    alive; calendar gates on googleCalendarSync.
 *  - VISIBILITY (aiVisible / calendarVisible): available AND opted in. Drives
 *    the individual cards and their drawers. Derived from the availability
 *    computeds (not a second flag read), preserving the invariant:
 *    section hidden ⟹ no feature can be visible or mount.
 *
 * INVARIANT — keep in sync when adding a Lab feature: hasAnyLabFeature must be
 * the OR of exactly the *Available terms that back BeanieLabSection.labFeatures.
 * Adding a feature is THREE coupled edits: its *Available computed here, OR it
 * into hasAnyLabFeature here, and its labFeatures entry in BeanieLabSection.
 * If they desync, the section can hide while a card wants to show.
 */
export function useBeanieLab() {
  const settingsStore = useSettingsStore();

  const labEnabled = computed(() => settingsStore.beanieLabEnabled);

  const aiAvailable = computed(
    () => isFlagEnabled('aiPhotoExtract') || isFlagEnabled('aiTravelExtract')
  );
  const calendarAvailable = computed(() => isFlagEnabled('googleCalendarSync'));

  const hasAnyLabFeature = computed(() => aiAvailable.value || calendarAvailable.value);

  const aiVisible = computed(() => labEnabled.value && aiAvailable.value);
  const calendarVisible = computed(() => labEnabled.value && calendarAvailable.value);

  return { labEnabled, hasAnyLabFeature, aiVisible, calendarVisible };
}
```

**2. `src/pages/SettingsPage.vue`** — guard the mount point and refresh the now-stale deep-link comments:

- Add `hasAnyLabFeature` to the existing destructure at line 109: `const { hasAnyLabFeature, aiVisible, calendarVisible } = useBeanieLab();`
- Add `v-if="hasAnyLabFeature"` to `<BeanieLabSection ... />` (line 781):

```vue
<BeanieLabSection
  v-if="hasAnyLabFeature"
  @open-ai="showAi = true"
  @open-calendar="showCalendarSync = true"
/>
```

- Update the two inline comments in `cardOpenMap` (lines 118, 122) so they describe the refined gate, e.g. AI: "Guarded: AI lives in the Beanie Lab — no-ops unless opted in AND a reader flag (aiPhotoExtract / aiTravelExtract) is alive." Calendar comment stays accurate (opt-in + googleCalendarSync) but verify wording matches `calendarVisible`.

**3. `src/components/settings/BeanieLabSection.vue`** — no functional change. It already destructures `labEnabled`, `aiVisible`, `calendarVisible` from `useBeanieLab` (all still returned), and its `visibleFeatures` filter (line 64) is unchanged. (Optional: its own header doc-comment makes no AI-gate claim, so it needs no edit.)

## Files Affected

- `src/composables/useBeanieLab.ts` — add `aiAvailable`/`calendarAvailable`/`hasAnyLabFeature`; redefine `aiVisible`/`calendarVisible` in terms of availability; rewrite doc comment (availability vs visible + list-coupling invariant).
- `src/pages/SettingsPage.vue` — add `hasAnyLabFeature` to destructure + `v-if="hasAnyLabFeature"` on `<BeanieLabSection>`; refresh the deep-link-map comments.
- `src/composables/__tests__/useBeanieLab.test.ts` — rewrite the header contract comment, UPDATE the existing `aiVisible`-follows-the-flag assertions that break under the new model, and add the availability tests (below).

## Acceptance Criteria

- [ ] With ≥1 Lab feature available, the section renders exactly as today.
- [ ] With 0 Lab features available, the section (header, glyph, toggle) is not rendered and no empty gap remains.
- [ ] Toggling availability (flag on/off) shows/hides the section reactively.
- [ ] Existing `beanieLabEnabled` opt-in state is preserved across the empty period.
- [ ] Deep-link (`?open=ai` / `?open=calendar-sync`) and drawer mounts do not error when the section is hidden (they already gate on `aiVisible`/`calendarVisible`, which are false when nothing is available).
- [ ] No doc/inline/test comment still claims AI "gates on the Lab alone" / `aiVisible = labEnabled`.
- [ ] `npm run validate` green (type-check + lint + tests).

## Testing Plan

> **Pass-4 correction — read this before touching the test file.** The existing `useBeanieLab.test.ts` mocks `isFlagEnabled` with a single hoisted `vi.fn()` driven by `mockReturnValue(...)` — i.e. it returns the SAME boolean for EVERY flag id (it ignores its argument). The settings store is NOT mocked; the test uses a real Pinia (`setActivePinia(createPinia())`) and toggles the opt-in via a helper that writes `beanieLabEnabled` directly. Two consequences:
>
> 1. **An existing test WILL BREAK and must be updated, not just added to.** The current test that asserts `aiVisible === true` while `mockIsFlagEnabled.mockReturnValue(false)` and the Lab is on (comment "AI does not depend on the flag") becomes FALSE under the new model `aiVisible = labEnabled && (aiPhotoExtract || aiTravelExtract)` — both reader flags read `false`, so `aiVisible` is `false`. That assertion (and its comment) must be rewritten to reflect that AI now DOES require a live reader flag.
> 2. **Per-flag-combination tests require switching the mock to `mockImplementation`.** The single-value `mockReturnValue` cannot express "aiPhotoExtract off, aiTravelExtract on" or "AI flags off but calendar flag on." Use `mockIsFlagEnabled.mockImplementation((flag: string) => /* per-id boolean */)`. Keep the simple `mockReturnValue(true/false)` for the all-on / all-off cases.
>
> Also update the test-file header comment (lines 1-8), which currently pins the contract as `aiVisible = labEnabled`.

1. Unit (`useBeanieLab.test.ts`), using the mocking pattern above:
   - **All flags off ⟹ `hasAnyLabFeature` false** (use `mockReturnValue(false)`), regardless of `beanieLabEnabled` (test both lab on and lab off). Also assert `aiVisible` and `calendarVisible` are both false.
   - **Any single flag on ⟹ `hasAnyLabFeature` true**, independent of `beanieLabEnabled` (use `mockImplementation` to turn on exactly one of `aiPhotoExtract` / `aiTravelExtract` / `googleCalendarSync` at a time; assert `hasAnyLabFeature` true in each). This asserts the list-coupling invariant across all three flags.
   - **`aiVisible`** is false when both AI reader flags are off even if `labEnabled` is true; true when lab on + at least one reader flag on (verify `aiPhotoExtract` on / `aiTravelExtract` off, AND the reverse, to prove the OR).
   - **`calendarVisible`** unchanged behavior: true when lab on + `googleCalendarSync` on; false when lab off; false when the flag is off.
   - Optional sanity: assert `isFlagEnabled` is called with each expected id.
2. Manual: in dev, force all three flags off via localStorage overrides (`beanies:flag:aiPhotoExtract=false`, `beanies:flag:aiTravelExtract=false`, `beanies:flag:googleCalendarSync=false`), reload, confirm the section disappears with no gap; flip one back on, confirm it returns and respects the existing opt-in state.
3. `npm run validate`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the availability-vs-visible split in `useBeanieLab` with a single `hasAnyLabFeature` derivation and a mount-point `v-if` in SettingsPage; no new flags/strings/model.
- **Pass 2 (DRY + error-handling)**: Verified every reuse claim against source (`useBeanieLab`, `isFlagEnabled`, flag ids, `space-y-6` container, existing drawer guards — all accurate). Confirmed `aiVisible`/`calendarVisible` derive from the availability computeds so each flag is read once (DRY). Confirmed no new try/catch is needed (the only failure surfaces — flag `localStorage` reads, opt-in write — are already wrapped and surface console warnings/toasts). Added explicit requirements to rewrite the now-false `useBeanieLab` doc-comment and the two SettingsPage deep-link comments so documentation can't silently drift.
- **Pass 3 (Sustainability)**: Re-verified all line numbers and structural claims. Found the design appropriately simple (minimal public return surface; `*Available` kept internal; no deep nesting; no self-hiding component; no new flags/model/try-catch). Hardened the one latent risk — the implicit coupling between `hasAnyLabFeature` and `BeanieLabSection.labFeatures` — by promoting it to an explicit, documented INVARIANT and an asserting unit test.
- **Pass 4 (Fresh-eyes sweep)**: Re-read the actual test file; design/source claims hold. Found the testing guidance inaccurate about the harness: existing tests mock `isFlagEnabled` with a single all-flags `mockReturnValue` (not per-id) and use a real Pinia store — so per-flag tests need `mockImplementation`, and the existing "aiVisible true with flag off" assertion + the header contract comment WILL BREAK / go stale and must be UPDATED. Rewrote the Testing Plan + Files Affected + added a test-doc guardrail. No implementation-step changes.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (slash command)

/beanies-plan — "let's implement #35 - we've already prepared the prompt"

### Prepared intake (Notion #35 "beanies-plan prompt" field)

Title: Hide The Beanie Lab section when no features are gated into it. Type: feature. Priority: low. Surfaces: All platforms / area settings. Objective: the Lab is permanent but its Settings section should only render when ≥1 experimental feature is gated in; today it shows even when empty. User story: as above. UX: no mockup — hides an existing section, no new UI; when zero features, the section + surrounding spacing are removed cleanly; reappears respecting the existing opt-in state. Scope: hide BeanieLabSection when zero features gated in; render as today when ≥1; Lab stays permanent conceptually (display-time guard only). Acceptance: (1) ≥1 feature → renders as today; (2) 0 features → not rendered, no gap; (3) toggling add/remove reactively shows/hides; (4) beanieLabEnabled preserved across empty period. Edge cases: beanieLabEnabled=true but all features gone → still hide gracefully (flag persists); reappear later respecting opt-in; deep-link/drawer guards must not error when not rendered. Reuse hints: useBeanieLab centralizes the gated-feature list; add a derived "has any visible features" computed and guard BeanieLabSection (and any SettingsPage divider/spacing) on it; likely a v-if at the SettingsPage mount point; no new data model. References: docs/plans/2026-06-12-the-beanie-lab.md. GitHub issue: SKIP. Feature gate: NO — ship ungated.

### Approval

"approved"

</details>
