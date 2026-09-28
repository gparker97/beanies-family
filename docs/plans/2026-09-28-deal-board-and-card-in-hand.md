# Plan: Deal board that fills the screen, and the card in hand

> Date: 2026-09-28
> Related issues: #109 (Notion tracker row; no GitHub issue)
> Plan file: `docs/plans/2026-09-28-deal-board-and-card-in-hand.md`
> Mockup: `docs/mockups/who-owns-what-board-and-card-drawer-2026-09-28.html` (https://claude.ai/artifact/NvSxHoQggFbf4iNrQtH84L)

> **No GitHub issue created.** This plan was approved for direct implementation (via `/beanies-build-auto`).

## User Story

As a parent dealing the Who Owns What deck on a desktop, I want the board to give its space to the
people holding cards, and when I open a card I want to see the card itself and flip through the
others, so that dealing feels like handing out real cards and the board stays readable with a full
deck.

## Context

After the card art shipped (`728fcdba`, pushed, not deployed), greg tested the board and the card
drawer and asked for two changes before the deploy:

1. **Board (desktop only).** The member lanes sit in the top half of the board while the rail
   runs twice as far down the screen. Cause: the rail's list may grow to 34rem
   (`DealBoard.vue` `.rail-list { max-height: 34rem }`), which sets the board's height; each lane is
   only as tall as its one-line chips. Greg: use as much desktop space as possible for the lanes,
   and don't show a full lane for a member holding no cards (like the beanie wall collapses idle
   beans).
2. **Card view drawer.** Show the actual card (art, name, what done means) under the title, as on
   the deal view, so opening a card feels like holding it; navigate to the next/previous card by
   swipe or buttons.

A mockup was made and approved on 2026-09-28 with these decisions (greg's answers):

- Idle strip (members holding nothing) at the **bottom** of the lanes, not the top (the mockup drew
  it at the top; the plan follows the decision).
- Lane card second line: **the done line** (the split part replaces it on a split card), as drawn.
- **Skipped folded by default**, with a Show toggle, as drawn.
- **Keep a header icon** on the card view drawer (every drawer has one), but a single fixed icon for
  "Card Details", something more vibrant that says family sharing of responsibilities. Chosen: a
  small fan of two deal-pile card backs (Heritage Orange to Terracotta, with the beanies logo:
  parent and child holding hands). The mockup drew no icon.
- **No position dots** on the phone; the "list · n of N" counter above the card does that job.

## Requirements

### Board (desktop, `DealBoard.vue`)

1. The board fills the rest of the page on desktop, with a floor of 32rem, by CSS flex alone (see
   Approach D). The rail's list and the lanes area each scroll inside the board; the rail no longer
   sets the board's height.
2. Members **holding at least one card part** get a full lane, in the family's order (unchanged
   order source, non-pet humans). Busy and idle are partitioned from `chipsByMember`, the same
   source as the lane contents (pattern: `partitioned` in `WallChoreBoard.vue:133`).
3. Lane content is a wrapping grid of **mini cards** (min track ~11.5rem): `CardArt` at 42px in the
   category-tinted thumb, the card name (one line, truncated), and a second line `chip.caption`,
   computed once when the chip is built: the part caption (`partCaption`, accent) for a split part,
   otherwise the done line (`cardDone`), truncated. Both are set when the chip is built:
   `const pc = partCaption(card, part); { caption: pc || cardDone(card), accent: !!pc }`, with
   `accent` on the `Chip` interface (NOT `!!chip.part`: every lane chip carries a part). Skipped chips
   use `{ caption: cardDone(card), accent: false }`. Click opens the card, it is draggable (same
   `startDrag` payload), same test id `deal-chip-${memberId}-${chip.key}`. Lane and open-Skipped mini
   cards render through ONE `DealBoardMini.vue` (props: `card`, `caption`, `accent`, `muted`,
   `testid`), which also removes the existing lane/skipped chip duplication. Every card shows (the
   lanes scroll): delete `CHIP_CAP` / `expanded` / `visibleChips` / `toggleExpanded` and the
   `whoOwnsWhat.board.more` / `board.less` keys.
