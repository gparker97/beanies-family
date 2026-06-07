# Plan: Unify the Beanies-AI entry point + trip-scoped AI + Activities in the Planning nav

> Date: 2026-06-07
> Related: travel AI wedge (#30), AI magic entry points (#133)

## Context

Three connected asks after the AI document readers soft-launched:

1. **The AI entry point is inconsistent across pages.** The activities command bar shows a compact icon-only ✨ pill ("AI badge"); the travel plans page shows a full-text "✨ Perform magic" pill. greg wants ONE consistent, easy-to-find treatment everywhere — and chose a **responsive** pill: full "✨ Perform magic" label on desktop, compact ✨ circle on mobile, applied to **every** AI entry point (so the activities command bar, currently icon-only at all widths, also changes).
2. **No way to AI-add to a specific trip.** From a trip's detail page there's no AI button; the only one lives on the trip-list header and auto-resolves the target by date. greg wants an AI button on the trip detail page that **defaults to the open trip** (user can still pick New/another trip).
3. **Activities was removed from the mobile Planning stack** when it became the center calendar hero button. greg wants it in **both** places; tapping either should open the planner and scroll to the current day.

## Approach

### Part 1 — One responsive AI pill everywhere

`src/components/ai/MagicReaderPill.vue` currently has two modes (`iconOnly` circle vs full text pill). It's used in exactly two places (CalendarCommandBar = icon-only, TravelPlansPage = text). Collapse it to a **single responsive rendering** and drop the `iconOnly` prop:

- One `<button class="magic-shimmer …">`: 40px ✨ circle on mobile (`h-10 w-10 rounded-full`), expanding to `sm:h-auto sm:w-auto sm:rounded-2xl sm:px-4 sm:py-2.5` with ✨ + label on `sm:+`. Mirror the responsive pattern already used by the adjacent "+" Add button in `CalendarCommandBar.vue` (`sm:hidden` / `hidden sm:inline`).
- Label span is `hidden sm:inline` (visual only); the ✨ stays `aria-hidden`. Set `:aria-label="label"` **always** so the accessible name is present on mobile and (on desktop) matches the visible text — avoids a WCAG label-in-name mismatch. This removes the need for the separate `ai.addFromPhoto` aria override.
- Keep `label` (default `t('ai.magic.perform')`). No new i18n key needed for the pill.

Call-site updates:

- `src/components/planner/CalendarCommandBar.vue` — drop `icon-only` and the custom `:aria-label`; pill is now responsive.
- `src/pages/TravelPlansPage.vue` (list header) — already passes `:label`; becomes responsive automatically once the component changes.

Verify via grep that no other call site relies on `iconOnly` before removing it.

### Part 2 — AI button on the trip detail page, defaulting to the open trip

Reuse the entire existing extract flow untouched — only the **default target** differs. The review modal (`TravelExtractReviewModal.vue`) already seeds "Existing trip + chosen trip" from `ready.target` (lines ~85–92) and lets the user toggle to New, and `resolveTripTarget`/`addExtractedSegments` already handle attach. So:

- In `src/pages/TravelPlansPage.vue`:
  - Add `const pendingTripTarget = ref<string | null>(null)`.
  - Change `handleAddFromDocument(tripId?: string)` to set `pendingTripTarget.value = tripId ?? null` before opening the picker. (List header calls it with no arg → unchanged auto-resolve.)
  - In the page-owned `onTravelReady` callback, apply a small pure helper to override the target when a trip was pre-selected and still exists:
    ```ts
    // new pure helper (src/utils/vacation.ts) — testable, no Vue deps
    export function overrideTripTarget(target, tripId, vacations) {
      if (tripId && vacations.some((v) => v.id === tripId))
        return { kind: 'attach', vacationId: tripId };
      return target; // deleted trip → fall back to date-resolved target
    }
    ```
    then clear `pendingTripTarget` after consuming.
  - Add the responsive `MagicReaderPill` to the **trip detail header** actions row, gated by the same `canReadDocument`/`canEditActivities`, wired to `handleAddFromDocument(selectedVacationId)`.

No change to `useDocumentToTravel`, the review modal, or the store.

### Part 3 — Activities in both the Planning stack and the center Calendar button + scroll-to-today

**Nav config (`src/constants/navigation.ts`)** — allow an item in multiple mobile categories:

- Generalize `mobileCategory?: MobileCategoryId` → `MobileCategoryId | MobileCategoryId[]`; add a `mobileCategoriesOf(item)` normalizer and use it in the readers (`collectTaggedRoutes`, and the `NAV_ITEMS_FLAT` → `MOBILE_TAGGED_NAV_ITEMS` derivation) so arrays expand to one tagged route per category.
- Tag `/activities` with `['calendar', 'planning']` → stays the center leaf (calendar still has exactly one route) AND joins the Planning stack. NAV_ITEMS order puts it first in the stack (before Travel, To-Do).
- Add `HINT_KEY_BY_PATH['/activities'] = 'mobileNav.hint.activities'` + i18n `mobileNav.hint.activities` (en/beanie/zh) so the module-load hint invariant passes.
- Module-load invariants (leaf has one route; every stack route has a hint) remain intact.

Desktop sidebar already lists Activities (Treehouse) — no change.

**Scroll-to-today on nav tap** — fresh navigation already scrolls on child `onMounted`; the gap is tapping the calendar tab while already on `/activities` (a router no-op, so no route/query watch fires). Mirror the `useMagicReader` singleton:

- New `src/composables/usePlannerToday.ts`: module-level `pendingGoToday` ref + `requestGoToday()` + `usePlannerTodayConsumer(handler)` (idempotent: `watch` for same-page + `onMounted` for cross-page arrival; consume resets the flag).
- `src/pages/FamilyPlannerPage.vue`: `usePlannerTodayConsumer(handleToday)` (handleToday already does `goToday()` + `todayTick++`).
- `src/components/common/MobileBottomNav.vue`: call `requestGoToday()` whenever navigating to `/activities` (covers the center Calendar leaf and the new Planning-stack Activities item). Verify the stack-item click path; wire there too if it bypasses the shared `navigate`.

A singleton (not a query param) is the right fit: same-route re-tap can't be caught by a route/query watch, and it matches the existing codebase idiom with no URL noise.

## Files affected

- `src/components/ai/MagicReaderPill.vue` — single responsive render; remove `iconOnly`
- `src/components/planner/CalendarCommandBar.vue` — drop `icon-only` + custom aria
- `src/pages/TravelPlansPage.vue` — detail-header pill; `pendingTripTarget` + `overrideTripTarget` in `onTravelReady`; `handleAddFromDocument(tripId?)`
- `src/utils/vacation.ts` — new pure `overrideTripTarget` helper
- `src/composables/usePlannerToday.ts` — NEW singleton
- `src/pages/FamilyPlannerPage.vue` — consume go-to-today signal
- `src/components/common/MobileBottomNav.vue` — `requestGoToday()` on `/activities` nav
- `src/constants/navigation.ts` — multi-category support + `/activities` in `['calendar','planning']` + hint
- `src/services/translation/uiStrings.ts` — `mobileNav.hint.activities` (then `npm run translate`)
- Tests: extend `navigation` unit test (Activities in both categories; hint invariant); `overrideTripTarget` unit test; light `usePlannerToday` test
- `CHANGELOG.md` — Added (Activities in Planning menu + jump-to-today; AI-add to a specific trip) / Changed (unified responsive AI button)

## Verification

- `npm run validate` (type-check + lint + unit tests) green; `npm run translate` parses cleanly.
- `npm run dev`, mobile viewport: Planning stack shows **Activities** (first), Travel, To-Do; the center Calendar button remains. Tapping **either** Activities opens the planner and scrolls to today — including re-tapping while already on `/activities`.
- AI pill is identical & responsive on activities + travel (list + detail): ✨ circle on mobile, "✨ Perform magic" on desktop.
- Trip detail AI button → review modal opens defaulted to **Existing → the open trip**; switching to **New** still works; attaching to a non-overlapping open trip works (covers the one-way-flight case).
- Edge: deleting the open trip mid-flow falls back to the date-resolved target (no crash).
