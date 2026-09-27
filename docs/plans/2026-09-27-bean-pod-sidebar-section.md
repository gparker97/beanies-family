# Plan: The Bean Pod as its own sidebar section

> Date: 2026-09-27
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-27-bean-pod-sidebar-section.md`
> Mockup: `docs/mockups/pod-own-section-2026-09-27.html` (approved; https://claude.ai/artifact/BBnsDZxUBo6ugYpxUhMbXn)

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family member using beanies.family on desktop, I want The Bean Pod to be its own sidebar section next to The Treehouse and The Piggy Bank, so that the family's people pages are one click away and the desktop sidebar matches the phone, where Pod is already its own tab.

## Context

On the phone, **Pod** is already a peer tab of Planning and Money. On desktop it is a nested group two levels down inside The Treehouse (`nav.pod` "The Pod" 🌱 with six `children`), the only nested group in the whole sidebar. greg approved a mockup on 2026-09-27 that lifts it out as a third section, **The Bean Pod**, anchored by the hugging beanies illustration wherever the app leads to it.

Current state (read 2026-09-27):

- `src/constants/navigation.ts`: `NavSection = 'treehouse' | 'piggyBank' | 'pinned'`; `NAV_SECTIONS` has two entries, each `{ id, labelKey, emoji }`. The Pod is a `section: 'treehouse'` item at `/pod` with six `children` (`NavSubItemDef`), each tagged `mobileCategory: 'pod'`. `CATEGORY_META.pod` uses `emoji: '\u{1F331}'` (🌱). `TREEHOUSE_ITEMS` / `PIGGY_BANK_ITEMS` / `PINNED_ITEMS` are exported filters. `NAV_ITEMS_FLAT` and `collectTaggedRoutes()` both walk `children`.
- `src/components/common/AppSidebar.vue` and `src/components/common/MobileHamburgerMenu.vue` each have their own `mapItems`, their own `SECTION_COLORS` map, their own `sections` computed with a `section.id === 'treehouse' ? treehouseItems : piggyBankItems` ternary, and their own `toggle(section.id as 'treehouse' | 'piggyBank')` casts. Both render the nested-children expander; the sidebar via `AppSidebarSubNav.vue`, the hamburger inline.
- The hamburger's badge map is `{ activeGoals: ... }` keyed by `item.badgeKey`, but no nav item uses `activeGoals` (the keys are `overdueTodos`, `overBudgets`, `overdueGoals`, `unbookedTravel`, `dueLists`), so **hamburger nav badges never render today**. The sidebar uses `useNavBadges().badgeFor`.
- `src/composables/useSidebarAccordion.ts` hardcodes `treehouse` / `piggyBank` in its reactive state, load and save; keeps a second localStorage map (`sidebar-expanded-items`) for nested parents; its route watcher auto-expands/collapses parents. Both `catch` blocks are bare ("Ignore parse errors"), and `localStorage.setItem` is unguarded.
- Active state: sidebar uses exact match for plain items and prefix match for the Pod parent (`isRouteActive`); `AppSidebarSubNav` uses exact match for children. `MobileNavBeanStack.isCurrent` uses `isRouteActive` per item, so on `/pod/cookbook` **both** "Meet the Beans" (`/pod`) and "Family Cookbook" are highlighted in the phone Pod stack today.
- Pod routes (`src/router/index.ts`): `/pod`, `/pod/:memberId`, `/pod/:memberId/:tab`, `/pod/scrapbook`, `/pod/milestones`, `/pod/cookbook`, `/pod/cookbook/:recipeId`, `/pod/safety`, `/pod/contacts`; `/family` redirects to `/pod`.
- The sidebar is Deep Slate (`bg-secondary-500`, `#2C3E50`) in both light and dark mode (no dark override of `--color-secondary-500`); same for the hamburger panel.
- Help article `src/content/help/the-pod.ts` gives sidebar directions as "The Pod 🌱 (under the Treehouse)" and "The Pod 🌱 → …" (8 occurrences).

## Requirements