4. Members **holding nothing** fold into one **idle strip at the bottom** of the lanes: label "Not
   holding any cards yet", one pill per member (avatar + name), hint "Drop a card on a bean to deal
   it". Each pill is a full drop target (same `dragover` / `drop` handlers and `is-over` highlight as
   a lane), keeps the lane's `aria-label` (`board.rowLabel`), `data-row="${memberId}"`, `data-face`
   on its avatar, and the test id `deal-row-${memberId}`. A dropped card deals it; the member then
   gets a lane (derived; nothing stored). `dealTo` does `await nextTick()` before
   `landed(memberId)` so the flash and bounce land on the new lane, not the outgoing pill.
5. **Skipped** folds by default into one row: ⏭️, "Skipped", "N cards, not for this family", a stack
   of up to 6 greyed thumbs, and a Show/Hide toggle. Folded or open it is a drop target
   (`deal-row-skipped`), and keeps `data-row="__skipped"`, `data-face` on the ⏭️, and the
   `board.skippedRow` aria-label, so `landed(SKIPPED_ROW)` still flashes. Open, it shows the skipped mini cards (muted). Open/closed is a session
   `ref`, not persisted.
6. The idle strip and the Skipped row share ONE footer inside the lanes scroller, `sticky bottom-0`
   with an opaque background (dark partner), so both stay on screen as drop targets however many
   lanes there are. Opening Skipped expands the footer, but the open skipped grid is capped
   (`max-h-[12rem] overflow-y-auto`) so the footer can never cover the lanes above it. When nobody holds anything, the strip takes
   the space (`flex-1 justify-center`), as the wall does.
7. Dark mode partners for every new surface (lane tint, mini card, idle strip, footer, skipped row).
   `muted` means a greyscale thumb plus a dashed border with no shadow (as `.chip.is-skipped`
   today), never `opacity` on the text. The accent caption is `text-primary-500
dark:text-accent-lift`.

### Card view drawer (`CardViewDrawer.vue`)

8. Under the title, the drawer shows **the card itself** through the deal pile's own stage
   (`DealPileStage`, Approach A): the slab with `CardArt`, name, done line, category chip, and a slot
   under the chip with the holder lines: "Held by <avatar> <name>, since <date>" for one holder,
   one line per part (caption + holder + since) for a split card, or the existing status text
   (`card.skipped` / `card.unsorted` / `deck.nobody` / `statusLabel`) otherwise.
9. Prev/next: the stage's own arrows, ← / → keys (Approach B), and horizontal swipe
   (`useHorizontalSwipe`). Above the card, "<list label> · n of N". Arrows disabled at the ends (no
   wrap). Arrows and counter hidden when there is no list or it holds one existing card.
10. The order is **the list the card was opened from**:
    - Deck grid: the shelf (category) the tile sits in, display order; label = category name.
    - By Person: that bean's cards; label "{name}'s cards" (same key as the board lane).
    - Board: a lane (label "{name}'s cards") or Skipped (label "Skipped"). The rail opens the
      picker, not the drawer, so it has no sequence.
    - Overview: the Waiting panel's shown rows (`waitingShown`); label = its title
      (`overview.waitingTitle`).
    - Deep link `?card=` and anything else: no list.
11. Header icon: one fixed icon for Card Details, a small fan of two card backs (`CardBack.vue`:
    Heritage Orange → Terracotta gradient, white border (dark partner), the beanies logo), inline in
    `CardViewDrawer`'s `#icon` slot. `CardEditDrawer` unchanged.
12. The details below the card no longer repeat what the card shows: remove "Done looks like",
    "Held by" (single holder) and the per-part holder list (split); these are on the card. Keep
    "Before that", "beanies uses this card for", and the Edit / Close footer. Remove
    `whoOwnsWhat.details.done`, `details.heldBy` and `details.parts` (`CardViewDrawer` is their only
    user), and `details.status`, which already has no users. `public/translations/zh.json` is
    cleaned by the translation script's stale-key pass (`docs/TRANSLATION.md`); do not edit it by
    hand.
