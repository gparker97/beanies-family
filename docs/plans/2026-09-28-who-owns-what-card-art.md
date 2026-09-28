# Plan: Who Owns What card art (hero images + one shared card-art component)

> Date: 2026-09-28
> Related issues: #109 (Notion tracker row; no GitHub issue)
> Plan file: `docs/plans/2026-09-28-who-owns-what-card-art.md`

> **No GitHub issue created.** This plan was approved for direct implementation (via `/beanies-build-auto`).

## User Story

As a parent dealing the Who Owns What deck, I want each hero card to show its illustration everywhere
the card appears, so that the deck feels engaging rather than a list of emoji.

## Context

#109 Who Owns What shipped (pushed, not deployed) with ten "hero" cards whose `illustration` path is
already wired in `src/constants/responsibilityCards.ts` (`/brand/cards/<id>.webp`), but no image files
existed, so every surface showed the emoji. On 2026-09-28 greg generated the ten illustrations
(prompts + references in this session; masters on Drive at
`Projects/beanies.family/Media/Family Responsibility Cards/who-owns-what-NN-<id>.jpeg`). They were
cut out (the white sticker outline kept, background removed) and exported as 512x512 transparent
WebP (34-54 KB each) in the session scratchpad.

Decided by greg 2026-09-27 (`docs/STATUS.md` Pending item 2): **show the card art wherever
possible**, because art is more engaging than an emoji. Extract the tile's img + emoji fallback +
failed-src session cache into one shared component and use it in the deal pile, the Kept/Skipped
lists, the board chips, the view/edit drawer icon, the check-in drawer and the Overview rows. The
emoji stays only where it is inline text (check-in agenda lines, By Bean labels). Fridge sheet art is
a stretch goal.

Today only `ResponsibilityCardTile.vue:69-110` knows about the illustration; every other surface
renders `cardEmoji(card)` as text. Separately, `src/components/ui/NavGlyph.vue` (built 2026-09-27 for
The Bean Pod nav anchor) already implements "image when a src is given, emoji fallback on error,
failure logged to the firehose". The two are the same idea written twice.

## Requirements

1. The ten WebP masters live in git at `packages/brand/assets/shared/cards/<id>.webp` for ids
   `cooking-dinner`, `laundry`, `trash-night`, `grocery-shopping`, `school-drop-off`,
   `bedtime-routine`, `the-big-holidays`, `birthday-parties`, `date-nights`, `time-to-myself`.
   `scripts/sync-brand-assets.mjs` copies `shared/` (recursively, keeping subfolders) to
   `public/brand/` and `web/public/brand/`, so they serve at `/brand/cards/<id>.webp`, which matches
   the wired `illustration` paths. `public/brand/` is gitignored build output: never commit there.
2. Use image 10 from `scratchpad/cards/v3/10-time-to-myself.webp` (the rust-beanie version); the
   root-level `10-time-to-myself.webp` is superseded. Images 01-09 from `scratchpad/cards/NN-<id>.webp`.
