# Plan: Milestones feature + Family Scrapbook add-button

> Date: 2026-05-07 (v3 — sustainability / reliability review pass)

## TL;DR

- New `Milestone` content type: `{ memberId | null, category, title, occurredOn (date-only ISO), description?, photoIds?[] }`. Per-bean by default; `memberId: null` is the family-wide presentation key.
- Three surfaces: (a) per-bean tab on `BeanDetailPage`, (b) integrated into the existing Family Scrapbook feed with a new chip filter, (c) new `/pod/timeline` chronological page.
- FAB integration: one new entry in `QUICK_ADD_ITEMS`; existing `QuickAddMemberPicker` handles bean selection.
- Family Scrapbook gains a header `+` button that calls `openQuickAdd({ filter: [...] })` — a one-arg extension to the existing global singleton, no new sheet instance.
- 18 curated brand-voiced categories (single source of truth: `MILESTONE_CATEGORIES`).
- Silent-failure paths (corrupt dates, deleted-bean references, missing categories, repo load errors) classified + reported via `reportError`; UI degrades gracefully in every case.

## Context

Two related additions to the family pod surface:

1. **Milestones** — a new content type for one-off life events (lost a tooth, first day of school, graduation, wedding, new home, etc.), per-bean by default with an optional family-wide toggle. Photos optional.
2. **Family Scrapbook add-button** — `/pod/scrapbook` is currently read-only. Add a header `+` button that opens the existing `QuickAddSheet` flow filtered to scrapbook-relevant items.

**Greg-confirmed decisions** (Q&A 2026-05-07):

- Per-member with family-wide toggle (no second-bean shared field)
- Curated brand-voiced single suggestions list, no age-gating
- Surface in **both** the existing scrapbook feed **and** a new `/pod/timeline` chronological page
- Scrapbook redesign scope: add-button only (no in-place edit, no visual revamp)

**Implicit decisions** (called out, no pushback):