13. Phone: the card at 12.25rem, details scroll underneath, swipe works; no dots.

## Important Notes & Caveats

- The board is desktop-only (`md+` and the saved Board View choice); phones use the pile.
- The board height comes from the page's flex column inside `<main>` (Approach D); no JS.
- Idle pills must remain drop targets and stay on screen (sticky footer): dealing a first card to
  someone on the board is done by dropping on them.
- The stage's default test ids (`deal-pile-card-${id}`, `deal-pile-prev` / `-next`) and behaviour
  are unchanged for the pile; the drawer instance uses the `card-view` prefix and keeps
  `data-testid="card-view-name"` on the name (`cardDrawers.test.ts:377`).
- Sequences are built only through `cardSequence()` (de-duplicated: one member can hold several
  parts of one split card) and inside click handlers; the emit types make the sequence argument
  required, so a dropped forward fails type-check.
- i18n: every new string has `en` + `beanie`; the counter uses
  `fillTemplate(t('whoOwnsWhat.details.position'), { list, n, total })`.
- No new stored state.

## Assumptions

1. `DealBoard` builds lanes from `members` and `chipsByMember` (chips with `key`, `part`, `card`),
   plus skipped chips, with `CHIP_CAP` truncation and a separate skipped chip template
   (`DealBoard.vue:395-500`).
2. `DealPileStage.vue` holds the pile card (arrows, backs, slab, name, done, category chip, entry
   animation keyed on id) and `.card-back` styles (`:171-197`).
3. `useKeyboardShortcuts` ignores keys whenever `hasOpenOverlays()` or `hasOpenEscapeLayer()`
   (`useKeyboardShortcuts.ts:98`); the drawer's own side panel counts as both: `BaseSidePanel` →
   `useFullscreenOverlay` registers exactly one of each, and the `overlayDepth: 1` call site carries
   a comment saying so.
4. `DealPileBanner.vue:39-51` builds held-part lines from `heldSince` + `partCaption`;
   `CardViewDrawer` has a local `since()` duplicating `heldSince`.
5. `router-view` renders the page root directly inside `<main class="flex-1 overflow-auto p-4
md:p-6">` (`App.vue:2437`), which has a definite height.
6. `useHorizontalSwipe` requires `touch-action: pan-y` on its target (docblock).

## Approach

### A. The card in hand (shared stage)

`DealPileStage` becomes the shared stage. New optional props: `size: 'pile' | 'hand'` ('hand' =
15rem at md+, both 12.25rem on phones), `testid` prefix (default `'deal-pile'`: gives
`${testid}-card-${id}`, `${testid}-prev` / `-next`, `${testid}-name`), `arrows: boolean` (default
true), `leaving` defaulting to false; plus a default slot under the category chip. `DealPile` passes
nothing new. Extract only `CardBack.vue` (gradient + logo + dark border), used twice by the stage and
twice, small and fanned, in the drawer's `#icon` slot. In `size="hand"` the card grows rather than
clips: `.pile.is-hand` drops `aspect-ratio` and becomes `display: grid` with `min-height` equal to
its width × 7/5 (`21rem` at md+, `17.15rem` on phones). The article is its in-flow grid item
(`position: relative`, not `absolute inset-0`), so it stretches to at least the min-height and grows
with its content. The two backs stay `absolute inset-0` on `.pile` and follow it. In hand mode
`.slab` gets a fixed height (`flex: none; height: 8.8rem` md+ / `7.2rem` phone, the same 42% of the
min-height), because a percentage basis against a content-sized card either hugs the art or pushes
text under `overflow-hidden`. `size="pile"` is unchanged (fixed ratio, same tests). The stage's
category chip falls back to `t('lists.category.other')` for an unknown category (today's drawer
behaviour), so cards from a newer client do not show a raw id.

### B. Card view drawer