3. One generic image-or-emoji primitive replaces `NavGlyph`: `src/components/ui/ImageGlyph.vue`.
   - Props: `emoji: string` (required, doubles as the fallback), `src?: string`,
     `surface: string` (the kebab-case firehose surface for a load failure), `imgClass?: string`
     (image size; default `h-6 w-6`, today's NavGlyph size).
   - Renders `<img :src alt="" aria-hidden draggable=false loading="lazy" class="object-contain">`
     when `src` is set and has not failed; otherwise `<span aria-hidden>{{ emoji }}</span>`.
   - A module-scope `const failedSrcs = reactive(new Set<string>())` is the single source of truth
     (the tile's session cache, moved here). No local `failed` ref and no `watch(src)` reset:
     `showImg = computed(() => !!props.src && !failedSrcs.has(props.src))`, so a src change is
     handled for free and every mounted instance with the same src flips to the emoji together.
     Declare it in a plain `<script lang="ts">` block beside `<script setup>` (the pattern
     `ResponsibilityCardTile.vue` uses today, which moves here): top-level `<script setup>` code runs
     once per instance, so a Set declared there would silently give each glyph its own cache.
     `onError`: `if (!src || failedSrcs.has(src)) return;` then add, then log. The guard matters
     because two instances with the same src (board + list open together) both fire `error` before
     either re-renders; without it "logged once per src" would be false.
   - On that first failure also `console.warn('[ImageGlyph] <full src> failed to load; showing the
emoji. Brand art: check packages/brand/assets/shared/<path> exists, then npm run
sync-brand-assets.')` (precedent `BeanieAvatar.vue:185`): `logEvent` only echoes to the console
     in dev when no ingest URL is set, so without this a developer sees nothing locally.
   - Contract (doc comment): `src` is a static bundled asset path, never a user photo
     (`BeanieAvatar`, `MealThumb`), because failures stick for the session and the file name ships
     as `kind`.
   - Greying out is the caller's job via a fallthrough class (e.g.
     `:class="{ 'grayscale opacity-55': isOpen || isSkipped }"`, utilities as in
     `TodoMemberFilter.vue:68`), which lands on the image or the emoji, whichever renders. This
     replaces the tile's scoped `.glyph` rule, which only reached the emoji. No `ghost` prop.
   - Image base class stays NavGlyph's `inline-block object-contain`, with `imgClass` added on top.
   - Decorative only; the surrounding control carries the accessible name (unchanged contract).
4. `NavGlyph.vue` is deleted; `AppNavMenu.vue` and `MobileBottomNav.vue` use `ImageGlyph` with
   `surface="nav-glyph"` (the existing CloudWatch surface is preserved) and the same visual output.
5. A thin card wrapper `src/components/responsibilities/CardArt.vue`: props
   `card: Pick<ResolvedCard, 'emoji' | 'illustration'>`, `imgClass?`. It renders
   `<ImageGlyph :emoji="card.emoji" :src="card.illustration" surface="card-art" …>`.
   `ResolvedCard.emoji` / `.illustration` are already resolved in `resolveDeck`
   (`responsibilityDeck.ts:220-223`, custom emoji included) and every call site holds a
   `ResolvedCard`, so it does NOT call `useResponsibilityCardLabel()` (that would build
   `useTranslation` + `useMemberInfo` in each of ~80 thumbs per page to repeat `card.emoji`). The
   wrapper exists only to pin `surface="card-art"` and the field mapping in one place. Custom cards
   (no `illustration`) render their emoji, as today.
6. Use `CardArt` at every card-icon site:
   - `ResponsibilityCardTile.vue` slab (80px image, `text-4xl` emoji; greyed out via the
     `grayscale opacity-55` class when kept-with-nobody or skipped). Remove the tile's own illustration computed, error handler, second
     `<script>` block and the `.glyph` ghost CSS. The 7%-opacity watermark emoji stays.
   - `DealPileStage.vue` slab (the big card being dealt; `text-6xl md:text-7xl` emoji; image sized
     to the slab, starting `h-24 w-24 md:h-36 md:w-36` (the slab is 42% of a 5:7 card: ~115px tall
     on phones, ~176px from `md`, and it clips with `overflow-hidden`), tuned in the browser). Its 7%-opacity
     watermark emoji stays text, as on the tile.
   - `DealPile.vue` group-shortcut row icon (`text-base`; image `h-6 w-6`).
   - `DealPileLists.vue` Kept and Skipped row `.thumb` (`CardArt` inside the existing `.thumb`
     span; `img-class="h-full w-full"`).
   - `DealBoard.vue` rail `.thumb` (h-8 w-8) and both chip `.thumb`s (1.75rem): `CardArt` inside the
     existing `.thumb` span; `img-class="h-full w-full"`.
   - `CheckInDrawer.vue` three row `.thumb`s (2rem): `CardArt` inside the existing `.thumb` span,
     which keeps its `:style="{ '--cat' }"`; `img-class="h-full w-full"`.
   - `DeckOverview.vue` card rows (`text-xl`; image `h-7 w-7`) and the recent-activity feed icon.
     Replace `recent` with a `recentRows` computed that looks each card up once:
     `{ item, card, art }`, where `card = item.kind === 'checkin' ? undefined : store.cardById(item.cardId)`
     and `art = card ?? { emoji: item.kind === 'checkin' ? '🗓️' : '🃏' }`. The template always renders
     `<CardArt :card="row.art" …>` (no branch). `recentText(item, card)` takes the looked-up card;
     `recentIcon` is deleted. (Today `recentText` and `recentIcon` each call `store.cardById` for the
     same item.)
   - `CardViewDrawer.vue` and `CardEditDrawer.vue` header icon, through `BeanieFormModal`'s existing
     `#icon` slot (`ModalIconTitle` 44px box; image `h-9 w-9`). `CardEditDrawer` keeps showing the
     live-picked emoji while a custom card's identity is being edited (`editsIdentity`). Remove the
     `:icon` prop from both drawers; the slot replaces it. `CardViewDrawer`:
     `<template v-if="card" #icon><CardArt :card="card" img-class="h-9 w-9" /></template>`.
     `CardEditDrawer`: `headerArt = computed(() => editsIdentity.value ? { emoji: emoji.value } : card.value)`
     and `<template v-if="headerArt" #icon><CardArt :card="headerArt" img-class="h-9 w-9" /></template>`
     (one branch point in script, not a ternary chain in the template).
7. Emoji stays as text (unchanged): `CheckInCard.vue` agenda lines, `DeckByBean.vue` labels,
   `DeckGrid.vue` / `CategoryCoverage.vue` category emoji (those are categories, not cards), and
   the fridge sheet export (see Not doing).
8. The art must read in light and dark mode on every surface above (the white sticker outline is in
   the art itself; the existing tinted `.thumb` / `.slab` backgrounds already have dark partners).
9. Offline: the ten images are precached by the service worker so the art shows offline in the PWA.
   Add `brand/cards/*.webp` to the workbox `globPatterns` in `vite.config.ts` (the current pattern has
   no `webp`; adding `webp` globally would also precache the blog/help webps, which is not wanted).

## Important Notes & Caveats

- **Never commit to `public/brand/`** (gitignored build output of `sync-brand-assets.mjs`). Masters go
  in `packages/brand/assets/shared/cards/`. `npm run dev` / `build` / `test` run the sync first.
- `convert-images.mjs` only makes `.webp` companions for png/jpg; our files are already webp and are
  untouched by it.
- `shared/` also syncs to `web/public/brand/` (the Astro site). ~410 KB of extra static files on the
  marketing site's build output, unreferenced there. Accepted: moving them to an app-only folder
  would need a new sync target for one folder.
- Precache cost: ~410 KB added to the PWA install download, once. Accepted: the app is offline-first
  and `brand/*.png` is already precached wholesale.
- `ImageGlyph` sizing: callers pass the image size via `imgClass`; the emoji keeps its size from the
  caller's `class` (fallthrough attrs land on whichever root element renders, so a `text-*` class on
  the image is harmless). The component must stay single-root per branch (`v-if`/`v-else`) so
  fallthrough attrs keep working. Rule: the caller's own element keeps the box (`.thumb`, the `--cat`
  style, background, radius, fixed size) and `CardArt` goes _inside_ it. Never pass a box class such
  as `thumb` to `CardArt`, or the tint and box land on the `<img>`. Only glyph-level classes pass
  through: text size, leading, and the grey-out class.