1. Desktop sidebar shows three peer accordion sections in this order: **The Treehouse**, **The Piggy Bank**, **The Bean Pod** (the phone's order).
2. The Bean Pod section holds the six Pod pages one level down, no nested group, in the current order: Meet the Beans (`/pod`), Family Scrapbook, Family Milestones, Family Cookbook, Care & Safety, Emergency Contacts, each keeping its current emoji.
3. The Treehouse no longer contains "The Pod".
4. Section label **"The Bean Pod"** on desktop sidebar and mobile hamburger (en `The Bean Pod`, beanie `the bean pod`). The phone bottom tab keeps **"Pod"** (`mobile.pod`, unchanged).
5. The section's anchor is the **hugging beanies** illustration at icon size (not an emoji), on: the sidebar section header, the hamburger section header, and the phone bottom-nav Pod tab (replacing 🌱).
6. Section label colour is **Sky Silk** (the Treehouse keeps Heritage Orange, Piggy Bank keeps green).
7. A member without finance access sees Treehouse + Bean Pod (Piggy Bank hidden as today).
8. The Bean Pod section expands/collapses like the others, persists its open state, and auto-opens when navigating to any `/pod…` route.
9. Active highlighting: the most specific nav item wins. `/pod/<memberId>` and `/pod/<memberId>/<tab>` highlight Meet the Beans; `/pod/cookbook/<recipeId>` highlights Family Cookbook; `/pod/cookbook` highlights only Family Cookbook (not Meet the Beans), on desktop sidebar, hamburger, and phone bean stack.
10. Sidebar and hamburger share one source for sections, their items, labels, badges, colours and anchors (no duplicated ternaries or colour maps).
11. Help article `the-pod.ts` sidebar directions updated to the new location.

## Important Notes & Caveats

- **Do not rename routes or i18n keys that are data or used elsewhere.** `nav.pod` stays (it is the `/pod` route's `titleKey` in `router/index.ts:187`). `nav.pod.*` child keys stay. `mobile.pod` stays "Pod".
- **Persisted accordion state:** existing users have `sidebar-accordion-state = { treehouse, piggyBank }`. The new `beanPod` key is absent for them and must default to **open**. Never throw on malformed JSON.
- The `sidebar-expanded-items` localStorage key becomes orphaned once nested groups are gone; it is left in place (harmless, ~30 bytes).
- The sidebar section header and hamburger header render on Deep Slate in **both** modes, so the label colour does not need a light/dark split; but it must be a dark-surface-legible token. Per the theme skill, Sky Silk's accent-on-dark token is `silk-lift` (`#8FC7E8`, 6.02:1 on the `#2C3E50` sidebar); raw `#AED6F1` "reads as ink rather than accent". Use `text-silk-lift` (Sky Silk family, CIG-sanctioned) rather than an arbitrary hex. The mockup's raw `--sky` is its generator's value; CIG wins.
- The phone bottom-nav sits on a light surface in light mode and a dark surface in dark mode; the image anchor is a full-colour illustration and needs no dark partner, but it must be `alt=""` + `aria-hidden` (the tab button already has `aria-label`).
- Image weight: the anchor is always visible (sidebar + tab bar). The smallest existing asset is `beanies_family_hugging_transparent_192x192.png` (66 KB). Generate a **64×64** transparent PNG from the 1024 source (covers 24px at 2x/3x DPR) with `sharp` (already a dependency). **Brand media has ONE source in git:** save it to `packages/brand/assets/shared/beanies_family_hugging_transparent_64x64.png`. `/public/brand/` is gitignored build output that `scripts/sync-brand-assets.mjs` fills on predev/prebuild/pretest (.gitignore:84-92). Never write into `public/brand/` directly. Do not modify existing brand assets.
- Text size rule: the anchor image is sized in rem (`h-6 w-6` = 1.5rem) so it scales with Large reading mode like the emoji beside it.
- Golden brand rule: the beanies hold hands and are never separated; never crop/rotate. Use `object-contain`.
- Removing `children` support removes `AppSidebarSubNav.vue` and the nested-children branches. Confirm no other consumer (checked: only AppSidebar, MobileHamburgerMenu, navigation.ts, useSidebarAccordion, tests).
- Behaviour change to flag: consolidating the item mapping means the hamburger will use `useNavBadges` like the sidebar, so hamburger nav badges start rendering (they were dead code). This is intended parity; greg may veto.
- Behaviour change to flag (bug fix): hamburger Help/Discord now open externally via `openExternal`, matching the sidebar. Today the hamburger `router.push`es them (MobileHamburgerMenu.vue:121-124): `/discord` lands on NotFound, `/help` does an in-place external redirect.
- Behaviour change to flag (a11y/parity): hamburger rows gain the sidebar's badge-aware `aria-label`; section headers gain `aria-expanded`.
- Behaviour change to flag: auto-open lives in the rendered menu, so opening the drawer (or remounting the sidebar) re-opens the current route's section even if it was collapsed earlier on that same route. Today the watcher only fires on a route change.
- Behaviour change to flag (colour): the Treehouse and Piggy Bank labels move to their `-lift` tokens (`accent-lift`, `success-lift`), slightly lighter, as the approved mockup draws them. Today `text-primary-500` and `#27AE60` measure 3.31 and 3.82:1 on `#2C3E50`, under AA for the `text-sm` labels; `accent-lift` measures 4.76:1, `silk-lift` 6.02:1. greg may veto.
- Behaviour change to flag: sidebar plain items move from exact-match to most-specific-prefix active state, so any child route (e.g. `/pod/cookbook/<id>`) now highlights its parent nav item instead of nothing.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. The Pod is the only nav item with `children` (verified 2026-09-27).
2. The sidebar and hamburger panel are `bg-secondary-500` in both modes with no dark override (verified).
3. `text-silk-lift` exists as a Tailwind utility via `--color-silk-lift` in `packages/brand/theme.css:144` (verified).
4. `sharp` is installed and can resize the 1024 PNG (verified `require('sharp')`).
5. `useNavBadges().badgeFor(path)` works for any nav path (used by AppSidebar today).
6. No E2E spec depends on the Pod being nested (only a comment in `invite-join.spec.ts`).
7. `action` is an allowlisted telemetry context key (verified in `src/utils/diagnosticContext.ts`), so no new key is introduced.

## Approach

Implements the approved mockup `docs/mockups/pod-own-section-2026-09-27.html`: three peer sections, Pod pages one level down, hugging-beanies anchor, Sky Silk label. Style tokens come from the theme skill + CIG (the sidebar's existing row classes are reused unchanged).

### 1. Navigation model (`src/constants/navigation.ts`)

- `NavSection = 'treehouse' | 'piggyBank' | 'beanPod' | 'pinned'`; export `type AccordionSectionId = Exclude<NavSection, 'pinned'>`.
- `NavSectionDef` becomes `{ id: AccordionSectionId; labelKey; emoji: string; iconSrc?: string; colorClass: string; requiresFinances?: boolean }`. `emoji` stays REQUIRED: when `iconSrc` is set the image is shown and the emoji is its load-failure fallback (types enforce it; no runtime invariant).
- `export const POD_ANCHOR_SRC = '/brand/beanies_family_hugging_transparent_64x64.png'`.
- `NAV_SECTIONS` (order Treehouse, Piggy Bank, Bean Pod). The sidebar and drawer are Deep Slate in both modes, so each label uses its CIG accent-on-dark (`-lift`) token:
  - `treehouse`: 🌳, `colorClass: 'text-accent-lift'`
  - `piggyBank`: 🐷, `colorClass: 'text-success-lift'`, `requiresFinances: true`
  - `beanPod`: 🌱 (fallback), `iconSrc: POD_ANCHOR_SRC`, `labelKey: 'nav.section.beanPod'`, `colorClass: 'text-silk-lift'`
    (Colours move here from the two duplicated `SECTION_COLORS` maps, AppSidebar.vue:130 / MobileHamburgerMenu.vue:94. See the colour caveat above.)
- Remove the `nav.pod` parent; add the six former children as top-level `NAV_ITEMS` with `section: 'beanPod'`, existing `labelKey`/`path`/`emoji`, `mobileCategory: 'pod'`, placed after the Piggy Bank block.
- Remove `children` from `NavItemDef`, delete `NavSubItemDef`, delete `NAV_ITEMS_FLAT` (it only existed to flatten children) and point the badge invariant, `NAV_ITEMS_BY_PATH`, `MOBILE_TAGGED_NAV_ITEMS` and `collectTaggedRoutes()` at `NAV_ITEMS` directly.
- Replace `TREEHOUSE_ITEMS` / `PIGGY_BANK_ITEMS` / `PINNED_ITEMS` with one accessor `export function navItemsInSection(id: NavSection): NavItemDef[]`.
- `export function activeNavItem(routePath: string): NavItemDef | undefined`: the most specific non-external `NAV_ITEMS` entry for a route: the longest `item.path` for which `isRouteActive(routePath, item.path)` holds, over a module-private list of non-external items. This is the one lookup for "which nav item is current" and "which section owns this route". No new export in `utils/route.ts` (it would have one caller).
- Remove `comingSoon` from `NavItemDef` (no item sets it). Leave the `nav.comingSoon` string in place.
- `MobileNavCategory` / `CATEGORY_META` gain optional `iconSrc`; `pod: { labelKey: 'mobile.pod', emoji: '\u{1F331}', iconSrc: POD_ANCHOR_SRC }` (emoji stays required as the fallback). `buildMobileNavCategories` spreads `...meta` in both the leaf and stack branches (today it copies `labelKey`/`emoji` field by field, navigation.ts:484-489 / 510-515, which would drop `iconSrc`).

### 2. Shared glyph component (`src/components/ui/NavGlyph.vue`, new)

No existing ui component renders "emoji or image" (checked src/components/ui). Props `{ emoji: string; iconSrc?: string }`. Renders `<img v-if="iconSrc && !failed" :src="iconSrc" alt="" aria-hidden="true" draggable="false" class="h-6 w-6 object-contain" @error="onError">`, else `<span aria-hidden="true">{{ emoji }}</span>`; `class` falls through. `onError` sets `failed = true` and calls `logEvent({ level: 'warn', surface: 'nav-glyph', message: 'nav icon failed to load; emoji fallback shown' })` (no context: the src is not an allowlisted key and there is one icon today; logEvent is rate-limited and echoes to the console in dev). `brand/*.png` is precached by the service worker (vite.config.ts:181, :270), and a missing source asset fails the navigation unit test. Same fallback shape as ResponsibilityCardTile.vue:96-104, but not silent. Two consumers: the AppNavMenu section header and the MobileBottomNav tab.

### 3. One shared nav menu (`src/components/common/AppNavMenu.vue`, new)

Replaces the duplicated nav logic AND markup in AppSidebar.vue (mapItems, SECTION_COLORS, sections, four copies of the row button) and MobileHamburgerMenu.vue (the same four plus its own nested-children block). No separate composable (it would have one consumer).

- Props: `density: 'sidebar' | 'drawer'` (row classes `text-lg py-2` vs `text-base py-2.5`; everything else identical). Root is `<nav>`; parents pass layout classes via fallthrough.
- Emits: `select`, fired synchronously before the row's action runs, so every drawer action closes the drawer. (Today only feedback closes first, MobileHamburgerMenu.vue:128-131; route rows push then close, :121-124. Order does not matter: useFullscreenOverlay has no history side effects and the unmount waits a tick.) The sidebar ignores `select`.
- Script: `activeItem = computed(() => activeNavItem(route.path))`. `toRow(item)` returns `{ key, label: t(labelKey), emoji, badge: badgeFor(path), active: item.path === activeItem.value?.path, onSelect }`, where `onSelect` = `item.external && item.externalUrl ? openExternal(item.externalUrl) : router.push(item.path)`. The feedback row is a pseudo-row `{ key: 'feedback', label: t('feedback.shareEntry'), emoji: '📣', badge: null, active: false, onSelect: () => openFeedback('nav') }`. `sections` = `NAV_SECTIONS.filter(s => !s.requiresFinances || canViewFinances.value)` with `items: navItemsInSection(s.id).filter(isItemFlagEnabled).map(toRow)`. Pinned rows go through the same `filter(isItemFlagEnabled).map(toRow)` and are grouped `[discord, feedback]` and `[help, settings]`, split by path as today. `ariaLabelFor` moves here and uses `fillTemplate(t('nav.aria.countAttention'), { label, count })` (both surfaces now announce badge counts).
- Auto-open: `watch(() => route.path, () => { const id = activeItem.value?.section; if (id && id !== 'pinned') reveal(id) }, { immediate: true })`. It watches the path, not the section, so navigating _within_ a collapsed section (e.g. an in-page link from `/pod/safety` to `/pod/contacts`) re-opens it, as today's watcher does (useSidebarAccordion.ts:69-104). `reveal` does nothing when the section is already open. The component that renders the sections owns this watch, so it re-runs on every mount (sidebar remount after a resize or sign-out/sign-in, every drawer open) and stops on unmount.
- Template: one section-header button (`<NavGlyph class="w-6 shrink-0 text-center text-base" …>` so the image and the emoji fallbacks share one 1.5rem box and the three labels line up, then label, chevron, `:aria-expanded`, `type="button"`, colour from `colorClass`), one row button (existing active/inactive classes as a two-way binding, `NavBadge`, `type="button"`), dividers between groups. Written once.
- Fix carried by this: the hamburger stops `router.push`ing external items (today Discord lands on NotFound; Help does an in-place `window.location.replace` via the `/help` externalRedirect, the standalone-PWA loop `openExternal` exists to avoid).

### 4. Accordion state (`src/composables/useSidebarAccordion.ts`) + storage helper (`src/utils/storedJson.ts`, new)

- New `src/utils/storedJson.ts`: `readStoredJson(key, label): { kind: 'missing' } | { kind: 'corrupt' } | { kind: 'ok'; value: unknown }` and `writeStoredJson(key, value, label): boolean`. These are the try/catch bodies of `readPerMemberRaw` / `writePerMemberState` (perMemberStore.ts:43-58, :80-92). The warn text names the key but stays fallback-neutral, because the caller owns the fallback: `[${label}] localStorage read failed for "${key}"`, `… parse failed for "${key}"`, `… write failed for "${key}"`. The two perMemberStore functions become one-line delegates; `writePerMemberState` keeps its `reportError` on `false`. Their tests only check that a warn fired (perMemberStore.test.ts:74-101), so they stay green.
- The composable holds module-level state and persistence only; it imports neither vue-router nor `NAV_ITEMS`. `sectionState` is built from the `NAV_SECTIONS` ids, all defaulting to `true`, loaded once on first use (the existing `initialized` guard).
- Load: `ok` with a plain object (`typeof v === 'object' && v !== null && !Array.isArray(v)`) → copy each boolean for a known id; a missing `beanPod` stays open. `ok` with a non-object (e.g. a stored `null`, which today survives only because field access sits inside the bare try) or `corrupt` → defaults plus `logEvent({ level: 'warn', surface: 'sidebar-accordion', message: 'stored accordion state unparseable; using defaults', context: { action: 'load' } })`.
- Save: `if (!writeStoredJson(...)) logEvent({ level: 'warn', surface: 'sidebar-accordion', message: 'accordion state not persisted; kept in memory', context: { action: 'save' } })`.
- Delete the expanded-items machinery entirely (`EXPANDED_ITEMS_KEY`, `expandedItems`, `saveExpandedItems`, `isItemExpanded`, `toggleItem`, `isPathUnderParent`, the auto-collapse loop). No orphan-key cleanup.
- Delete the route watcher; auto-open moves to `AppNavMenu` (§3). Today the watcher lives in the first caller's component scope (useSidebarAccordion.ts:65-104) and dies when that component unmounts (App.vue:2388 `v-if="isDesktop"`). After this refactor the first caller on phones would be the drawer's AppNavMenu, which unmounts on every close (MobileHamburgerMenu.vue:186, :200). A watch owned by the rendering component re-runs on every mount and needs no detached effectScope.
- API: `{ isOpen(id: AccordionSectionId), toggle(id), reveal(id) }`. `reveal` opens and saves only when the section is closed. Export `__resetSidebarAccordionForTesting()`, which resets `initialized` and the state.

### 5. Components

- `AppSidebar.vue`: replace the `<nav>` block with `<AppNavMenu density="sidebar" class="flex-1 space-y-0.5 overflow-y-auto" />`; drop the now-unused imports, `mapItems`, `ariaLabelFor`, `isActive`, `isParentActive`, `navigateTo`, `navigateSub`, `onParentClick`, `onParentChevronClick`, `SECTION_COLORS`, `sections`, `subItemsOf`, pinned computeds (keep what the profile/security footer uses).
- `MobileHamburgerMenu.vue`: replace the `<nav>` block with `<AppNavMenu density="drawer" class="flex-1 space-y-1 px-4" @select="close" />`; drop `goalsStore` (only used by the dead `activeGoals` badge map), `useSidebarAccordion`, `isParentActive`, `mapItems`, `toggleItemExpanded`, `SECTION_COLORS`, `sections`, pinned computeds, `navigateTo`, `openFeedbackFromMenu` (keep anything still used elsewhere in the file). Keep the route-change close watcher.
- `MobileBottomNav.vue`: the non-calendar tab glyph becomes `<span class="flex h-5 items-center justify-center"><NavGlyph :emoji="cat.emoji" :icon-src="cat.iconSrc" class="text-xl leading-none" /></span>`. The fixed 1.25rem row keeps the 1.5rem image from pushing the "Pod" label ~2px below its siblings (tabs are centred columns, :185/:211). Calendar hero untouched.
- `MobileNavBeanStack.vue`: `const currentPath = computed(() => activeNavItem(route.path)?.path)`; `isCurrent(item)` becomes `item.path === currentPath.value`.
- Delete `src/components/common/AppSidebarSubNav.vue`.

### 6. i18n (`src/services/translation/uiStrings.ts`)

Add `'nav.section.beanPod': { en: 'The Bean Pod', beanie: 'the bean pod' }` beside the other `nav.section.*` keys. `nav.pod` stays (route title). A value-only addition needs no parser change; the translation bot picks up the new key.

### 7. Asset

`packages/brand/assets/shared/beanies_family_hugging_transparent_64x64.png`, generated once with sharp from `packages/brand/assets/shared/beanies_family_hugging_transparent_1024x1024.png` (`resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })`, PNG compression level 9). Then run `npm run sync-brand-assets` to put it in `public/brand/` (and `web/public/brand/`). Commit the source file only (no script); both public copies are gitignored build output.

### 8. Docs and scripts

- `src/content/help/the-pod.ts`: replace the 8 "The Pod 🌱 (under the Treehouse)" / "The Pod 🌱 →" directions (:54, :195, :242, :324, :433, :543, :723, :886) with "The Bean Pod" section wording (e.g. "In the sidebar, open **The Bean Pod** section, then choose **Meet the Beans**"; "**The Bean Pod → Care & Safety**"); on the phone, "the **Pod** tab". Bump `updatedDate` to `2026-09-27` on the 7 affected articles (all except `adding-photos`). Do not change other body copy.
- `.claude/skills/beanies-theme/SKILL.md`: in § Desktop Sidebar, update the accordion table (:681-684): three rows in code order with colours matching code (Treehouse `accent-lift`, Piggy Bank `success-lift`, The Bean Pod: hugging-beanies anchor, `silk-lift`, six Pod pages). Change "outside both accordions" (:686) to "outside the accordions". In the **Brand Vocabulary** table (:790), change "The Bean Pod | Family hub" to "The Bean Pod | Family people section (sidebar accordion)".
- `docs/ARCHITECTURE.md:203`: replace the `AppSidebarSubNav` / two-level-nesting sentence with: the sidebar and hamburger render one `AppNavMenu` over three flat accordion sections from `NAV_SECTIONS`; open state is module-scoped in `useSidebarAccordion` and persisted to localStorage.
- `docs/adr/022-pod-architecture.md` §5: add "> **Amended 2026-09-27.** The Pod's pages moved to a flat third sidebar section, The Bean Pod; nested nav items and `AppSidebarSubNav` were removed. See `docs/plans/2026-09-27-bean-pod-sidebar-section.md`." Leave the original text as history.
- `scripts/store-screenshots/capture.ts`: remove `sidebarParent` from `Destination` (:104-105), from `BEANS`/`SCRAPBOOK` (:115, :120) and the `goTo` branch (:154-160); update the comment at :147-148. Otherwise the desktop profiles (tablet10, chromebook, ipad13) throw on the missing "The Pod" button.
- `CHANGELOG.md` Changed entry.

## Files Affected

- `src/constants/navigation.ts`: section model, Pod flattened, children + `NAV_ITEMS_FLAT` + `comingSoon` removed, `iconSrc`, `navItemsInSection`, `activeNavItem`, `POD_ANCHOR_SRC`
- `src/utils/storedJson.ts`: new (extracted from perMemberStore)
- `src/composables/perMemberStore.ts`: read/write delegate to storedJson
- `src/composables/useSidebarAccordion.ts`: generic sections, `reveal()`, expanded-items and route-watcher removal, logging
- `src/components/common/AppNavMenu.vue`: new (the one nav list)
- `src/components/ui/NavGlyph.vue`: new
- `src/components/common/AppSidebar.vue`, `MobileHamburgerMenu.vue`, `MobileBottomNav.vue`, `MobileNavBeanStack.vue`
- `src/components/common/AppSidebarSubNav.vue`: deleted
- `src/services/translation/uiStrings.ts`: `nav.section.beanPod`
- `packages/brand/assets/shared/beanies_family_hugging_transparent_64x64.png`: new (source copy; public copies are build output)
- `scripts/store-screenshots/capture.ts`: drop `sidebarParent`
- `docs/ARCHITECTURE.md`, `docs/adr/022-pod-architecture.md`: amendment
- `src/content/help/the-pod.ts`: directions
- `.claude/skills/beanies-theme/SKILL.md`: sidebar table
- Tests: `navigation.test.ts`, `MobileBottomNav.test.ts`, `MobileNavBeanStack.test.ts`, new `src/utils/__tests__/storedJson.test.ts`, new `src/composables/__tests__/useSidebarAccordion.test.ts`, new `src/components/common/__tests__/AppNavMenu.test.ts`
- `docs/mockups/pod-own-section-2026-09-27.html`: approved mockup (already committed)
- `CHANGELOG.md`, `docs/STATUS.md`

## Help Center Coverage

- **Action**: update existing
- **Category**: features
- **Slugs**: `meet-the-beans`, `allergies-and-medications`, `family-milestones`, `the-family-scrapbook`, `add-a-recipe-from-anywhere`, `the-family-cookbook`, `emergency-contacts` (all in `src/content/help/the-pod.ts`; `updatedDate` bumped on each)
- **Title**: unchanged
- **Scope**: the "where to find it" steps point to The Bean Pod sidebar section (desktop) and the Pod tab (phone) instead of "The Pod 🌱 under the Treehouse".
- **Notes**: navigation wording only; do not rewrite the article body.

## Observability Coverage

- **Events**: `logEvent({ level: 'warn', surface: 'sidebar-accordion', message, context: { action: 'load' | 'save' } })` when stored accordion state is unparseable (`load`) or cannot be written (`save`). Console: `readStoredJson`/`writeStoredJson` warn with the key name and the fallback taken (production has no logEvent console echo; logQueue.ts:99-113 is dev-only); `NavGlyph` emits `logEvent({ level: 'warn', surface: 'nav-glyph' })` on image failure.
- **Failure modes covered**: corrupt JSON → defaults + firehose warn; blocked/quota storage on write → state kept in memory + firehose warn; storage throwing on read → defaults + console warn (same contract as perMemberStore today); anchor image 404/offline → emoji fallback + `logEvent` warn (`surface: 'nav-glyph'`); nav config mistakes (unknown badge/flag, Pod route without hint key) → module-load throw caught by the navigation unit test; missing anchor asset → navigation unit test fails on `existsSync` of the source file in `packages/brand/assets/shared/`.
- **Success-path signal**: none added. Nav rendering is synchronous, deterministic config; route changes are already on every event as `route_path` and in Plausible pageviews. A per-navigation event would be noise.
- **Critical vs telemetry**: nothing critical; no user action or data is at risk.
- **Privacy/store gate**: no new context keys (`action` is allowlisted, diagnosticContext.ts:68).

## Acceptance Criteria

- [ ] Desktop sidebar: Treehouse, Piggy Bank, The Bean Pod, in that order; Treehouse has no Pod entry; The Bean Pod lists the six pages flat with their emojis.
- [ ] The Bean Pod header shows the hugging beanies (not an emoji) in Sky Silk (`silk-lift`) label colour; legible on the slate sidebar in light and dark.
- [ ] Hamburger menu mirrors the sidebar via the same `AppNavMenu` (three sections, same anchor/colour, flat Pod pages, `NavBadge` badges); Help and Discord open externally from the hamburger.
- [ ] Phone bottom nav: the Pod tab shows the hugging beanies instead of 🌱, label still "Pod"; stack still lists the six pages.
- [ ] Anchor image failure shows the 🌱 fallback and emits a `nav-glyph` warn (no broken-image box).
- [ ] Member without finance access: Treehouse + The Bean Pod only.
- [ ] Active state: `/pod/<memberId>` → Meet the Beans; `/pod/cookbook/<id>` → Family Cookbook; `/pod/cookbook` highlights only Family Cookbook (desktop, hamburger, phone stack).
- [ ] Navigating to any `/pod…` route opens a collapsed Bean Pod section; its open/closed state persists across reloads; users with old stored state see it open.
- [ ] Auto-open still works after a desktop→mobile→desktop resize and after sign-out/sign-in in one session.
- [ ] No `AppSidebarSubNav`, `children`, `NavSubItemDef`, `NAV_ITEMS_FLAT`, `TREEHOUSE_ITEMS`/`PIGGY_BANK_ITEMS`/`PINNED_ITEMS`, `SECTION_COLORS`, `comingSoon`, expanded-items code, or route watcher / effectScope in `useSidebarAccordion` remains.
- [ ] No bare catches in the accordion; storage access goes through `storedJson`.
- [ ] `nav.section.beanPod` has en + beanie.
- [ ] Help article directions updated.
- [ ] Diagnostic logging in **Observability Coverage** implemented.
- [ ] Store-screenshot desktop profiles reach Meet the Beans and Family Scrapbook without a `sidebarParent` step.
- [ ] The anchor PNG is committed under `packages/brand/assets/shared/`, not `public/brand/`.
- [ ] Section labels use `accent-lift` / `success-lift` / `silk-lift`.
- [ ] `npm run validate` green.

## Testing Plan

1. Unit `navigation.test.ts`: three accordion sections in order, each with a `-lift` `colorClass`; `navItemsInSection('beanPod')` = the six Pod paths in order; Treehouse has no `/pod*`; the Pod mobile stack still has 6 items; `CATEGORY_META.pod` / the `MOBILE_NAV_CATEGORIES` pod entry and the `beanPod` section carry both `iconSrc` and `emoji`; `existsSync(join('packages/brand/assets/shared', basename(POD_ANCHOR_SRC)))`; the uniqueness test (:117-128) widened to every `NAV_ITEMS` path; `activeNavItem`: `/pod/cookbook/<uuid>` → `/pod/cookbook`, `/pod/cookbook` → `/pod/cookbook`, `/pod/<uuid>/overview` → `/pod` with section `beanPod`, `/podcast` → undefined, `/help` → undefined (external), `/settings` → the settings item; tests written for nested children rewritten for flat items.
2. (folded into 1; no `route.ts` change)
3. Unit `storedJson.test.ts` (missing / corrupt / ok / getItem throws / setItem throws → false; each warn names the key) and `useSidebarAccordion.test.ts` (no router; reset hook between cases): missing `beanPod` → open; stored `null` and corrupt JSON → defaults plus warn logEvent `action:'load'`; setItem throws → state still toggles plus warn logEvent `action:'save'`; `reveal` on an open section writes nothing; `reveal` on a closed section opens it and writes. Existing perMemberStore consumer tests stay green.
4. Unit `AppNavMenu.test.ts`: finance member sees 3 sections, non-finance 2; `/pod/cookbook` marks only Cookbook active; external item calls `openExternal` (mocked), not `router.push`; the feedback row calls `openFeedback('nav')`; `select` is emitted before the action; mounting on `/pod/scrapbook` with `beanPod` collapsed opens it; with `beanPod` collapsed on `/pod/safety`, pushing `/pod/contacts` re-opens it; collapse, unmount and remount on a `/pod…` route opens it again. `MobileNavBeanStack.test.ts`: on `/pod/cookbook` exactly one current item. `MobileBottomNav.test.ts`: the Pod tab renders an `<img>` with `POD_ANCHOR_SRC`.
5. Browser (Playwright script outside `e2e/specs/`): desktop 1280 light + dark (sidebar sections, collapse/expand, active highlight on `/pod/cookbook/<id>` and `/pod/<memberId>`, finance-less member view); phone 400px light + dark (Pod tab anchor, stack, hamburger menu incl. Help/Discord). Screenshots reviewed.
6. `npm run validate`.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved mockup + code read: flatten Pod into a `beanPod` section, image anchors via `NavGlyph`, shared `useNavSections`, most-specific active path, generic accordion state.
- **Pass 2 (DRY + error handling)**: collapsed the two nav templates into one `AppNavMenu` (dropped `useNavSections`); emoji kept as a required fallback for image anchors (no invariant); storage via a new `storedJson` helper extracted from perMemberStore; accordion watcher moved to a detached effectScope (fixes auto-open dying on unmount); dropped orphan-key cleanup; save only on change; removed `NAV_ITEMS_FLAT` and the three per-section constants; hamburger external-link bug fixed by the shared handler.
- **Pass 3 (Sustainability)**: auto-open moved from a detached effectScope to an immediate watch owned by AppNavMenu (the drawer's menu unmounts on every close); the accordion composable drops its router and NAV_ITEMS dependencies and exposes `reveal()`; `NAV_ROUTE_PATHS` replaced by one `activeNavItem()` lookup; accordion load guards non-object JSON; storedJson warns name the key; path-uniqueness test widened to all NAV_ITEMS; dead `comingSoon` dropped (flattens the only nested class ternary); NavGlyph warning made generic.
- **Pass 4 (Fresh-eyes sweep)**: anchor PNG moved to `packages/brand/assets/shared/` (public/brand is gitignored build output); store-screenshot script's `sidebarParent: 'nav.pod'` step removed (would throw on desktop profiles); auto-open watches `route.path` so in-section navigation re-opens a collapsed section; `buildMobileNavCategories` spreads meta so `iconSrc` reaches the tab; section labels move to `-lift` tokens (3.31/3.82:1 today); NavGlyph failure goes to `logEvent`; glyph sizing boxes for alignment; `activeNavPath` folded into `activeNavItem`; `fillTemplate` in `ariaLabelFor`; help slugs + `updatedDate` bumps, ARCHITECTURE.md and ADR-022 amendments added.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-27, session start after /good-morning)

> let's build the bean pod as own sidebar section - do we need a plan for this or is it just a small UI change?

### Follow-up 1

> yes, run /beanies-build-auto

### Prior decisions carried in (docs/STATUS.md Pending item 3, greg 2026-09-27)

Lift The Pod out of The Treehouse into a third desktop section named "The Bean Pod" (matches the `.beanpod` family-data terminology; the phone keeps the short "Pod" tab, as phone tab names are shorter and more literal than the desktop ones); section order Treehouse, Piggy Bank, Bean Pod (the phone's order); section colour Sky Silk; the anchor is the hugging beanies illustration (`public/brand/beanies_family_hugging_transparent_*.png`, shrunk to icon size) wherever the app leads to the Bean Pod, including the phone's Pod tab (replacing the 🌱 seedling); the Pod's six pages sit one level down (no nested group).

</details>

## Outcome

> Built 2026-09-27 via `/beanies-build-auto`. `npm run validate` green (9434 tests). Not deployed.

Built as planned, with these deviations (each recorded where it was decided):

- **`writeStoredJson` returns `{ ok: true } | { ok: false; error }`**, not a boolean, so `writePerMemberState`'s `reportError` and the accordion's save warning keep the caught error (a boolean would have dropped it from the firehose).
- **Sidebar scrolls the current row into view** (not in the plan). Browser verification showed three open sections are taller than a 1280×900 viewport, so on `/pod/cookbook` the highlighted row sat below the fold. Final form: desktop sidebar only, driven by the same route watcher that reveals the section; the row is **centred on mount** (the sidebar footer renders after the nav and shrinks it) and scrolled `nearest` on later route changes. A first version used a ResizeObserver that followed the row until the user scrolled; review rounds 1 and 2 found it yanked the drawer and the sidebar (save-status row, scrollbar drag, Tab) and it was replaced rather than patched further.
- **`activeNavItem` skips flag-hidden items** (review round 1): a hidden item is never rendered, so it must never win the match.
- **Help copy**: the "(on a phone, tap the Pod tab)" hint was added to the four "In the sidebar" entry points.

Not done / left for greg:

- Whether sections should not all default open (the mockup drew The Piggy Bank collapsed) so the sidebar fits a laptop screen without scrolling.
- Inactive nav row labels are `text-white/40` (3.16:1 on Deep Slate, under AA) — pre-existing, carried over verbatim into `AppNavMenu`; fixing it is a visible change to every row.
- `web/src/components/HeroShowcase.astro` (marketing hero mock) still draws "🌱 The Pod" under The Treehouse and a 🌱 Pod tab; needs its own web deploy.
- The Pod help article's intro still calls the area "The Pod" (the `/pod` page title is still "The Pod"); navigation steps say "The Bean Pod".
- "Emergency Contacts" wraps to two lines at the sidebar's `text-lg` row size.