- `CardViewDrawer` props gain `sequence?: CardSequence | null`; emits `navigate: [cardId]`.
- `<DealPileStage size="hand" testid="card-view" :card :can-prev :can-next :arrows="canNavigate"
@step="go($event, 'arrow')">` with the holder lines in its slot, under the counter.
- Holder lines: extract `holderLines(card)` into `useResponsibilityCardLabel` returning **every**
  part as `{ key, memberId: string | null, caption, held: { name, date: string | null } | null }[]`
  (`held` null for an open part). `DealPileBanner` filters to `held !== null` (unchanged output,
  keeps `pile.withSince`, name alone when `date` is null). The drawer slot renders every part: held →
  "Held by {name}, since {date}" (`details.heldBySince`), or "Held by {name}" (`details.heldByName`)
  when `date` is null; open → the existing `deck.nobody` chip. Delete the drawer's `since()`.
- Keys: `useKeyboardShortcuts({ arrowleft, arrowright }, { enabled: () => open && canNavigate, tag:
'CardViewDrawer', overlayDepth: 1, onError })`. Extend the composable with `overlayDepth` (the
  overlays the surface itself sits in, default 0): skip when `openOverlayCount() > overlayDepth` or
  `escapeLayerCount() > overlayDepth`; export the two counters beside `hasOpenOverlays`
  (`utils/overlayStack.ts`) and `hasOpenEscapeLayer` (`useEscapeClose.ts`). The drawer's keys then
  pause under its delete confirm or any popover.
- Swipe: `useHorizontalSwipe` on a wrapper ref around the stage (stable across cards) with
  `touch-action: pan-y`; swipe left = next, right = previous.
- `sequenceStep(seq, cardId, exists)` (pure, in `utils/responsibilityDeck.ts` beside
  `cardSequence`) returns `{ n, total, prevId, nextId } | null` over the ids that still exist, where
  `exists = (id) => !!store.cardById(id)`. Status does not matter, so a Skipped list flips like any
  other; only a card deleted elsewhere drops out (`null` = no list, one existing card, or the
  current card not in it). The drawer renders from it; arrow/key/swipe call
  one `go(dir, input)`, a no-op when the target id is null. Key handlers return `false` at the ends
  so the browser keeps its default.

### C. Sequences

`type CardSequence = { ids: string[]; label: string }` and `cardSequence(label, ids)` (de-duplicates)
in `utils/responsibilityDeck.ts`, the only way to build one. Emitters build it in the click handler:
`ResponsibilityCardTile`'s parent `DeckGrid` (per shelf), `DeckByBean` (per bean), `DealBoard` (lane /
skipped), `DeckOverview` (Waiting). Every `open` / `open-card` emit type declares the sequence as a
**required** second parameter, `[cardId: string, sequence: CardSequence | null]`
(`ResponsibilityCardTile` unchanged; its parent builds the sequence), so `vue-tsc` rejects a
re-emit that forwards only `$event`. `WhoOwnsWhatPage` replaces `viewCardId` with one
`viewing = ref<{ cardId: string; sequence: CardSequence | null } | null>(null)`:
`openCard(cardId, sequence)` sets it whole (a deep link passes `null`, so it never inherits an old
list), `navigate` sets `if (viewing.value) viewing.value = { ...viewing.value, cardId }`, close sets `null`. The drawer
binds `:card-id="viewing?.cardId ?? null" :sequence="viewing?.sequence ?? null"`.

### D. Board layout

- No composable. When `fillsHeight` (one computed: `view === 'deal' && canDeal && showBoard`, the
  exact condition that renders `DealBoard`), `WhoOwnsWhatPage`'s root gets `flex min-h-full flex-col` (keeps
  `space-y-6`), the deal `<section>` gets `flex min-h-[32rem] flex-1 basis-0 flex-col`, and
  `DealBoard`'s root `min-h-0 flex-1 grid-rows-[minmax(0,1fr)]`. The board fills what is left of
  `<main>`'s content box (already excluding its bottom padding), floor 32rem, reacting to anything
  above it with no JS.
- Rail list `min-h-0 flex-1 overflow-y-auto` (drop `max-height: 34rem`); lanes area
  `min-h-0 overflow-y-auto` holding busy lanes then the sticky footer (idle strip + Skipped).

## Files Affected