- Dynamic `#icon` slot: use `<template v-if="..." #icon>`; `BeanieFormModal` forwards the slot only
  when `$slots.icon` is set, and `ModalIconTitle` draws the box when `icon || $slots.icon`.
- Parity: today only the Deck tile ghosts skipped/open cards. The Skipped list and board are not
  ghosted and stay that way.
- The drawers' `#icon` box uses `ModalIconTitle`'s existing `--tint-orange-8` background (unchanged).

## Assumptions

1. The ten `illustration` paths in `responsibilityCards.ts` are the final ids (verified 2026-09-28:
   eleven `/brand/cards/` references = 10 cards + the doc comment).
2. `sync-brand-assets.mjs` recurses and preserves subfolders (verified: `shared/flags/*.svg` serves
   at `/brand/flags/*.svg`).
3. `NavGlyph` has exactly two callers (`AppNavMenu.vue`, `MobileBottomNav.vue`) and no unit test.
4. `CardViewDrawer` / `CardEditDrawer` render through `BeanieFormModal`, which exposes `#icon`.
5. No existing unit test asserts the emoji text inside the replaced thumbs (to be confirmed when
   running the suite; any that do are updated, not deleted).

## Approach

1. Copy the ten WebPs into `packages/brand/assets/shared/cards/`; run `npm run sync-brand-assets`
   and confirm `public/brand/cards/<id>.webp` exist.
