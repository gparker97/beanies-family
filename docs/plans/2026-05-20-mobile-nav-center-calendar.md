# Plan: Mobile bottom nav — raised center Calendar one-tap shortcut

> Date: 2026-05-20
> Related issues: None — direct implementation.
> Plan file: `docs/plans/2026-05-20-mobile-nav-center-calendar.md`
> **No GitHub issue created.** Direct implementation; full prompt history in the Prompt Log below.
> Mockup: `docs/mockups/navbar-center-planner-2026-05-20.html` (approved design reference).

## User Story

As a beanies.family mobile user, I want the family calendar reachable with a single tap from a prominent button in the middle of the bottom nav — so the app's core planning view is never more than one tap away, instead of buried two taps deep under the Planning popout.

## Context

The mobile bottom nav (`MobileBottomNav.vue`) is a 4-tab popout design: **Nook** (1-tap leaf → `/nook`) plus three stack-opening categories — **Planning** (🌳), **Money** (🐷), **Pod** (🌱) — each of which opens a `MobileNavBeanStack` popout (2 taps to reach any child). The **Activities** view (`/activities`, the "Family Planner" / calendar hub) currently lives inside the Planning stack, so it takes two taps.

beanies.family is a planning-first app, so the calendar is the most-used destination. greg proposed promoting it to a dedicated, prominent **one-tap** button in the **center** of the bottom nav. After a `/frontend-design` exploration (three rounds of iteration on a mockup), the agreed design is:

- A **round** (fully circular) Heritage-Orange button that **peeks only slightly** (~14–16px) above the bar — a middle ground between "floating high FAB" and "flat inline tab".
- **Five evenly-distributed slots** (`flex-1` each): `🏡 Nook · 🌳 Planning · 📅 Calendar · 🐷 Money · 🌱 Pod`.
- The center button is labelled **Calendar** (not "Planner" — that would stutter against "Planning"; greg chose "Calendar" as the clearest, distinct term; it also matches the help/CIG description of the Family Planner as the "calendar hub").
- Activities **graduates out** of the Planning stack to the center; the Planning stack then holds **Travel ✈️ + To-do ✅** ("Planning" still describes those accurately).
- **No today-count badge** (greg chose "ship clean"; can be added later as a focused change).
- **5th tab stays "Pod"** (the mockup's "Family" was illustrative; `mobile.pod` is the source-of-truth label and "Pod" is used throughout routes/strings/CIG).

This is mobile-only: `MobileBottomNav` is mounted `v-if="isMobile"` (`App.vue:1587`). The desktop sidebar (which lists Activities under the Treehouse section) is **unchanged** — `mobileCategory` only drives the mobile derivation, not the sidebar.

## Requirements

1. **Center one-tap Calendar button.** A round Heritage-Orange button in the middle slot of the mobile bottom nav. One tap navigates directly to `/activities` (a leaf, like Nook — no popout).
2. **Five even slots.** `Nook · Planning · Calendar · Money · Pod`, each `flex-1` (equal width). The round button overlays/centres on **its own slot** (not the viewport centre) so spacing stays even and the layout is correct whether 5 tabs show or 4 (when the Money tab is hidden for members without finance permissions).
3. **Slight peek + on-brand styling.** The circle lifts ~14–16px above the bar's top edge; its "Calendar" label sits on the **same baseline** as the sibling tab labels. Fully round (`rounded-full`), Heritage-Orange fill, white ring, soft shadow — matching the mockup but conformed to the beanies theme/CIG (see Approach → Styling).
4. **Planning stack loses Activities.** After the move, the Planning popout shows only Travel + To-do.
5. **No new badge.** The Calendar button ships without a count/attention badge. `useNavBadges` is touched only to keep its category Record type-exhaustive (`calendar: false`).
6. **No regressions.** Money-hidden case still works (now 4 tabs with Calendar still centred over its slot); the QuickAdd FAB (bottom-right) does not collide with the center button; dark mode + reduced-motion respected; all existing nav state-machine behaviour (open/close/swap/route-close/perms-close) unchanged.
7. **Theme doc + i18n in sync.** Update the theme skill's bottom-tab-bar spec to describe the shipped layout; add the `mobile.calendar` string (en + beanie); remove the now-dead `mobileNav.hint.activities` string + mapping; regenerate zh.
8. **No silent failures.** All new code paths log with a `[MobileBottomNav]`/`[navigation]` prefix on failure (consistent with the existing components); the module-load invariants in `navigation.ts` continue to guard misconfiguration.

## Important Notes & Caveats

- **The round shape is intentional and on-brand.** The beanies theme's general rule is "squircle 24px+ corners, never sharp" — but **fully-round circles are an established, separate pattern** for bean/FAB elements: `MobileNavBeanStack .jar-bean` (`border-radius: 9999px`) and `QuickAddFab .fab` (`border-radius: 9999px`) are both circles. The center Calendar button is a bean/FAB-class element, so `rounded-full` is correct and consistent — not a violation.
- **Theme/CIG wins over the mockup on specifics.** Where the mockup and the beanies theme/CIG differ, the theme wins:
  - **Label font size:** the mockup used ~10.5px; the theme mandates **minimum `text-xs` (12px)** and the existing tab labels use `text-xs font-semibold font-outfit`. → The Calendar label uses **`text-xs font-semibold font-outfit`**, identical to its siblings.
  - **Gradient colours:** the mockup used ad-hoc oranges (`#ff7a45`/`#e0521b`). → Use the **documented brand gradient partners — Heritage Orange `#F15D22` → Terracotta `#E67E22`** (Terracotta is the CIG's named "gradient partner"). Implemented in scoped CSS using brand hex values, the same way `MobileNavBeanStack` uses literal `#f15d22` in its scoped styles.
  - **Emoji size:** match the existing bean's 22px emoji-in-circle (the closest precedent for a 46px circle), using the same documented stylelint opt-out comment the bean uses.
- **Center button must centre on its own slot, never `left: 50%` of the nav.** When Money is hidden there are 4 tabs and Calendar is the 3rd of 4 (not the viewport centre). Anchoring the circle and its notch **inside the Calendar `<button>`** (centred within that flex slot) makes the layout robust to both 5- and 4-tab cases automatically. Do **not** position the hero or notch against the nav's 50%.
- **FAB coexistence.** `QuickAddFab` is `position: fixed; right: 16px; bottom: calc(safe + 92px); z-index: 40`. The center button is centred (its own slot) and peeks ~14–16px above the ~56px bar (well below the FAB's 92px offset). Center-x vs right-16px → no horizontal overlap; the ~15px peak sits below the FAB → no vertical overlap. No collision; no FAB changes needed.
- **`registerType`/SW, sync, encryption — untouched.** This is a pure nav/UI change.
- **Desktop sidebar untouched.** Activities stays under the Treehouse section on desktop. Only the mobile derivation changes.
- **Leaf generalization, not a nook special-case.** Both Nook and Calendar are leaves (navigate directly, no stack). Generalize the existing nook-only branches (`onTabClick`, `buildMobileNavCategories`) to a small leaf-set / `rootPath` check rather than adding a second hard-coded id branch — keeps the state machine DRY.

## Assumptions

> **Review before implementation (valid 2026-05-20).**

1. `MobileBottomNav` is mounted mobile-only (`App.vue:1587`, `v-if="isMobile"`) — desktop and desktop E2E are unaffected. (Confirmed.)
2. The only place `/activities` is wired into a _mobile stack_ is `mobileCategory: 'planning'` on the Activities `NAV_ITEM` (`navigation.ts:72-77`) + the `HINT_KEY_BY_PATH['/activities']` mapping (`navigation.ts:310`). Moving it to a `calendar` leaf removes the need for that hint. (Confirmed.)
3. `mobileNav.hint.activities` (`uiStrings.ts:4629`) is referenced **only** by `HINT_KEY_BY_PATH['/activities']` — removing both is safe. (Confirmed via grep: 2 refs total, both being removed.)
4. Tab-emoji "warmth" convention (theme line 555) allows the 📅 emoji on the orange circle; no custom SVG needed (matches the mockup + the bean/tab emoji convention).
5. No Help Center article documents the bottom-nav path or instructs "tap Planning → Activities", so no help-doc update is required. (Confirmed via grep of `src/content/help/`.)
6. Color/utility tokens used (`text-primary-500`, `bg-[rgba(241,93,34,0.08)]`, `text-secondary-500/40`, `font-outfit`, `text-xs`, `rounded-full`) all already exist and are used by the current nav.

## Approach

### A. `src/constants/navigation.ts` — add a `calendar` leaf category (the registry is the single source of truth)

1. Extend the id union: `export type MobileCategoryId = 'nook' | 'planning' | 'money' | 'pod' | 'calendar';`
2. Declare leaf categories **once**, and derive BOTH the runtime set and the `StackableCategoryId` type from that single tuple — no hand-synced mirror:
   ```ts
   /** The ONE source of truth for which categories are leaves (navigate
    *  directly, no bean stack). Both the runtime set and the stackable type
    *  derive from this tuple, so adding/removing a leaf is a one-line edit. */
   const LEAF_CATEGORY_IDS = ['nook', 'calendar'] as const;
   type LeafCategoryId = (typeof LEAF_CATEGORY_IDS)[number];
   export type StackableCategoryId = Exclude<MobileCategoryId, LeafCategoryId>;
   const LEAF_ID_SET: ReadonlySet<MobileCategoryId> = new Set(LEAF_CATEGORY_IDS);
   ```
   Downstream, "is-leaf" is detected **only** via the derived `rootPath` presence (which `buildMobileNavCategories` sets iff `LEAF_ID_SET.has(id)`) — the component never re-imports the set, avoiding two divergent leaf definitions. (`isCategoryActive` already keys off `rootPath`, `MobileBottomNav.vue:68`.)
3. Retag the Activities item: `mobileCategory: 'calendar'` (was `'planning'`) on the `nav.activities` `NAV_ITEM` (lines 72-77).
4. Insert calendar into the display order, centred: `const CATEGORY_ORDER: MobileCategoryId[] = ['nook', 'planning', 'calendar', 'money', 'pod'];`
5. Add `CATEGORY_META.calendar = { labelKey: 'mobile.calendar', emoji: '\u{1F4C5}' }`.
6. Generalize the leaf branch in `buildMobileNavCategories`: replace `if (id === 'nook')` with `if (LEAF_ID_SET.has(id))`, and generalize its error message from the hard-coded `"nook"` to the interpolated `${id}` (so a future leaf with no tagged route reports correctly). Both Nook (`/nook`) and Calendar (`/activities`) resolve their `rootPath` from the first tagged route — the existing code path, now shared.
7. Remove `HINT_KEY_BY_PATH['/activities']` (dead once Activities is a leaf — leaves never need hint keys).
8. **Sync the now-stale header comments** so they don't re-teach the nook-only special-case this change removes: the doc comment at `navigation.ts:13` ("`'nook'` is a leaf") and the "Nook is a single-tap leaf" notes (~lines 20-21, ~297) → reword to "leaves (Nook, Calendar) navigate directly; the others open a bean stack." (Stale comments are the real maintenance hazard here — the `collectTaggedRoutes` → `buildMobileNavCategories` derivation already auto-picks up tagged routes, so the only manual touch-points for any new category remain the id union + `CATEGORY_ORDER` + `CATEGORY_META`.)

> Net effect: `MOBILE_NAV_CATEGORIES` now yields 5 categories — `nook` (leaf), `planning` (stack: Travel + To-do), `calendar` (leaf → `/activities`), `money` (stack), `pod` (stack). The module-load invariants (badge keys, hint keys for stack items) continue to guard correctness.

### B. `src/components/common/MobileBottomNav.vue` — render the center hero, generalize leaf taps

1. `tabRefs` init object: add `calendar: null`.
2. `onTabClick`: **replace** (delete — do not augment) the current nook-specific branch (`MobileBottomNav.vue:87-92`) with a single `rootPath` check that covers all leaves:
   ```ts
   // Leaf categories (Nook, Calendar) navigate directly and never open a stack.
   if (cat.rootPath) {
     closeStack();
     navigate(cat.rootPath);
     return;
   }
   ```
   (Only leaves carry `rootPath`; stackables carry `items`.) The subsequent defensive branch (`if (!cat.items || cat.items.length === 0) console.warn(...)`, `MobileBottomNav.vue:94-98`) and the stackable open/close/swap logic are **unchanged** — no new silent-failure surface is introduced. **Ordering matters:** the `if (cat.rootPath)` leaf branch MUST stay above the `!cat.items` defensive warn (leaves legitimately have no `items`, so a reorder would log a false "misconfigured" warning on every Calendar/Nook tap) — note this inline in the code so a future edit doesn't swap them.
3. Template — the `v-for` over `visibleTabs` stays (so Calendar occupies a real, evenly-distributed `flex-1` slot in DOM order). Inside the shared `<button>`, branch the inner content:
   - **`v-if="cat.id === 'calendar'"`** → the center hero: a round `.calendar-hero` element containing the 📅 emoji, plus the "Calendar" label in the standard label position (so it shares the sibling baseline). The hero is centred within the button and raised to peek above the bar; a notch pseudo-element seats it. No active-dot, no attention badge (leaf, no badge).
   - **`v-else`** → the existing standard markup (active dot for stackables, attention badge, emoji, label) — **unchanged**.
   - The outer `<button>` keeps `class="flex min-h-14 flex-1 ..."`, `:aria-label="t(cat.labelKey)"`, and `@click="onTabClick(cat)"`. For the calendar leaf, `aria-haspopup`/`aria-expanded`/`aria-controls` are `undefined` (it has no `items`), exactly like Nook.
   - `isCategoryActive(cat)` already handles `rootPath` leaves → the Calendar label shows the active colour when on `/activities`.

   > A single `<button>` with a branched inner keeps the click-path, accessibility wiring, and even-distribution all DRY. A separate sub-component is unnecessary for one use (YAGNI); the hero's presentation lives in scoped CSS.

4. Scoped `<style>` additions (using the existing component's scoped-style approach + brand hex, mirroring `MobileNavBeanStack`):
   - `.calendar-hero`: `border-radius: 9999px; width: 46px; height: 46px;` Heritage-Orange→Terracotta gradient (`linear-gradient(155deg, #f15d22 0%, #e67e22 100%)`); 3px ring in the **nav surface colour** (white light / slate-900 dark — match the nav's own `bg-white dark:bg-slate-900`, `MobileBottomNav.vue:163`; do **not** reflexively copy `MobileNavBeanStack`'s dark bean fill `rgb(36 51 66)`, which is a different token and would make the ring fail to "seat" in dark mode) so it reads as seated in the bar; soft brand shadow (`0 10px 18px -8px rgb(241 93 34 / 60%)`, plus a subtle inset highlight); 📅 emoji centred at 22px (with the same stylelint opt-out comment the bean uses); centred horizontally within the button and raised so ~14–16px peeks above the bar's top edge while the label keeps the sibling baseline.
   - Notch: a pseudo-element anchored to the **calendar button** (centred within its slot), filled with the nav surface colour, that softly cups the bottom of the circle. Light: white; dark (`:global(.dark)`): slate-900. Lowest-priority polish — if dark-mode seating proves finicky, the 3px ring alone already separates the circle and the notch may be dropped.
   - `.calendar-hero` hover/active micro-interaction (`translateY(-2px)` hover, `scale(0.96)` active), wrapped in `@media (prefers-reduced-motion: reduce)` to disable — same convention as `QuickAddFab`.
   - Label: reuse the sibling label classes (`font-outfit text-xs font-semibold`), Heritage-Orange (the center button is a permanent CTA, so its label is always orange).

### C. `src/composables/useNavBadges.ts` — keep the category Record exhaustive

The `categoryAttention` result is a `Record<MobileCategoryId, boolean>`; the union now includes `calendar`, so add `calendar: false` to the initializer object (one line — the `Record` type already forces this at compile time, so it cannot be silently forgotten). `/activities` carries no `badgeKey`, so Calendar never escalates. No other badge logic changes. _(Optional sustainability nicety, implementer's call: the initializer could instead be derived — `Object.fromEntries(CATEGORY_ORDER.map((id) => [id, false])) as Record<MobileCategoryId, boolean>` — so a future category needs no manual edit here. Not required; the compiler already guards correctness.)_

### D. `src/services/translation/uiStrings.ts` — strings

- Add (next to the other `mobile.*` labels, ~line 4621): `'mobile.calendar': { en: 'Calendar', beanie: 'calendar' }`.
- Remove the now-dead `'mobileNav.hint.activities'` (line 4629).
- Run `npm run translate` to regenerate `public/translations/zh.json`; confirm the parser still succeeds.

### E. `.claude/skills/beanies-theme/SKILL.md` — sync the bottom-tab-bar spec (theme is the source of truth)

Update the stale line 555 ("Five tabs — 🏡 Nook, 📅 Planner, 🐷 Piggy Bank, 📋 Budget, 👨‍👩‍👦 Pod.") to describe the **shipped** layout:

> **Bottom Tab Bar:** Five evenly-distributed slots — 🏡 Nook · 🌳 Planning · 📅 **Calendar** · 🐷 Money · 👨‍👩‍👦 Pod. Nook and Calendar are one-tap leaves (Calendar → the Family Planner / `/activities`); Planning, Money, and Pod open a `MobileNavBeanStack` popout. **Calendar** is a raised, round Heritage-Orange button (Heritage Orange→Terracotta gradient, white ring, ~15px peek above the bar) — a permanent one-tap shortcut to the family calendar. Active tab uses the Heritage-Orange tint; icons are emoji-style for warmth.

### F. Docs

- `CHANGELOG.md` — under today's date, **Changed**: "Mobile bottom nav: the family calendar is now a one-tap **Calendar** button in the centre of the bar (previously two taps under Planning)."
- `docs/STATUS.md` — note the nav change in the latest session entry.

## Files Affected

- `src/constants/navigation.ts` — `calendar` leaf category: id union, `LEAF_CATEGORY_IDS` tuple → derived `StackableCategoryId` type + `LEAF_ID_SET`, retag Activities, `CATEGORY_ORDER`, `CATEGORY_META`, generalize the leaf branch + error message in `buildMobileNavCategories`, drop `HINT_KEY_BY_PATH['/activities']`, and sync the stale "nook is a leaf" header/inline comments to "leaves (Nook, Calendar)".
- `src/components/common/MobileBottomNav.vue` — `tabRefs.calendar`, generalize `onTabClick` leaf branch, branch the template inner for the calendar hero, scoped CSS for `.calendar-hero` + notch + reduced-motion.
- `src/composables/useNavBadges.ts` — add `calendar: false` to the `categoryAttention` initializer.
- `src/services/translation/uiStrings.ts` — add `mobile.calendar`; remove `mobileNav.hint.activities`.
- `public/translations/zh.json` — regenerated via `npm run translate`.
- `.claude/skills/beanies-theme/SKILL.md` — update the bottom-tab-bar spec (line ~555).
- `src/constants/__tests__/navigation.test.ts` — assert the calendar leaf (rootPath `/activities`, no items); order includes calendar between planning and money. **Also update the two hard-coded assertions that this change breaks:** the total-stack-items count (15 → 14, since Activities leaves the Planning stack) — **and reword that test's now-stale `it(...)` title** (currently `'total stack items = 15 …'`) so the name matches the new count — and the "Planning has Activities, To-do, Travel" case → repoint it to assert `planning.items` paths === `['/travel', '/todo']` (Activities removed).
- `src/components/common/__tests__/MobileBottomNav.test.ts` — update tab count 4→5 and money-hidden 3→4; update the order assertion to include `mobile.calendar` between planning and money; fix button indices (money `[2]→[3]`, pod `[3]→[4]`); add: Calendar tab (`[2]`) tap → `router.push('/activities')`, no stack opens; add `calendar: false` to the `mockCategoryAttention` reset object; **add a regression lock** that the hero markup renders **inside** the Calendar `<button>` (its own slot — assert the `.calendar-hero` element is a descendant of the calendar tab button, not the `<nav>` root) so a future refactor can't silently reintroduce viewport-centering.
- `src/composables/__tests__/useNavBadges.test.ts` — **mandatory** (not conditional): the `categoryAttention` test uses an exhaustive `.toEqual({ nook, planning, money, pod })`; add `calendar: false` to that object or the deep-equal fails once `calendar` joins the union.

## Acceptance Criteria

- [ ] Mobile bottom nav shows five evenly-distributed slots: Nook · Planning · **Calendar** · Money · Pod, with Calendar a raised round Heritage-Orange button in the centre slot.
- [ ] One tap on Calendar navigates to `/activities`; it never opens a popout.
- [ ] The Planning popout now contains only Travel + To-do.
- [ ] When the Money tab is hidden (no finance perms), the bar shows four even slots and Calendar still centres correctly on its own slot (not viewport centre).
- [ ] The Calendar label uses `text-xs font-semibold font-outfit` (≥12px, theme-compliant) and sits on the same baseline as sibling labels; the circle is `rounded-full` with the Heritage Orange→Terracotta brand gradient and a white/slate ring.
- [ ] The QuickAdd FAB does not visually collide with the center button; dark mode and reduced-motion render correctly.
- [ ] `mobile.calendar` exists in `en` + `beanie`; `mobileNav.hint.activities` removed and unreferenced; `npm run translate` regenerates zh cleanly.
- [ ] The theme skill's bottom-tab-bar spec matches the shipped layout.
- [ ] Updated unit tests pass (navigation, MobileBottomNav, useNavBadges); `npm run validate` green (type-check + lint + format + unit + build).

## Testing Plan

1. **Unit:**
   - `navigation.test.ts`: `MOBILE_NAV_CATEGORIES` has 5 entries in order `nook, planning, calendar, money, pod`; `calendar` has `rootPath === '/activities'` and no `items`; `planning.items` paths are exactly `['/travel', '/todo']`; module loads without throwing (invariants intact).
   - `MobileBottomNav.test.ts`: 5 tabs (4 when finance off); order includes `mobile.calendar` between planning and money; Calendar tap → `router.push('/activities')` with no stack; existing state-machine tests still pass with corrected indices.
   - `useNavBadges.test.ts`: `categoryAttention.calendar === false`.
2. **Manual (the real proof) — `npm run dev`, mobile viewport / device:**
   - Five even slots; Calendar centred, round, peeking ~15px; label baseline aligned.
   - One tap → `/activities`. Active styling shows when on the calendar.
   - Planning popout = Travel + To-do only.
   - Toggle a member without finance perms → 4 slots, Calendar still centred over its slot.
   - FAB present, no collision. Dark mode + "reduce motion" both correct.
   - Beanie mode: label reads "calendar" (lowercase).
3. **Type-size mode:** with Large reading mode on, the label scales (rem-based `text-xs`) without breaking the bar.
4. `npm run validate` green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the implementation — `calendar` leaf category in the nav registry (generalizing the nook-only leaf branches), a branched center-hero render in `MobileBottomNav` (single shared button, scoped-CSS round Heritage-Orange→Terracotta hero centred on its own slot, ~15px peek, notch, reduced-motion), `mobile.calendar` string + removal of the dead `mobileNav.hint.activities`, `useNavBadges` Record completeness, theme-doc sync, and the unit-test updates. Captured theme-wins overrides (label `text-xs`, brand gradient, round-is-on-brand precedent) and the money-hidden centring caveat.
- **Pass 2 (DRY + error handling)**: Caught two hard-coded test assertions the change breaks (navigation total-stack-items 15→14 + the Planning-items case; useNavBadges exhaustive `.toEqual` needs `calendar: false`) and upgraded both from vague to mandatory. Consolidated the leaf mechanism to a single source of truth — `LEAF_CATEGORY_IDS` declares leaves; downstream detects leaf purely via the derived `rootPath`, so there are no two divergent leaf definitions. Confirmed the CSS `@media` reduced-motion approach (over the JS composable), the replace-not-augment `onTabClick` branch, and that no new silent-failure path is introduced (defensive warn + module-load throw intact).
- **Pass 3 (Sustainability)**: Removed the hand-synced maintainability trap — `LEAF_CATEGORY_IDS` is now a single `as const` tuple that derives BOTH `StackableCategoryId` (type) and `LEAF_ID_SET` (runtime), so a leaf change is one line with no mirror to keep in sync. Added two cheap regression locks (leaf branch must precede the `!cat.items` warn — noted inline; a test that the hero renders inside the Calendar `<button>` slot, not the nav root) and a doc-sync of the stale "nook is a leaf" comments. Confirmed keeping the branched `v-if/v-else` (no sub-component — YAGNI) and noted an optional derive-from-`CATEGORY_ORDER` for the `categoryAttention` initializer.
- **Pass 4 (Fresh-eyes sweep)**: Verified every load-bearing claim against the code and confirmed the plan is correct and bug-free — module-load invariants survive `/activities` becoming a badge-less, hint-less `calendar` leaf (nothing throws); the generalized leaf branch resolves `rootPath` for both leaves; all hard-coded id sites (`tabRefs`, `categoryAttention`, the three test mocks) are covered; ARIA stays `undefined` on the leaf like Nook; desktop sidebar (uses `TREEHOUSE_ITEMS` by `section`) and the desktop-only E2E (`page.goto('/activities')`) are unaffected; FAB non-collision math holds. Folded in two polish fixes: reword the stale `'total stack items = 15'` test title, and seat the dark-mode ring/notch against the nav's `slate-900` (not the bean's `rgb(36 51 66)`).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Design exploration (`/frontend-design`, lead-in to this plan)

> I wanted to propose a small change to the navbar to make it more useful. A few weeks ago we updated the navbar design to the popout approach where divided into plans, money, and family. This requires 2 taps to reach any given item (except nook) but the trade-off was accepted to simplify the nav bar. However, currently there are only 4 items in the nav bar, and I think we can leverage the space in the middle for a single, most commonly used view that can be reached with just one tap. My suggestion is to put the activities / planner view in a dedicated spot in the middle of the nav bar in a prominent manner. Since the app is focused around planning and productivity, i think it makes sense to promote this view as a one tap shortcut in the middle of the nav bar. what are your thoughts and how might this look?

### Refinement 1 (raise + shape + distribution)

> Looks better. i like the orange gradient background highlight, but on option (a) i feel the popout is too much (too far above the navbar) and for (b) not enough (entirely within the navbar). Could we find a middle-ground between those two that only peeks only slightly from above the navbar? This would also create less conflict with the FAB. My other thought was that rather than a square-ish (or squircle) button, it may look better if it is even more rounded, and that could also save space. The other items should be evenly distributed across the navbar.

### Refinement 2 (label naming)

> Looks better. For the item titles, at the moment they are "nook", "planning", "money" and "family". it might be strange to add "planner" right next to "planning" - is there another concise and descriptive set of terms we can use without sounding redundant in the nav bar?

(Decision: center label = **Calendar** — keep Nook / Planning / Money / Pod.)

### Plan request (this plan, `/beanies-plan`)

> Let's make a plan to implement this mockup. As always, strive for simplicity and elegance in both the plan and the implementation, and remember to always follow all DRY conventions. Review the mockup carefully and ensure you are faithfully representing and reproducing the carefully cultivated design, tone, and overall theme of the mockup, while at the same time strictly following the rules of the beanies theme and UI skill in terms of all relevant elements including colors, styles, layouts, font sizes, etc. If there is a discrepancy between the mockup and the beanies UI theme and CIG, the beanies UI theme / CIG always wins. Ask any clarifying questions as needed before preparing the plan. Once all requirements are clear, prepare the plan.

### Clarifying answers

> Today badge: **Ship clean, no badge.** · 5th tab label: **Keep "Pod".**

</details>