- `src/components/responsibilities/DealBoard.vue`, `DealBoardMini.vue` (new)
- `src/components/responsibilities/DealPileStage.vue`, `CardBack.vue` (new), `DealPileBanner.vue`
- `src/components/responsibilities/CardViewDrawer.vue`
- `src/components/responsibilities/DeckGrid.vue`, `DeckByBean.vue`, `DeckOverview.vue`
- `src/pages/WhoOwnsWhatPage.vue`
- `src/composables/useResponsibilityCardLabel.ts` (`holderLines`)
- `src/composables/useKeyboardShortcuts.ts` (`overlayDepth`), `src/utils/overlayStack.ts`
  (`openOverlayCount`), `src/composables/useEscapeClose.ts` (`escapeLayerCount`)
- `src/utils/responsibilityDeck.ts` (`CardSequence`, `cardSequence`, `sequenceStep`)
- `src/services/translation/uiStrings.ts` (new keys + removed orphans, `en` + `beanie`)
- Tests: `cardDrawers.test.ts`, `DealPile.test.ts` (stage defaults unchanged), a DealBoard test
  (new), `useKeyboardShortcuts.test.ts` (`overlayDepth`), `responsibilityDeck.test.ts`
  (`cardSequence`), a `DealPileBanner` / `holderLines` case
- `scripts/design-screenshots/who-owns-what-capture.ts` (extend)
- `docs/mockups/who-owns-what-board-and-card-drawer-2026-09-28.html` (approved mockup)
- `CHANGELOG.md`, `docs/STATUS.md`

## Observability Coverage

- **Events** (surface `responsibilities`, existing): `card_view_navigate` with
  `context: { detail: 'arrow' | 'key' | 'swipe' }`, emitted through one `createChangeGate()`
  (`services/telemetry/emitPolicy.ts`) per drawer instance, signature = the input type: every change
  of input is logged plus a heartbeat on repeats (success-path rate of flipping, by input).
  `board_deal_to_idle` (info) when a card dropped on an idle pill actually deals: `onDrop` captures
  `wasIdle = !chipsByMember.value.get(key)?.length` before the await and logs only when `dealTo`
  resolves `true` (confirms the folded drop target is used).
- **Failure modes**: keyboard handler errors → `warn` `card_view_shortcut_error` via the
  composable's `onError`. A card deleted elsewhere simply drops out of the list (normal sync, not a
  failure); the current card vanishing is already toasted and logged by `useCardDrawerEnd`. The
  board height has no failure mode (CSS; worst case the 32rem floor). No bare catch.
- **Critical**: none; no data path changes.
- **Privacy**: `detail` is an existing allowlisted key with a closed value set; no new keys, no
  store-declaration change.

## Acceptance Criteria

- [ ] At 1440×900 and 1280×800 the board reaches the bottom of the page; the rail list and lanes
      scroll separately; the page does not scroll to reach the lanes.
- [ ] Members with cards have lanes of mini cards (art, name, done line or part caption; no "more"
      cap); members with none sit in the idle strip at the bottom; the strip and Skipped stay on
      screen while lanes scroll; dropping on an idle pill deals the card and that member gets a
      lane with the landing flash.
- [ ] Skipped is folded by default, accepts drops folded, and Show reveals its cards.
- [ ] Card view drawer shows the card (art, name, done, category, holder lines) under the title,
      with the fanned card-back header icon; no repeated done / holder blocks below.
- [ ] A custom card with a 3-line done line and a split card with 4 parts show every line on the
      drawer card (nothing clipped), desktop and phone.
- [ ] Arrows, ← →, and swipe move through the list the card was opened from; counter "<list> · n of
      N"; disabled at the ends; hidden without a list; keys pause under the delete confirm.
- [ ] The deal pile looks and behaves exactly as before (its tests unchanged).
- [ ] Phone: card at 12.25rem, details scroll beneath, swipe works.
- [ ] Light and dark on every new surface; no hardcoded strings; `npm run validate` green.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with
      the stated `surface`/`context`; failure modes are triageable from CloudWatch without a local
      repro; any new context key is allowlisted + declared).