2. Create `ImageGlyph.vue` (from `NavGlyph.vue` + the tile's failed-src Set), switch the two
   nav callers, delete `NavGlyph.vue`.
3. Create `CardArt.vue`.
4. Replace each call site in Requirement 6, deleting the now-dead local code (tile illustration logic,
   `.glyph` ghost CSS). In `DeckOverview`, add `recentRows` per Requirement 6 and delete
   `recentIcon`. The tile and stage watermarks read `card.emoji` (the same field `CardArt` uses).
   Drop `cardEmoji` from the `useResponsibilityCardLabel()` destructure wherever it is no longer
   used (tile, DealPileStage, DealPile, DealPileLists, DealBoard, CheckInDrawer, DeckOverview,
   CardViewDrawer); CardEditDrawer, CheckInCard and DeckByBean keep it.
5. Add `brand/cards/*.webp` to `globPatterns`.
6. Tests: `src/components/ui/__tests__/ImageGlyph.test.ts` and
   `src/components/responsibilities/__tests__/CardArt.test.ts` (see Testing Plan); update any existing
   assertion that looked for the emoji text in a thumb.
7. Browser walk: add `scripts/design-screenshots/who-owns-what-capture.ts` (named after the
   feature, not this change, so later Who Owns What work extends it; never under `e2e/specs/`) covering the Deck, deal pile, lists, board, check-in, overview and drawers at
   desktop + 400px, light + dark, with one skipped and one kept-with-nobody hero card. On the board, drag a hero card by its
   art from the rail onto a member, and drag an assigned chip by its art: both must move the card,
   not start a native image drag.

## Files Affected

- `packages/brand/assets/shared/cards/*.webp` (new, 10 files)
- `src/components/ui/ImageGlyph.vue` (new), `src/components/ui/NavGlyph.vue` (deleted)
- `src/components/common/AppNavMenu.vue`, `src/components/common/MobileBottomNav.vue`
- `src/components/responsibilities/CardArt.vue` (new)
- `src/components/responsibilities/ResponsibilityCardTile.vue`, `DealPileStage.vue`, `DealPile.vue`,
  `DealPileLists.vue`, `DealBoard.vue`, `CheckInDrawer.vue`, `DeckOverview.vue`, `CardViewDrawer.vue`,
  `CardEditDrawer.vue`
- `src/constants/navigation.ts` (doc comment reference to NavGlyph only)
- `vite.config.ts` (workbox `globPatterns`)
- `src/components/ui/__tests__/ImageGlyph.test.ts`, `src/components/responsibilities/__tests__/CardArt.test.ts` (new)
- `src/utils/__tests__/responsibilityDeck.test.ts` (asset-existence assertion)
- Not touched: `src/components/mealplan/MealThumb.vue` (see Not doing)
- `scripts/design-screenshots/who-owns-what-capture.ts` (new)
- `CHANGELOG.md` (one line), `docs/STATUS.md`

## Observability Coverage

- **Events**: `logEvent({ level: 'warn', surface: 'card-art' | 'nav-glyph', message: 'image failed to
load; emoji fallback shown', context: { kind: '<asset file name>' } })`, emitted by `ImageGlyph` on
  the first failure of each src per session. One fixed message for both surfaces so rate-limit
  buckets and log searches stay stable; it replaces NavGlyph's "nav icon failed to load…" (no infra
  filter references the old text: grep of `*.tf`/scripts found none). `kind` is an existing allowlisted key; the value is a
  static asset name (`cooking-dinner.webp`), not user data. No new context key, so no allowlist or
  store-declaration change.
- **Failure modes**: missing/corrupt asset in a deploy (every session logs one warn per missing
  file, named in `kind`, so a bad deploy is visible and attributable within minutes); offline before
  the service worker precached the art (same event; the automatic `online` breadcrumb context tells
  them apart); a nav image failure (unchanged `nav-glyph` surface). In all cases the user sees the
  emoji, never a broken-image box. No bare catch; there is no try/catch in this change. A src that
  failed stays on the emoji for the rest of the session, even after the device comes back online;
  accepted, because the art is decorative and a reload retries it. Developers also get a one-time
  `[ImageGlyph]` `console.warn` with the full src and the fix (re-add the master under
  `packages/brand/assets/shared/`, then `npm run sync-brand-assets`).
- **Success-path signal**: deliberately none per image. These are static bundled assets rendered up
  to ~80 times per page; a success event per render would be noise and trip the 50/surface/min rate
  limit. The failure rate is derivable as `card-art` warns per session against the existing
  route-view events for `/who-owns-what`.
- **Critical vs telemetry**: never critical. A missing illustration degrades to the emoji; no user
  action fails and no data is at risk.

## Acceptance Criteria

