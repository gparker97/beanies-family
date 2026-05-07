# Plan: Family Scrapbook redesign — tabbed scrapbook spreads (v3)

> Date: 2026-05-07 (v3 — sustainability / reliability review pass)

## Context

The current `/pod/scrapbook` page is a CSS-columns masonry of mixed cards across the whole family. It's functional but reads as a _feed_, not a _scrapbook_ — the brand's emotional centerpiece. The redesign turns it into a **tabbed scrapbook of spreads**: a horizontal "spine" pages between Everyone (the family bulletin board) and each bean's individual magazine-style spread, with kraft-paper texture and tasteful scrapbook decorations throughout.

**Greg-confirmed decisions:**

- Default landing tab = **Everyone** spread
- Visual aggressiveness = **refined scrapbook** (kraft paper, slight tilts, washi tape, polaroid frames; brand-aligned restraint, not maximalist)

**Goes away:**

- Type/member chip filter row (paging by member supersedes; type filtering is implicit in spread sections)
- Single masonry layout + Load More pagination (replaced by per-bean section caps + "see all →" links)

## Approach

Four new components, one stylesheet edit, and one tiny prerequisite refactor. The data layer (`useScrapbookFeed`) is untouched.

### 0. Prerequisite: `useMilestoneLightbox` → module-level singleton

`src/composables/useMilestoneLightbox.ts` (modify, ~10-line change). Today the composable creates fresh refs on every call — fine for the two existing call sites (Timeline page, BeanMilestonesTab) where one component owns the lightbox + mounts `<PhotoViewer>`.

For the scrapbook redesign, deep-nested `<ScrapbookEntryCard>` instances need to open the same lightbox. Without a singleton, options are: (a) prop-drill `openFor` through page → spread → card (three levels), or (b) per-card lightbox state (broken — many independent lightboxes). Both are worse than one tiny refactor.

Hoist `isOpen` + `photoIds` to module scope, mirroring `useQuickAdd`'s singleton pattern. The composable's surface is unchanged (`{ isOpen, photoIds, openFor, close }`); the existing two call sites work the same. The page-level `<PhotoViewer>` mounts once and any caller invokes `openFor(m)`.

### 1. `<ScrapbookSpine>` — horizontal chip strip

`src/components/scrapbook/ScrapbookSpine.vue` (new). Scroll-snapping chip strip:

- 🌳 **Everyone** (always first)
- One chip per bean from `familyStore.sortedHumans` — colored dot + name
- Active chip tilts forward (`transform: scale(1.02) rotate(-1deg)` + slight shadow lift)

Props: `:beans` (FamilyMember[]), `:active-id` ('everyone' | UUID). Emits `select`. Stateless; parent owns `activeSpread`.

### 2. `<ScrapbookEntryCard>` — single source for entry-type → renderer mapping

`src/components/scrapbook/ScrapbookEntryCard.vue` (new). Takes a `ScrapbookEntry` and dispatches to the right visual based on `entry.type`:

| Type                                                   | Renderer                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `'saying'`                                             | existing `<StickyNote :text :index :footer-text>`                                                                                           |
| `'favorite'` with photo                                | existing `<PolaroidImage :src :caption>`                                                                                                    |
| `'favorite'` without photo                             | small kraft card with category emoji + name                                                                                                 |
| `'milestone'`                                          | `.scrap-taped` kraft card containing `<MilestoneThumb>` + title + date stamp; thumb tap calls singleton `useMilestoneLightbox().openFor(m)` |
| `'note'`                                               | `.scrap-ripped` kraft card with title + body excerpt                                                                                        |
| **default** (unknown future-schema-drift `entry.type`) | renders nothing + once-per-session `reportError({ surface: 'ScrapbookEntryCard', message: 'unknown entry type' })`                          |

**Trusts `entry.type`** as the discriminator — no payload-shape sniffing. The composable already constructs entries with type matching payload by construction; if a payload mismatch ever happens, that's a bug in `useScrapbookFeed` to fix, not a defensive surface to add here.