## Testing Plan

1. Unit: `cardSequence` de-duplication; `useKeyboardShortcuts` `overlayDepth` (fires at depth 1 with
   one overlay, not with two); DealBoard (busy lanes vs idle pills from `chipsByMember`; drop on a
   pill deals; Skipped folded by default, toggle, drop works folded; no chip cap); CardViewDrawer
   (stage renders with `card-view` ids, counter, arrows disabled at ends, `navigate` on arrow/key,
   hidden without a sequence, no done/holder blocks below, 'Nobody yet' for an open split part and
   the no-date form); `holderLines` returns open parts with `held: null`; `sequenceStep` (ends, a
   deleted id skipped, current card not in the list → null); open Skipped grid carries the cap
   class; By Person → DeckGrid → page forwards the
   sequence; `DealPile.test.ts` stage defaults; `DealPileBanner` still renders `pile.withSince`.
2. `npm run validate`.
3. Browser: extend `who-owns-what-capture.ts`: board at 1440×900 and 1280×800 (lanes reach the
   bottom, footer at the bottom and on screen, skipped folded, drop on an idle pill → new lane),
   drawer from the Deck (arrows, ← →, counter), from a board lane, phone drawer with swipe; light +
   dark; screenshots inspected.

## Round 2: greg's review during the build (2026-09-28)

Greg tested the in-progress build and changed the drawer design; these supersede Requirements 8
and 12 and part of 5/6:

1. **Split details go below the card**, as in the mockup ("Split by child" / "Custom split": each
   part with its holder or Nobody Yet), plus any detail too crowded for the card.
2. **Full history below every card, not on it**: `cardHistory(card, moves)` (pure, in
   `responsibilityDeck.ts`) lists every deal, hand-over and return to nobody from the move log
   (undo deletes its moves, so what remains is real), when it was skipped, and when it was added
   to the deck, newest first. A card never moved still shows when it was added and first dealt.
   The card stays pure: art, name, done line, category, and the owner ("Held by {names}", each
   holder once; Nobody Yet / the status otherwise). "Before that" and the on-card "since" are
   dropped (the history covers both); keys `details.beforeThat` / `details.heldBySince` removed,
   `history.*` added.
3. **Skipped toggle** was at the far right of its row, under the Quick Add button: it now sits
   beside the "Skipped" label as a pill with a chevron.
4. **The position label** above the card was pulled onto the card by a negative margin and
   clipped by the card's tilt: it now has its own space.
5. **No gap** between the lanes and the footer: the footer follows the last lane (no
   `mt-auto`); it stays `sticky bottom-0`, so it pins to the bottom only once the lanes scroll.

## Round 3: greg's follow-up during the build (2026-09-28)

6. **Share the Deck / Export as PDF on every view** (Overview, Deal, Deck) whenever the family has
   kept cards, not only on Overview.
7. **The Deal view's mode switch is a real switch**: a `TogglePillGroup` (Card by Card | Board
   View, existing keys) beside the Overview / Deal / Deck pills, instead of a dotted text link.
   Desktop only, as before.

## Outcome

Built 2026-09-28 via `/beanies-build-auto`, with greg's Round 2 and Round 3 changes folded in.

- **Validate** green (9463 tests). **Browser walk** `scripts/design-screenshots/who-owns-what-capture.ts`
  green: board fills the page at 1440×900 and 1280×800 (24px to the bottom of `<main>`, its
  padding); a drop on an idle face deals and gives a lane; the Skipped toggle is clear of the
  Quick Add button and opens; the drawer steps "1 of 15" → "2 of 15" by → and the arrows; a touch
  swipe steps on the phone, a mouse drag does not; Share / Export on every view; the Card by Card
  | Board View switch; light + dark, screenshots inspected.
- **Review round 1** (`high`, 10 findings, all fixed): history dates no longer from `updatedAt`;
  empty board filled by the idle strip; arrow focus kept at the ends; idle pills a named group;
  touch-only swipe (`useHorizontalSwipe` `ignoreMouse`); history captions from the move itself;
  existence via a Set; owners derived from `holderLines`; `memberCardsLabel` helper; `holderLines`
  tests.