- [ ] The ten images are committed under `packages/brand/assets/shared/cards/` and served at
      `/brand/cards/<id>.webp` after `npm run sync-brand-assets`.
- [ ] Every surface in Requirement 6 shows the illustration for the ten hero cards and the emoji for
      every other card (built-in without art, and custom).
- [ ] Deck tile: a skipped hero card and a kept-with-nobody hero card show the art greyed
      (grayscale, 55% opacity), as the emoji was.
- [ ] Drawer headers: the view drawer shows the art; the edit drawer shows the art for a built-in
      card and the live-picked emoji while editing a custom card's identity.
- [ ] Nav: The Bean Pod anchor (sidebar, drawer, phone tab) looks exactly as before.
- [ ] A unit test fails if any hero `illustration` has no master, or if `shared/cards/` holds a file
      no card references.
- [ ] A missing image renders the emoji and logs one `card-art` warn per src per session
      (verified in a unit test; manually by renaming a file in dev).
- [ ] Light and dark mode, desktop and ~400px phone: art readable on every surface, no layout shift
      or overflow in the thumbs and rows.
- [ ] `brand/cards/*.webp` appear in the built service worker precache manifest.
- [ ] `npm run validate` green.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the
      stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro;
      any new context key is allowlisted + declared).

## Testing Plan

1. `ImageGlyph.test.ts`: renders the image when `src` is set; on `error` renders the emoji and calls
   `logEvent` once with the given surface and `kind`; a second mount with the same src renders the
   emoji immediately with no `<img>` and no second log; no `src` renders the emoji; a fallthrough
   `class` lands on the image and, after an error, on the emoji; two instances with the same src both firing `error`
   produce exactly one `logEvent` and one `console.warn`; changing `src` on a mounted instance to an
   unfailed src renders the `<img>` again. Each case uses a unique src (the module Set persists
   across tests; no test-only reset export). Mock `@/services/telemetry/logEvent`, spy `console.warn`.
2. `CardArt.test.ts`: a built-in card with `illustration` renders `<img src="/brand/cards/<id>.webp">`;
   a custom card renders its emoji; `imgClass` and a fallthrough class pass through.