Class fall-through means the parent owns layout/sizing. Card emits `@click` with the entry; parent handles routing.

### 3. `<EveryoneSpread>` — bulletin-board mosaic

`src/components/scrapbook/EveryoneSpread.vue` (new). Renders the most recent entries from `useScrapbookFeed` (no filter args), in a 3-column CSS-columns mosaic. Each card wraps `<ScrapbookEntryCard>` with a stable per-id rotation (see §6 — _not_ indexed, so rotations don't reshuffle when new items arrive).

Top of file:

```ts
const MOSAIC_LIMIT = 30;
```

Big Caveat header at top. Empty state via existing `<EmptyState>` with the page's `+ Add` action.

### 4. `<BeanSpread>` — per-bean magazine layout

`src/components/scrapbook/BeanSpread.vue` (new). Sectioned spread for one bean.

**Header band:**

- Bean's name in Caveat (~text-5xl) + color dot
- Subtitle from `formatBeanSubtitle(member)` helper (defensive against partial `dateOfBirth` and missing `createdAt`)
- Optional polaroid hero from `avatarPhotoId` via `photoStore.getPublicUrl` — `v-if`-gated on a non-null URL so a missing photo cleanly hides the hero

**Sections** are driven by a single config:

```ts
const SECTIONS = [
  { type: 'saying', cap: 4, kicker: 'scrapbook.section.sayings', tab: 'sayings' },
  { type: 'favorite', cap: 6, kicker: 'scrapbook.section.favorites', tab: 'favorites' },
  { type: 'milestone', cap: 4, kicker: 'scrapbook.section.milestones', tab: 'milestones' },
  { type: 'note', cap: 3, kicker: 'scrapbook.section.notes', tab: 'notes' },
] as const;
```

The template is one `v-for` over `SECTIONS`. Each section renders only when ≥1 entry exists for that bean+type, capped by `cap`, with a "see all →" link to `/pod/{memberId}/{tab}`. Adding/retuning a section = one entry in this array.

Empty bean (no entries in any section) → existing `<EmptyState>` with the page's `+ Add` action.

### 5. Decorative styles — one stylesheet edit, no new components

`src/style.css` — add four utility classes (CSS-only, no images):

| Class              | Visual                                                                                                                                                                                                              | Note                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `.scrapbook-paper` | Page background: kraft warm-cream + radial Heritage-Orange / Sky-Silk wash + low-opacity inline-SVG noise overlay                                                                                                   | Dark-mode variant: warm slate, same noise |
| `.scrap-taped`     | Card with a colored "tape strip" `::before` at top-right, slight rotation. **Includes its own `position: relative`** so parents don't fight it (lesson from the recent `<MilestoneThumb>` position-class collision) | `--tape-color` custom prop for cycling    |
| `.scrap-ripped`    | Card with torn-edge SVG mask-image at top + bottom. **Includes `position: relative`**                                                                                                                               | Inline SVG path (~60 bytes)               |
| `.scrap-washi`     | Section divider: small colored rectangle at slight rotation with frayed-end pseudo-elements                                                                                                                         | `--washi-color` custom prop               |

All four are CSS-only — no JS, no images, no new Vue components. Slight rotations are fixed (deterministic), not random.

### 6. The page itself — `FamilyScrapbookPage.vue` refactor

```vue
<div class="scrapbook-paper relative min-h-screen">
  <Header />  <!-- existing back button + + Add button + watermark -->

  <ScrapbookSpine
    :beans="familyStore.sortedHumans"
    :active-id="activeSpread"
    @select="activeSpread = $event"
  />

  <Transition name="page-flip" mode="out-in">
    <EveryoneSpread v-if="activeSpread === 'everyone'" key="everyone" @entry-click="onEntryClick" />
    <BeanSpread v-else :member-id="activeSpread" :key="activeSpread" @entry-click="onEntryClick" />
  </Transition>

  <PhotoViewer
    :open="lightbox.isOpen.value"
    :photo-ids="lightbox.photoIds.value"
    read-only
    @close="lightbox.close"
  />
</div>
```

**Page-owned state + helpers:**

```ts
const activeSpread = ref<'everyone' | UUID>('everyone');
const lightbox = useMilestoneLightbox(); // singleton — same instance any card sees

// Activeguard: if the chosen bean is removed (delete / family change), bounce to Everyone.
watch(
  () => familyStore.sortedHumans,
  (humans) => {
    if (activeSpread.value === 'everyone') return;
    if (!humans.some((h) => h.id === activeSpread.value)) {
      activeSpread.value = 'everyone';
    }
  },
  { immediate: true }
);

// Stable per-id rotation: hash entry.id → a fixed jitter in [-2.5°, +2.5°].
// Used by EveryoneSpread; deterministic so adding a new entry doesn't reshuffle
// the rotations of existing cards.
function rotationFor(id: string): number {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return ((hash % 100) / 100) * 5 - 2.5;
}

function formatBeanSubtitle(member: FamilyMember): string {
  // Returns "" / "joined 2024" / "age 9" / "age 9 · joined 2024" depending on
  // what's available. Pure function, defined inline.
}

function onEntryClick(entry: ScrapbookEntry): void {
  // Family-wide milestones (memberId === null) → no per-bean tab to route to;
  // open the lightbox if photos exist, otherwise no-op.
  if (entry.type === 'milestone' && entry.memberId === null) {
    lightbox.openFor(entry.payload as Milestone);
    return;
  }
  if (entry.memberId === null) return;
  router.push(`/pod/${entry.memberId}/${entryTabFor(entry.type)}`);
}
```

The `<Transition mode="out-in">` + `:key="activeSpread"` ensures a clean unmount/remount on spread switch — no shared state leaks between spread instances.

**Page-flip transition** (scoped CSS): 220ms opacity + small translateX. Disabled under `prefers-reduced-motion`.

## Files affected

**Modify (1 prerequisite + 3 page-level):**

- `src/composables/useMilestoneLightbox.ts` — hoist refs to module scope (singleton). Existing call sites unchanged.
- `src/pages/FamilyScrapbookPage.vue` — replace body with spine + spread switcher + page-level lightbox; drop filter chips, type-label map, masonry, load-more, paper-color cycling
- `src/style.css` — add `.scrapbook-paper`, `.scrap-taped`, `.scrap-ripped`, `.scrap-washi`
- `src/services/translation/uiStrings.ts` — ~12 new keys for spread labels, kicker headers, "see all →", empty states, Caveat subtitles. Run `npm run translate` after.

**Create (4 components):**

- `src/components/scrapbook/ScrapbookSpine.vue`
- `src/components/scrapbook/ScrapbookEntryCard.vue`
- `src/components/scrapbook/EveryoneSpread.vue`
- `src/components/scrapbook/BeanSpread.vue`

## Reuse — explicit DRY ledger

| Need                                                    | Reused from                                                                         | Why no new code                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| Sticky-note rendering                                   | `src/components/pod/shared/StickyNote.vue`                                          | Color + tilt cycling already built in      |
| Polaroid frame for photos                               | `src/components/pod/shared/PolaroidImage.vue` (handles `src=null` with placeholder) | Already used by cookbook                   |
| Add tile / empty state                                  | `<AddTile>`, `<EmptyState>` from `src/components/pod/shared/`                       | Canonical                                  |
| Mixed-feed data                                         | `src/composables/useScrapbookFeed.ts`                                               | No data-layer changes                      |
| Bean roster + ordering                                  | `familyStore.sortedHumans`                                                          | Pets out of scope V1                       |
| Photo URL resolution                                    | `photoStore.getPublicUrl(id, 'thumb' \| 'full')`                                    | Existing                                   |
| Milestone thumbnail (photo + emoji + multi-photo badge) | `src/components/pod/MilestoneThumb.vue`                                             | Shipped on timeline + bean tab             |
| Milestone lightbox state                                | `src/composables/useMilestoneLightbox.ts` (singleton after §0)                      | Same controller as timeline + bean tab     |
| Read-only photo viewer                                  | `src/components/media/PhotoViewer.vue`                                              | Shared lightbox                            |
| Date formatting                                         | `formatDateShort` from `src/utils/date.ts`                                          | Existing                                   |
| Type → renderer dispatch                                | New `<ScrapbookEntryCard>` is the **single** place this lives                       | Future entry types: one branch in one file |

**No new abstraction layers beyond the four components above.** Considered + rejected:

- Decorative wrappers as Vue components (TapedCard / RippedNote / WashiDivider) → moved to CSS utility classes; any element opts in via `class=`
- `<EveryoneSpread>` + `<BeanSpread>` merged with a `:variant` prop → meaningfully different layouts (mosaic vs sectioned-with-headers); the shared mapping lives in `<ScrapbookEntryCard>`
- A "scrapbook section" component that takes `:items :title :renderer` → over-abstracting; `BeanSpread`'s sections are now driven by a config array, which is the right granularity
- A subtitle-formatting composable → `formatBeanSubtitle` is one pure function defined inline
- A "page tab strip" generalisation of `<ScrapbookSpine>` → premature; this layout is scrapbook-specific
- Payload-shape duck-type sniffing in `<ScrapbookEntryCard>` → fragile + drifty; trust `entry.type` discriminated union

## Silent-failure audit (per `feedback_no_silent_failures.md`)

Every potentially-failing path classified, prefixed, and reported. No bare `catch {}`.

| Path                                                                             | Failure mode                                   | Handling                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatBeanSubtitle` with partial `dateOfBirth` (no year) or missing `createdAt` | "age undefined" / "joined undefined"           | Helper returns the most-complete fragment available: `"age 9 · joined 2024"` → `"joined 2024"` → `"age 9"` → `""`. No throw.                                                                                         |
| `photoStore.getPublicUrl` returns null (deleted / Drive-unresolved photo)        | Broken `<img>`                                 | Hero element is `v-if`-gated on a non-null URL; `<PolaroidImage>` itself handles `src=null` with placeholder; `<MilestoneThumb>` already falls back to category emoji                                                |
| Unknown `entry.type` (future schema drift)                                       | Card renders nothing                           | `<ScrapbookEntryCard>` default branch: `console.warn` + once-per-session `reportError({ surface: 'ScrapbookEntryCard', message: 'unknown entry type' })` keyed by `entry.id`; spread keeps rendering everything else |
| Spread is empty for a bean                                                       | No sections render                             | `<EmptyState>` invites "+ Add" via the page's existing add flow                                                                                                                                                      |
| `useScrapbookFeed` returns malformed entries                                     | Existing console.warn + skip in the composable | Already covered upstream; no new path needed                                                                                                                                                                         |
| `activeSpread` references a deleted bean                                         | BeanSpread receives a stale UUID               | `watch` on `familyStore.sortedHumans` resets `activeSpread` to `'everyone'` if the bean is gone (also `immediate: true` covers initial-load drift)                                                                   |
| `familyStore.sortedHumans` is empty                                              | Spine shows only Everyone chip                 | Intended degraded state; `<EveryoneSpread>` renders its empty state                                                                                                                                                  |
| Page-flip transition fails or misses an unmount                                  | Stale state leaks across spreads               | `<Transition mode="out-in">` + `:key="activeSpread"` forces full unmount/remount; spread components are stateless re shared resources                                                                                |
| Family-wide milestone clicked (memberId === null)                                | No per-bean tab to route to                    | `onEntryClick` opens lightbox if photos exist, otherwise no-ops (intentional — family-wide milestones live on the Milestones page; the scrapbook is a glance)                                                        |

The new code adds **one** new defensive validator (the unknown-entry-type branch) — every other failure mode is handled upstream in already-shipped code.

## Maintainability + sustainability notes

- **Data layer untouched.** `useScrapbookFeed` already produces the complete feed; spreads slice it locally.
- **Section structure is a config array.** `SECTIONS` in `BeanSpread.vue` drives the template via `v-for`. Adding/removing/retuning a section = one edit.
- **Mosaic limit + section caps are named constants** at the top of their respective files. One place per knob.
- **Stable per-id rotation.** Existing items keep their rotation when new items arrive — no visual reshuffling on data updates.
- **Decoration is stylesheet, not components.** Four utility classes; any future spread surface opts in via `class=`. Each class is self-contained re positioning (includes `position: relative`) so parents can't accidentally fight it.
- **No image assets.** Inline SVG noise + masks in the stylesheet. One file to retune the brand.
- **Spread switcher is one source of truth.** `activeSpread` ref in the page; spine emits `select`. No URL state, no router-level paging.
- **Lightbox is a singleton.** Any future deep-nested card can call `useMilestoneLightbox().openFor(m)` without prop drilling. Mirrors `useQuickAdd`'s pattern.
- **Activeguard is one watcher.** Three-line safety net for the deleted-bean edge case.
- **No new mutable module-scoped state** beyond the singleton lightbox refs (which mirror the existing `useQuickAdd` shape).

## Verification

**Unit + type:**

```bash
npm run type-check
npm run test                   # existing tests stay green (incl. useFamilyTimeline + BeanMilestonesTab tests)
npm run translate              # confirm new keys sync to Chinese
```

Add one focused test:

- `src/components/scrapbook/__tests__/BeanSpread.test.ts` — section visibility (each section renders only when ≥1 entry of that type for the bean), "see all →" link target, `formatBeanSubtitle` defensive paths.

The decorative styles are pure CSS — no tests beyond visual review. `<ScrapbookEntryCard>`'s default-branch behaviour is trivially asserted in the same spec file (give it an entry with an unknown type, expect `null`-ish render + `reportError` mock called).

**Manual repro:**

1. `npm run dev`. Sign in.
2. `/pod/scrapbook` → lands on **Everyone** spread; spine shows the family roster.
3. Polaroid mosaic shows ≤30 recent items with subtle deterministic rotations + decorations. Tap an item → routes to that bean's pod tab; family-wide milestone with photos → opens the lightbox.
4. Tap a bean's chip → page transitions (~220ms); spread renders with header, optional hero, sections capped at 4/6/4/3, "see all →" deep-links per section.
5. Empty bean → empty-state CTA opens the QuickAddSheet.
6. Milestone with multiple photos → tap thumb opens the lightbox; arrow keys cycle.
7. Toggle beanie mode → all spread headers, kickers, "see all →" copy, empty-state messages render lowercase.
8. Toggle dark mode → kraft texture inverts to warm slate; readability holds.
9. **Failure paths**:
   - Set `entry.type` to `'unknown'` via DevTools → that one card renders nothing, console shows `[ScrapbookEntryCard] unknown entry type` warning + Slack alert; the rest of the spread renders fine.
   - Delete a bean while their spread is open → `activeSpread` watcher resets to Everyone within one tick; no broken render.
   - View a bean with partial DOB (no year) → subtitle reads "joined 2024" instead of "age undefined · joined 2024."
10. PWA install + standalone → spine + spreads work; "+ Add" remains accessible (the previously-flagged button bug is orthogonal and tracked separately).

**Beanie-mode discipline** (per `feedback_beanie_mode_discipline.md`): every new label, kicker, "see all →" copy, empty-state message goes through `t('key')`. Visual pass after impl confirms no Title Case leaks.

## Out of scope (deliberately)

- Swipe-between-spreads gesture (chip-strip paging is enough for V1)
- URL deep-link to a specific bean's spread (`/pod/scrapbook/{id}`) — V1 keeps it in-page state
- Pet spreads (`sortedHumans` only — pets get their own future spread if needed)
- "This week" / "on this day" curation strip on Everyone — defer
- Print/export of a spread (PDF album feel) — future feature
- Diagnosing the "+ Add to scrapbook nothing happens" bug — covered by diagnostic logging already shipped; orthogonal to this redesign