- **Review round 2** (`high`, scoped to the fixes and Round 3; 9 findings): fixed malformed-move
  guard in `cardHistory`, focus falls back to the card when both arrows are off, "Sorted for the
  first time" (a skip is a sort too), owner names via `Intl.ListFormat`, idle pill label "Drop a
  card here to deal it to {name}", duplicate Share / Export menu items removed, one plain
  `setDealMode`. **Not fixed:** a deal lost to a simultaneous one on another device still shows in
  the history (it happened on that device; the card shows the current holder; docstring
  corrected); an id-keyed map behind `store.cardById` (store change, out of scope).
- Two rounds is the ceiling; no third review.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved mockup + greg's five answers.
- **Pass 2 (DRY + error handling)**: board height by CSS flex (no fourth observer); reuse
  `DealPileStage` as the shared stage (no `CardFace`); keys via `useKeyboardShortcuts` + new
  `overlayDepth`; shared `holderLines`; `cardSequence` de-dup + forwarded re-emits; real entry
  points (rail opens the picker; Overview = Waiting only); gated `card_view_navigate`; sticky footer
  keeps idle strip + Skipped on screen; one `DealBoardMini`, chip cap removed; `nextTick` before the
  landing flash; split-card holder block removed below (on the card).
- **Pass 3 (Sustainability)**: `holderLines` keeps open parts + a no-date form; the drawer card
  grows instead of clipping; open Skipped capped; the sequence is a required emit argument
  (type-checked); one `viewing` ref; pure `sequenceStep`; `fillsHeight` = exactly when the board
  renders; `board_deal_to_idle` only on a real deal.
- **Pass 4 (Fresh-eyes sweep)**: hand-size card as a grid item with a fixed-height slab (no
  collapse, no clip); `accent` from the part caption, not `chip.part`; muted = greyscale + dashed
  (no text opacity), accent caption with its `-lift`; Skipped keeps its landing hooks;
  `sequenceStep` keys on existence, not status; orphan keys named; nullable spread fixed;
  category fallback kept.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-28)

> THis looks great and almost ready. Just a couple more UI suggestions / fixes before we do final
> test and deploy:
>
> 1. On the board view for card dealing (which only shows when on desktop) the family member lanes
>    are scrunched into the top half of the view, even when more space is available below - in my
>    case, i can see the side rail with the deck extending down the screen about twice as much as the
>    horizontal family member lanes. Given these lanes hold a lot of information (many cards) I think
>    we should use as much space as possible here, can we improve the layout here so we're using as
>    much of the available desktop space to show the lanes, and also, we don't need to show a full
>    lane for family members who don't hold any cards - similar to how we save space on the beanie
>    wall by collapsing lanes/columns for family members who have no chores or activities, let's save
>    spce hre as well as use the available to space to show who is holding cards
>
> 2. on the 'card view' sidrbar drawer, if there is space, i would suggest to show the actual card
>    (i.e. cooking dinner) together with the card graphic/emoji and what 'done' means under the main
>    "card details" title, just like a card is shown on the deal view. this reinforces the image of
>    it being a card that can be held, and the feeling of holding a card. so when opening up the
>    sidebar, rather than just seeing a list of the details in the card, you see the actual card you
>    have been dealt. Perhaps we can even have the ability to swipe or navigate from card to card by
>    swiping right/left or clicking a button to view next/previous cards.
>
> what do you think?

### Follow-up 1

> yes pls do the mockup

### Follow-up 2 (mockup decisions + go)

> mockup looks good - regarding the questions:
>
> 1. i prefer the idle strip at the bottom rather than occupying more valuable space at the top
> 2. keep as done line as it is now
> 3. i think folded by default is ok
> 4. every drawer has a header icon, so to keep the consistency i would say to keep it, but since
>    the card art is on the card, we can have a single icon to represent the 'card details' drawer -
>    can we find something more vibrant here to represent the family sharing and breakdown of
>    responsibilities
> 5. agree to leave out
>
> go ahead with /beanies-build-auto

</details>