3. Extend `src/utils/__tests__/responsibilityDeck.test.ts` ('hero illustrations follow the …
   convention', ~line 774): for each hero,
   `expect(existsSync(join('packages/brand/assets/shared', c.illustration.replace('/brand/', '')))).toBe(true)`
   (same pattern as `navigation.test.ts:209`), so a missing or misnamed master fails
   `npm run validate` instead of reaching users as a warn. Also assert the reverse:
   `readdirSync('packages/brand/assets/shared/cards')` equals the set of hero `illustration`
   basenames exactly, so an orphaned or misnamed master fails `npm run validate` and the precache
   glob stays equal to "hero art only".
4. Existing responsibilities tests pass (update any thumb-emoji assertion).
5. `npm run validate`.
6. Browser: the design-screenshot script (Approach step 7), screenshots opened and inspected; plus
   rename one WebP in `public/brand/cards/` in dev to see the emoji fallback and the console warn.
7. `npm run build` output: grep `dist/sw.js` (or the workbox manifest) for `brand/cards/`.

## Not doing (and why)

- **Fridge sheet / PDF export art** (stretch goal): `ResponsibilityExportBody.vue` is rasterised by
  `html-to-image` in `useSheetExportRunner`; images inside it need to be loaded (and ideally inlined)
  before capture, and the export is sized page by page for the iOS canvas limit. That is its own
  change with its own verification on a phone share sheet. The sheet keeps the emoji for now.
- Ghosting the Skipped list / board thumbs: not ghosted today; unchanged.
- **`MealThumb.vue` onto `ImageGlyph`**: a third image-or-emoji component, whose `@error` fallback is
  silent today. Its src is a Drive photo URL, not a static asset, so the session-sticky failure
  (Drive hiccups are transient) and the `kind` file-name logging do not fit. Follow-up: give it its
  own `logEvent` warn (surface `meal-planner`, no URL) rather than stretching `ImageGlyph`.

## Outcome

Built 2026-09-28 via `/beanies-build-auto`, as planned, with these notes:

- **Validate** green (9445 tests); the built `dist/sw.js` precaches exactly the ten `brand/cards/*.webp`
  and no other `.webp`.
- **Browser walk** `scripts/design-screenshots/who-owns-what-capture.ts` green: art loads on the
  pile, Kept/Skipped lists, Overview rows + recent feed, check-in drawer, Deck tiles, view + edit
  drawer headers and the board; the open (laundry) and skipped (trash-night) tiles are greyed
  (`grayscale(1)`, 0.55); a hero on the phone pile fits its slab (103px image in a 129px slab);
  dragging by the art moves the card on the board (rail → member, chip → skipped); The Bean Pod
  anchor still loads. Desktop + 400px, light + dark, screenshots inspected.
- **Code review round 1** (`high`): no correctness bugs; 6 findings. Fixed: removed
  `loading="lazy"` (a lazy image in the hidden phone drawer is not fetched until it opens; ten
  precached files gain nothing from it); declared the `card-art` / `nav-glyph` `kind` values in
  `docs/runbooks/native-store-submission.md`; restored the console spy in `CardArt.test.ts`; the
  orphan-art test filters to `.webp`; STATUS updated. **Not fixed:** the nav anchor now stays on
  the emoji for the session after a failed load (NavGlyph retried per mount). The anchor PNG is
  precached, so this needs a first, uncached load where that one request fails; the emoji is the
  designed fallback and a reload retries.
- **Code review round 2** (`high`, scoped to the fixes): 7 findings. Fixed: the orphan-art test
  ignores only dotfiles (a stray `.png` would be precached by the `png` glob); STATUS no longer
  says "not committed" and lists the owed checks inline; the `kind` reuse is noted at
  `ALLOWED_CONTEXT_KEYS`; `ImageGlyph` logs a file name only for a `/brand/` src (anything else
  ships `non-brand-src`, unit-tested); `CardArt.test.ts` clears the telemetry mock per test. **Not
  fixed:** the runbook Diagnostics row was already split by a blockquote before this change (the
  new declaration sits beside the other recent ones in that tail); rejoining it is a separate doc
  fix. Eager loading after removing `lazy`: on a first visit the service worker downloads all ten
  images anyway, so it changes nothing material. Two rounds is the ceiling; no third review.
- **Deferred:** fridge sheet / PDF art; `MealThumb` failure logging.
- Pre-existing, not from this change: a Vue "extraneous class" warning from `MemberChip` inside the
  Deck tile.

## Review Passes

- **Pass 1 (Initial draft)**: drafted; generalises NavGlyph into ImageGlyph + a CardArt wrapper,
  masters in `packages/brand` (not the gitignored `public/brand`), precache via a narrow glob.
- **Pass 2 (DRY + error handling)**: reactive module Set as the single failed-src truth with a
  dedup guard + dev console hint; CardArt reads `ResolvedCard.emoji/illustration` (no composable per
  thumb); DeckOverview `recentRows` single lookup; CI test that every hero master exists; ghost via
  Tailwind utilities; MealThumb recorded as a deliberate follow-up.
- **Pass 3 (Sustainability)**: dropped the `ghost` prop for a fallthrough class; box-ownership rule
  (thumb box stays outside `CardArt`); DeckOverview feed renders one `CardArt` branch-free; drawers
  drop `:icon` for the slot with one `headerArt` computed; test also rejects orphaned art files;
  screenshot script named after the feature.
- **Pass 4 (Fresh-eyes sweep)**: DealPileStage start size corrected to fit the 42% slab on phones
  (was clipped); `failedSrcs` pinned to a plain `<script>` block; board drag-by-art added to the
  browser walk; watermarks read `card.emoji` and unused `cardEmoji` destructures removed.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (2026-09-28)

> let's start on the card art - pls provide the prompts for the card art and the relevant reference
> images (you can ref from the brand / assets dirs) and i'll attach those to the AI generated along
> with the prompts

### Follow-up 1

> done, all images are now in google drive at "Projects\beanies.family\Media\Family Responsibility
> Cards", let me now your thoughts, do these work?

### Follow-up 2

> Ok i've regenerated image 10, please check again. for the other issues (school drop off, date,
> nigh, cooking, groceries) those are find to keep as is

### Follow-up 3

> ok i've regenerated once more, pls check

### Follow-up 4

> yes go ahead with /beanies-build-auto

### Follow-up 5 (plan approval)

> Approve and build with /beanies-build-auto

(Proposal accepted in Follow-up 4: add the ten images to `public/brand/cards/`, build one shared
card-art component with the emoji fallback and the ghosted state for skipped/unowned cards, use it
everywhere STATUS lists, browser-check, code review, no deploy.)

</details>