- Date is required, defaults to today (date-anchored is the point of a milestone)
- Family-wide toggle lives in the form, not the picker (keeps `QuickAddMemberPicker` simple)
- Milestone goes into the FAB as well as the scrapbook + timeline (greg's reminder; §5)

**UX trade-off accepted:** when a user opens the FAB → picks Milestone → picks a bean → form opens → flips "this is a family moment" ON, the picker step's bean choice is discarded (`memberId` becomes `null`). The wasted picker tap is the cost of keeping `QuickAddMemberPicker` reusable across all flows. Worth it.

## Approach

### 1. Data model + store

**`src/types/models.ts`** — new interface + category union:

```ts
export type MilestoneCategory =
  | 'birthday'
  | 'lost_tooth'
  | 'first_word'
  | 'first_step'
  | 'first_day_school'
  | 'graduation'
  | 'big_test'
  | 'recital'
  | 'big_win'
  | 'new_home'
  | 'new_job'
  | 'new_pet'
  | 'new_little_bean'
  | 'wedding'
  | 'anniversary'
  | 'big_trip'
  | 'license'
  | 'custom';

export interface Milestone {
  id: UUID;
  /** null = family-wide; non-null = single bean owner. */
  memberId: UUID | null;
  category: MilestoneCategory;
  title: string;
  /**
   * Date-only ISO string (YYYY-MM-DD). No time component — milestones
   * are day-anchored. Sorted lexically (ISO dates sort correctly as
   * strings). Don't store as a full datetime; timezone shifts could
   * silently move a milestone to the wrong day.
   */
  occurredOn: ISODateString;
  description?: string;
  photoIds?: UUID[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
```

**`src/services/automerge/repositories/milestonesRepository.ts`** — repository layer mirrors `medicationsRepository.ts`. **Fresh-doc behavior:** when an Automerge doc has no `milestones` collection (first run, or a newly-imported pre-feature doc), the repo's `load()` returns `[]`. Same lazy-init pattern as `medicationsRepository`.

**`src/stores/milestonesStore.ts`** — Pinia store mirrors `medicationsStore.ts`. Includes `add` / `update` / `remove` / `getByMember` / `getAll`. Every operation wraps Automerge mutation in `try/catch` and reports via `reportError({ surface: 'milestonesStore' })` + toast.

**Runtime defense for unknown categories.** When reading milestones (in computeds / getters), if an item's `category` isn't in `MILESTONE_CATEGORIES` (future schema drift, manually-edited docs), fall back to `'custom'` for rendering AND `reportError({ surface: 'milestonesStore', message: 'unknown milestone category' })` once per session per category. Data is preserved on disk; only the runtime presentation degrades.

**`src/App.vue`** — register the photo collection (one line, alongside existing collections):

```ts
photoStoreInternals.registerPhotoCollection('milestones');
```

### 2. Curated suggestion list (single source of truth)

**`src/constants/milestoneCategories.ts`** — same `as const satisfies` pattern as `quickAddItems.ts`. The `MilestoneCategory` type union is **derived from** this constant via `(typeof MILESTONE_CATEGORIES)[number]['id']`, so type drift is impossible by construction (no lint rule needed — TypeScript guarantees alignment).

```ts
export const MILESTONE_CATEGORIES = [
  { id: 'birthday', emoji: '\u{1F382}', titleKey: 'milestone.cat.birthday' },
  { id: 'lost_tooth', emoji: '\u{1F9B7}', titleKey: 'milestone.cat.lostTooth' },
  { id: 'first_word', emoji: '\u{1F4AC}', titleKey: 'milestone.cat.firstWord' },
  { id: 'first_step', emoji: '\u{1F463}', titleKey: 'milestone.cat.firstStep' },
  { id: 'first_day_school', emoji: '\u{1F392}', titleKey: 'milestone.cat.firstDaySchool' },
  { id: 'graduation', emoji: '\u{1F393}', titleKey: 'milestone.cat.graduation' },
  { id: 'big_test', emoji: '\u{270F}\u{FE0F}', titleKey: 'milestone.cat.bigTest' },
  { id: 'recital', emoji: '\u{1F3B5}', titleKey: 'milestone.cat.recital' },
  { id: 'big_win', emoji: '\u{1F3C6}', titleKey: 'milestone.cat.bigWin' },
  { id: 'new_home', emoji: '\u{1F3E1}', titleKey: 'milestone.cat.newHome' },
  { id: 'new_job', emoji: '\u{1F4BC}', titleKey: 'milestone.cat.newJob' },
  { id: 'new_pet', emoji: '\u{1F43E}', titleKey: 'milestone.cat.newPet' },
  { id: 'new_little_bean', emoji: '\u{1F476}', titleKey: 'milestone.cat.newLittleBean' },
  { id: 'wedding', emoji: '\u{1F48D}', titleKey: 'milestone.cat.wedding' },
  { id: 'anniversary', emoji: '\u{1F495}', titleKey: 'milestone.cat.anniversary' },
  { id: 'big_trip', emoji: '\u{1F6EB}', titleKey: 'milestone.cat.bigTrip' },
  { id: 'license', emoji: '\u{1F697}', titleKey: 'milestone.cat.license' },
  { id: 'custom', emoji: '\u{2728}', titleKey: 'milestone.cat.custom' },
] as const satisfies readonly MilestoneCategoryShape[];

export type MilestoneCategory = (typeof MILESTONE_CATEGORIES)[number]['id'];
```

One edit propagates everywhere: TypeScript union, picker grid, timeline filter chips, scrapbook chip filter, default title fill-in, i18n key references.

### 3. Per-bean tab — `BeanMilestonesTab`

**`src/components/pod/BeanMilestonesTab.vue`** — reuses the **scaffold pattern** (imports / store call / list-render / modal-open) from `BeanSayingsTab.vue`. Visual treatment is milestone-specific (date stamp + category emoji + optional photo thumb). Reuses:

- `<EmptyState>` (`src/components/pod/shared/EmptyState.vue`) for the zero-state
- The existing `BeanDetailPage` tab-route plumbing (no router changes beyond registering a new tab name)

Wired into `BeanDetailPage.vue` between Notes and the Photos placeholder.

### 4. Form modal — `MilestoneFormModal`

**`src/components/pod/MilestoneFormModal.vue`** — uses `BeanieFormModal` (three-tier modal system per `.claude/skills/beanies-theme/SKILL.md`). Fields:

1. **Category picker** — `<GroupedChipPicker :groups :model-value>` (the same generic primitive `ActivityCategoryPicker.vue` already wraps in 41 lines). One group containing all 18 categories. **No new picker component.**
2. **Title** — text input, required. **Auto-fill rule (simplified from v2): only auto-fill when title is empty.** No "matches previous default" logic. Picking a new category never overwrites a non-empty title — preserves user input deterministically.
3. **Date** — date input (`<input type="date">`), required, defaults to today. No upper bound. **Explicit validity check on submit:** `Number.isFinite(Date.parse(value))` — don't rely on assumed `BeanieFormModal` validation; if invalid, show inline error and block save.
4. **Family-wide toggle** — `<BaseToggle>` with `t('milestone.familyWide.label')`. When on: `memberId = null`, the bean-assignment hint hides. When off: bean stays as pre-assigned.
5. **Description** — `<textarea>`, optional.
6. **Photos** — `<PhotoAttachments collection="milestones" :entity-id>`, optional, multiple.

**Failure handling:** save wraps `milestonesStore.add` / `update` in `try/catch`; catches surface `t('error.milestoneSaveFailed')` + help text "your milestone wasn't saved — check connection and try again" plus `reportError({ surface: 'MilestoneFormModal' })`. Validation blocks invalid title + invalid date inline (not silent rejects).

### 5. FAB integration

**`src/constants/quickAddItems.ts`** — one new entry in `QUICK_ADD_ITEMS`:

```ts
{
  id: 'milestone',
  group: 'family',
  order: <last-in-family + 1>,
  emoji: '\u{1F31F}', // 🌟
  labelKey: 'quickAdd.milestone.label',
  hintKey: 'quickAdd.milestone.hint',
  route: '/pod/timeline',
  action: 'add-milestone',
  contextKey: 'memberId',
  requiredPermission: 'activities',
}
```

The existing `QuickAddMemberPicker` handles the bean-pick step (auto-skipping for single-member families). Family-wide milestones flip the form's toggle after the picker.

### 6. `useQuickAdd` filter extension (replaces v2's `:filter` prop)

**`src/composables/useQuickAdd.ts`** — extend the existing global singleton with an optional, type-checked filter:

```ts
const allowedActions = ref<readonly QuickAddAction[] | null>(null);

export function openQuickAdd(options?: { filter?: readonly QuickAddAction[] }): void {
  if (hasOpenOverlays()) return;

  const filter = options?.filter;
  if (filter !== undefined) {
    if (filter.length === 0) {
      // Caller bug — empty filter would render an empty sheet. In dev,
      // surface loudly so the call site is fixed; in prod, fall back to
      // no filter so the user still gets a usable sheet.
      if (import.meta.env.DEV) {
        console.error(
          '[useQuickAdd] openQuickAdd called with empty filter — falling back to no filter'
        );
      }
      reportError({
        surface: 'useQuickAdd',
        message: 'openQuickAdd called with empty filter',
      });
      allowedActions.value = null;
    } else {
      // Dev-only typo guard. Filter is typed against QuickAddAction so most
      // typos fail at compile; this catches dynamically-built filters.
      if (import.meta.env.DEV) {
        const valid = new Set(QUICK_ADD_ITEMS.map((i) => i.action));
        const unknown = filter.filter((a) => !valid.has(a));
        if (unknown.length > 0) {
          console.warn('[useQuickAdd] filter contains unknown actions:', unknown);
        }
      }
      allowedActions.value = filter;
    }
  } else {
    allowedActions.value = null;
  }

  stage.value = { mode: 'main' };
  isOpen.value = true;
  pushSheetHistoryMarker();
}
```

`closeQuickAdd()` resets `allowedActions.value = null`. The filter never survives a sheet close.

**`src/components/common/QuickAddSheet.vue`** — read `allowedActions` from the singleton and skip non-matching items in the existing render loop. ~3 lines.

**`src/pages/FamilyScrapbookPage.vue`** — header `+` button. Tap → `openQuickAdd({ filter: ['add-saying', 'add-favorite', 'add-note', 'add-milestone'] })`. That's the entire integration. Same path the FAB uses — single sheet instance, single keyboard handler, single state machine.

### 7. Scrapbook feed extension

**`src/utils/date.ts`** — add a small util reused by both feed and timeline (DRY):

```ts
/**
 * Returns the parsed `occurredOn` of a milestone, or a fallback if the
 * stored value is malformed. Logs + reports the dangling item once per
 * call site so support can find the bad data without breaking the UI.
 */
export function safeOccurredOn(
  occurredOn: string,
  fallback: string,
  context: { surface: string; itemId: string }
): string {
  const parsed = Date.parse(occurredOn);
  if (Number.isFinite(parsed)) return occurredOn;
  console.warn(`[${context.surface}] invalid occurredOn:`, context.itemId, occurredOn);
  reportError({
    surface: context.surface,
    message: 'invalid occurredOn date',
    context: { itemId: context.itemId, occurredOn },
  });
  return fallback;
}
```

**`src/composables/useScrapbookFeed.ts`** — add `milestonesStore.items` to the merged source list with type tag `'milestone'`. Sort key is `effectiveDate(item)`:

- For milestones: `safeOccurredOn(item.occurredOn, item.createdAt, { surface: 'useScrapbookFeed', itemId: item.id })`
- For other items: `item.createdAt`

**`src/pages/FamilyScrapbookPage.vue`** — add a 4th chip filter "Milestones" alongside Sayings/Favorites/Notes. Render milestones with a Heritage Orange date stamp + the category emoji (visual distinction from "memorabilia" items).

### 8. Family Timeline page

**`src/composables/useFamilyTimeline.ts`** — pulls all milestones, sorts by `safeOccurredOn(...)` descending, groups by year via `new Date(safeOccurredOn(...)).getFullYear()` in a single computed. Filter state:

- **Bean filter** — multi-select, beans only (no virtual "family" entry)
- **Family-wide toggle** — separate control: "include family-wide moments" (default: on). When off, hides milestones with `memberId === null`. Mirrors the natural mental model: pick the people, then optionally exclude family-level events.
- **Category filter** — multi-select against `MILESTONE_CATEGORIES`

**`src/pages/FamilyTimelinePage.vue`** — route `/pod/timeline`. Uses:

- `<EmptyState>` for zero data
- `<PhotoViewer>` for photo lightbox
- Sticky-year-header CSS pattern (`position: sticky; top: 0;` on year `<h2>` — pure CSS, no scroll listener)
- `<BeanAvatarPicker>` infrastructure for the bean filter (reuse, don't rebuild)
- Header `+` button → `openQuickAdd({ filter: ['add-milestone'] })`

For family-wide milestones (`memberId === null`), render a small "🏡 family" pill in place of the bean avatar. **No phantom "family" pseudo-bean object** — purely a presentation concern keyed off the null check.

**Failure handling:** if a milestone's `memberId` references a deleted bean, render an "unknown bean" placeholder + one-time `reportError({ surface: 'familyTimeline', message: 'milestone references deleted bean' })` per dangling ID. Data preserved; UI degrades gracefully.

**`src/router/index.ts`** — add `/pod/timeline`. **`src/constants/navigation.ts`** — Timeline entry under the Family group in the sidebar. **Mobile bottom-nav stays at 5 tabs** (Timeline reachable via Pods → Timeline).

### 9. Translations

**`src/services/translation/uiStrings.ts`** — adds:

- 18 category labels (each with `en` Title Case + `beanie` lowercase)
- ~15 form / page / chip / empty-state / error keys
- 2 FAB keys (`quickAdd.milestone.label` + `.hint`)
- 1 error key (`error.milestoneSaveFailed` + help text)

Total ~36 new keys. After edits: `npm run translate` to sync Chinese.

**Beanie-mode discipline** (per `feedback_beanie_mode_discipline.md`): every category title, chip label, button label, and empty-state copy goes through `t('key')`. Visual pass after impl confirms no Title Case leaks.

## Files affected

**Create (8 source + 4 tests + 1 util):**

- `src/types/models.ts` (modify, add `Milestone` interface)
- `src/stores/milestonesStore.ts`
- `src/services/automerge/repositories/milestonesRepository.ts`
- `src/constants/milestoneCategories.ts`
- `src/components/pod/BeanMilestonesTab.vue`
- `src/components/pod/MilestoneFormModal.vue`
- `src/composables/useFamilyTimeline.ts`
- `src/pages/FamilyTimelinePage.vue`
- `src/utils/date.ts` — extend with `safeOccurredOn` (file already exists)
- `src/stores/__tests__/milestonesStore.test.ts`
- `src/composables/__tests__/useFamilyTimeline.test.ts`
- `src/components/pod/__tests__/MilestoneFormModal.test.ts`
- `src/composables/__tests__/useScrapbookFeed.test.ts` (new or extend)

**Modify (10):**

- `src/App.vue` — `registerPhotoCollection('milestones')`
- `src/router/index.ts` — `/pod/timeline` route + tab
- `src/components/pod/BeanDetailPage.vue` — wire new tab
- `src/composables/useScrapbookFeed.ts` — milestone merge + `safeOccurredOn` use
- `src/composables/useQuickAdd.ts` — `filter` option, dev guards, empty-array fallback
- `src/components/common/QuickAddSheet.vue` — read + apply filter
- `src/pages/FamilyScrapbookPage.vue` — `+` button + new "Milestones" chip
- `src/constants/quickAddItems.ts` — `add-milestone` entry
- `src/constants/navigation.ts` — sidebar Timeline entry
- `src/services/translation/uiStrings.ts` — ~36 new keys

## Reuse — explicit DRY ledger

| Need                                                            | Reused from                                                                     | Why no new code                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sheet + member picker + intent flow                             | `useQuickAdd` global singleton + `QuickAddSheet` + `QuickAddMemberPicker`       | Mature; one new entry in `QUICK_ADD_ITEMS` + one optional arg on `openQuickAdd()`                                     |
| Cross-page sheet trigger                                        | `openQuickAdd({ filter })` from anywhere                                        | Single global instance, no remount, no prop drilling, filter is typed against `QuickAddAction`                        |
| Category picker UI                                              | `<GroupedChipPicker>` (also wraps 41-line `ActivityCategoryPicker`)             | Generic primitive — milestone picker is another thin wrapper                                                          |
| Form chrome + validation scaffolding                            | `BeanieFormModal` (three-tier modal system)                                     | Brand-mandated                                                                                                        |
| Photo collection                                                | `registerPhotoCollection` + `<PhotoAttachments>`                                | Identical pattern to medications/recipes/cookLogs                                                                     |
| Photo lightbox                                                  | `<PhotoViewer>`                                                                 | Already covers avatar / medication / recipe / scrapbook                                                               |
| Empty states                                                    | `<EmptyState>` (`pod/shared/EmptyState.vue`)                                    | Already the canonical empty-state component                                                                           |
| Bean avatar / picker                                            | `<BeanAvatarPicker>` infra                                                      | Existing                                                                                                              |
| Per-bean tab scaffold                                           | `BeanSayingsTab.vue` pattern                                                    | File scaffold reused; visual treatment is milestone-specific                                                          |
| Pinia store + repository pattern                                | Mirror `medicationsStore` + `medicationsRepository`                             | Closest analog with `photoIds`; copy + rename + retype                                                                |
| Cross-member feed                                               | `useScrapbookFeed` extension                                                    | Adds one source + one sort key via shared util                                                                        |
| Type-safe category list driving union + picker + filters + i18n | `MILESTONE_CATEGORIES as const satisfies` + `(typeof X)[number]['id']`          | Drift impossible by construction — TypeScript guarantees alignment                                                    |
| Year grouping on timeline                                       | Inline `new Date(d).getFullYear()` in computed                                  | One line; no util needed                                                                                              |
| Family-wide presentation                                        | `memberId === null` keyed inline                                                | No phantom pseudo-bean object needed                                                                                  |
| Scrapbook + button flow                                         | `openQuickAdd({ filter: [...] })`                                               | Same path the FAB uses                                                                                                |
| Sticky year headers                                             | CSS `position: sticky; top: 0;`                                                 | No JS, no scroll listener                                                                                             |
| Malformed-date handling                                         | New `safeOccurredOn(occurredOn, fallback, context)` util in `src/utils/date.ts` | Extracted because **two** consumers need it (scrapbook feed + timeline). Single place for the failure-handling logic. |

**No new abstraction layers introduced.** Considered + rejected:

- Generic `<ItemListTab>` for bean tabs → premature; each tab has different cards
- Generic `<EmojiCategoryPicker>` distinct from `GroupedChipPicker` → already exists as `GroupedChipPicker`
- `useConsolidationPage` composable → two consumers, ceremony layer
- Repository factory → premature; each repo has type-specific logic

## Silent-failure audit (per `feedback_no_silent_failures.md`)

Every potentially-failing path classified, prefixed, and reported. No bare `catch {}`. Tests assert each path explicitly.

| Path                                              | Failure mode                                                                          | Handling                                                                                                                               | Test coverage                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `milestonesStore.add` / `update` / `remove`       | Automerge mutation throws                                                             | `console.error` `[milestonesStore]`-prefix + `reportError` + `t('error.milestoneSaveFailed')` toast                                    | `milestonesStore.test.ts` mocks repo to throw; asserts `reportError` is called + state stays consistent |
| `milestonesRepository.load`                       | Doc parse / schema mismatch / fresh doc                                               | Repo returns `[]` on missing collection (lazy-init); on parse error: prefixed-log + `reportError` + return `[]` so app keeps rendering | `milestonesStore.test.ts` covers fresh-doc + corrupt-doc paths                                          |
| Milestone with unknown `category` value           | Future schema drift / manual edit                                                     | Falls back to `'custom'` for rendering + once-per-session `reportError` per unknown category                                           | `milestonesStore.test.ts` asserts fallback + report                                                     |
| `MilestoneFormModal` save                         | Catches store rejection (already handled above)                                       | Toast surfaces; modal stays open so user can retry                                                                                     | `MilestoneFormModal.test.ts` asserts modal doesn't close on store rejection                             |
| `MilestoneFormModal` invalid date                 | User entered malformed value (rare with `<input type="date">` but possible via paste) | Explicit `Number.isFinite(Date.parse(...))` check; inline error blocks submit                                                          | `MilestoneFormModal.test.ts` asserts submit blocked + error visible                                     |
| `useScrapbookFeed` malformed `occurredOn`         | `Date.parse` returns NaN                                                              | `safeOccurredOn` util: console-warn + `reportError` + falls back to `createdAt`                                                        | `useScrapbookFeed.test.ts` injects bad date; asserts feed still renders + report fired                  |
| `useFamilyTimeline` malformed `occurredOn`        | Same as above                                                                         | Same `safeOccurredOn` util — single failure-handling point                                                                             | `useFamilyTimeline.test.ts` asserts year-grouping doesn't produce a "NaN" bucket                        |
| Family Timeline references deleted bean           | `memberId` doesn't resolve                                                            | Renders "unknown bean" placeholder + one-time `reportError` per dangling ID                                                            | `useFamilyTimeline.test.ts` injects a milestone with bogus `memberId`; asserts placeholder + report     |
| `openQuickAdd({ filter: [] })`                    | Caller-side bug                                                                       | Dev: `console.error` + `reportError`; prod: fall back to `null` so user gets a usable sheet                                            | `useQuickAdd.test.ts` extension covers empty-filter case + asserts fallback                             |
| `openQuickAdd({ filter })` with unknown action ID | Typo in caller (compile-time-checked when filter is a literal)                        | Dev: `console.warn` listing unknowns; prod: silently skip those entries (rest of sheet still renders)                                  | `useQuickAdd.test.ts` extension covers unknown-action case                                              |
| `<PhotoAttachments>` upload failure on milestone  | Drive write error / network                                                           | Existing component handles + reports — no new path                                                                                     | Existing test coverage                                                                                  |
| Concurrent edit on a milestone (two devices)      | Automerge CRDT merges automatically                                                   | n/a (existing infrastructure)                                                                                                          | n/a                                                                                                     |

## Maintainability + sustainability notes

- **One edit per category change.** Adding/removing a milestone category = one entry in `MILESTONE_CATEGORIES`. Type union, picker grid, filter chips, default title fill-in, and i18n key references all derive from it.
- **No new mutable module-scoped state.** `useQuickAdd`'s new `allowedActions` ref reuses the existing singleton pattern that already holds `isOpen` and `stage`. Cleared on close. No leak across navigations.
- **Family-wide is a presentation key, not a phantom entity.** `memberId === null` everywhere. No fake "family bean" object to keep in sync.
- **Sticky-year headers are pure CSS.** No scroll listeners, no IntersectionObserver, no perf risk.
- **Date-anchored sort with safe fallback.** Malformed dates can't break the feed or timeline — they fall back + report. Single `safeOccurredOn` util means the failure-handling lives in one place.
- **Defensive runtime category fallback.** Future schema drift (a category removed from the union but still present in old saved data) renders as `'custom'` rather than crashing the timeline.
- **Title pre-fill is deterministic.** Only fills when empty. No "did the user type this themselves or did the previous category fill it?" guessing.
- **Form date-validity is checked explicitly**, not assumed. If `BeanieFormModal`'s date validation changes, this form still works.
- **`useQuickAdd` filter is type-safe at the function signature.** Most typos caught at compile time; runtime guard catches dynamically-built filters in dev.
- **`occurredOn` is documented as date-only** in the interface comment. Future code touching this field knows not to add a time component.
- **The `useQuickAdd` filter pattern is the documented "reusable across consolidation pages" mechanism.** Future consolidation pages get the same flow with one function call.

## Verification

**Unit + type:**

```bash
npm run test -- milestonesStore
npm run test -- useFamilyTimeline
npm run test -- MilestoneFormModal
npm run test -- useScrapbookFeed
npm run test -- useQuickAdd          # extend existing test for filter arg
npm run type-check
npm run translate
```

Each test file explicitly asserts the silent-failure paths called out in the audit table above (mocked `reportError` is called; state stays consistent; UI degrades gracefully).

**Manual repro:**

1. `npm run dev`. Sign in.
2. Navigate to a bean's pod → tap **Milestones** tab → empty state shows. Tap "+ Add" → category grid → pick "Lost a Tooth" → title pre-fills → date defaults today → add a photo → save. Card appears.
3. Open the FAB → tap **Milestone** → bean picker → pick a different bean → form opens → toggle **this is a family moment** ON → bean assignment hint disappears → save. Card appears on `/pod/timeline` with "🏡 family" pill.
4. Navigate to **Family Scrapbook** → tap header **+** → `QuickAddSheet` opens filtered to scrapbook items → pick **Saying** → bean picker → save flow runs → saying lands in scrapbook.
5. Navigate to **Family Timeline** → year-grouped list. Filter to one bean → only their milestones. Toggle "include family-wide" off → family-wide entries disappear. Filter category to "Birthday" → only birthdays. Tap a milestone with photos → lightbox opens.
6. Toggle beanie mode → all category labels, form labels, empty states render lowercase.
7. PWA install + standalone → Timeline route works; Scrapbook + button works; FAB still has Milestone entry.
8. **Failure path (manual)**: with DevTools, manually corrupt a milestone's `occurredOn` to `'garbage'` in the IndexedDB cache → reload → scrapbook still renders, timeline still renders without a NaN-year bucket, console shows warning + Slack alert (`#beanies-errors`) with the milestone ID.
9. **Filter footgun check**: from console, call `openQuickAdd({ filter: [] })` → in dev, console error + sheet falls back to no filter (shows everything).

**Beanie-mode discipline:** visual pass on every new label confirms no Title Case leaks (per `feedback_beanie_mode_discipline.md`).

**E2E:** one new spec covering FAB → milestone → bean picker → save → appears on timeline. If at the 25-test cap (currently 33 per `STATUS.md`), consolidate by removing the long-pending `cross-entity.spec.ts:81` candidate.

## Out of scope (deliberately)

- In-place edit/delete on the Family Scrapbook page
- Visual revamp of the Family Scrapbook layout
- Multi-bean "shared with" field on milestones
- Age-aware suggestion filtering
- Bottom-nav tab for Timeline (5-tab layout stays)
- Milestone celebrations (`useCelebration` integration)
- Annual recurrence ("3rd anniversary of...")
- Share-as-image on a milestone card (deferred Pod v1 item per `STATUS.md`)
- Generalizing existing per-bean tabs into a single `<ItemListTab>` (premature — each has type-specific cards)
- Generic repository factory (premature — each repo has type-specific logic)
- Cleanup of `AppHeader.handleRefreshAll`'s under-classified catch (separate cleanup PR)
- Virtual scrolling on the Family Timeline (only needed if a family accumulates ≥500 milestones — defer until observed)
