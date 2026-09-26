# Plan: Who Owns What, simpler dealing (round 7)

> Date: 2026-09-26
> Related issues: Notion #109 (follow-up to `docs/plans/2026-09-26-who-owns-what-responsibility-deck.md`). No GitHub issue.
> Plan file: `docs/plans/2026-09-26-who-owns-what-simpler-dealing.md`
> Mockup: `docs/mockups/family-responsibilities-deck-2026-09-25.html` (round 7, sections s1-s4, approved by greg: "The new simpler design looks perfect")

> **No GitHub issue created.** Approved for direct implementation via /beanies-build-auto.

## User Story

As a parent dealing our family's cards with my partner, I want the card pile to be the one clear thing on the screen, with a simple record of what we kept (and who has it) and what we skipped, and a way to step back and forward, so dealing feels easy and mistakes are cheap to fix.

## Context

After the #109 build, greg tried dealing and found: on desktop the pile is small and lost in the middle; once you use the board there is no way back to the pile; Keep already looks selected (orange, ticked); there is no clear view of what was kept (with whom) and skipped (the board's skipped row is too small); and there is no way to step back and forward through cards. A round 6 "dealing table" mockup was judged too busy. Round 7 keeps the pile centered as the focal point with one quiet row of two lists below, and was approved.

## Requirements

1. **Card by card is the Deal view's default at every width.** The Deal view opens the pile (card by card). At md+ a small "Board view" link (top right of the deal view) switches to the board; the board has a matching "Card by card" link back. The choice is remembered per device (`usePersistedChoice`). Phones always get the pile (no board link). The Overview's "Deal the last N" and per-card Deal buttons open the pile at that card.
2. **Pile scope.** Opening the pile fresh: unsorted cards if any exist (first deal), else waiting cards. When nothing is left to decide, the pile shows a short "all done" state (the existing completion card when fully dealt) and the lists below still show.
3. **Position and navigation.** The pile shows one card at a time with a position line above it ("Kids & School · card 3 of 21", category + index within the category, from the queue). Back and forward arrows on either side of the card step through the queue, including cards already decided. After a decision the pile advances to the next card still to decide. Clicking a card in the lists jumps the pile to that card. When the pile is showing a decided card, a "Back to <card>" link returns to the next card still to decide.
4. **Keep and Skip look equally unselected.** Both are outlined neutral buttons of equal weight (Keep left). A button fills with the orange tint only on hover, keyboard focus, or while its shortcut is pressed. No pre-selected look.
5. **Deciding (unchanged behaviour).** Keep → "Kept! Who owns it?" with the member faces (InlineMemberPicker) and "Decide later". A pick is one `deal` call (keep + deal). Skip skips. Split it stays available from the card. The deal animation stays: the card flies to the chosen face and the face bounces; on skip the card flies to the Skipped list heading (`DealPileLists` exposes the heading element via `defineExpose`; `flyTo` is a no-op on a null target). Undo toast unchanged (one at a time).
6. **Revisiting a decided card.** Held: a banner "With <name> since <date>" (split cards: one line per part). Unsplit held cards offer **Give it to someone else** (opens the faces; the current holder is excluded; picking deals to them), **Skip instead**, **Split it**; split cards offer **Split it** (the edit drawer is the per-part change) and **Skip instead**. Waiting: banner "Waiting for a holder" with the faces directly (today's waiting pick stage). Skipped: banner "Skipped" (reuses `whoOwnsWhat.pile.skipped`) with **Bring back**; bring back restores the card's previous holders (`buildBringBack`), so the pile then shows whichever banner fits the result (held, or waiting with the faces). Every change goes through `useDealActions` (undo toast).
7. **The lists below the pile.** One row (two columns at md+, stacked on phones): **Kept** (count) — kept cards (held and waiting), newest change first, each with its emoji, name and owner face + name (or "Nobody yet"; split cards show "Split"); **Skipped** (count) — skipped cards, newest first, each with **Bring back**. Each list shows its first 6 (3 on phones) with **Show all N** expanding in place. Clicking a kept row jumps the pile to that card (Requirement 3). The lists are the whole deck's state (store-derived), not session-only, so they're right after a reload or a change on another device.
8. **Simplifications.** The session emoji rows under each face and the skipped tray are removed (the lists replace them). The pile's "Use the board instead" link is replaced by the Board view link.
9. **Keyboard shortcuts** (desktop, when the pile is on screen and no input, dialog or drawer has focus): `K` keep, `S` skip, `1`-`9` pick the Nth face while the faces are shown, `←` / `→` step, `U` undo the last deck action (while its toast is up). Not advertised on screen; each button carries an `aria-keyshortcuts` attribute.
10. **Sizing.** The pile card is larger at md+ (about 300px wide), phone unchanged (about 200px). Arrows are 48px squircle buttons at md+, 40px on phones, with translated aria-labels.
11. **Children** keep today's read-only Deal view (`DeckGrid` of the cards still to deal). No change: the pile and its lists are only mounted when `canDeal`.

## Important Notes & Caveats

- **The queue model changes.** The pile tracks `currentId` (a card id, not an index). `queue` is a snapshot Set of in-scope ids taken on load; `ordered = groupByCategory(ids → store.cardById, missing filtered)` is computed from the live store, so a card deleted elsewhere drops out and order stays by category; `startId` goes through `jumpTo` (added to the queue if missing), so `position` is never undefined. The card on screen no longer derives from "first queued card still in scope", so a store refresh can't swap it mid-flight: `topId`, `shownId`, the busy-pin watcher and `firstStage()` go; `busy` stays only as the double-tap guard in `run()`. After every action one `settle()` runs: if the current card is still undecided (an Undo landed mid-flight, or a split card with another open part) reset its stage, else `currentId = nextUndecided(currentId)` (first undecided card after the current one, wrapping). `onUndone` is `() => cursor.jumpTo(c.id)` (see Settle rules). The view is `pileView(card.status, picking)`: unsorted → `picking ? 'pick' : 'sort'`; waiting → `'pick'` (with the waiting banner); held → `picking ? 'pick' : 'held'` (Give it to someone else sets `picking`); skipped → `'skipped'`. `picking` and `leaving` are the only local UI flags, reset in exactly one place (a `watch(currentId)`, plus `settle()` when the id doesn't change); no separate `stage` ref. The picker's cancel depends on its origin: from an unsorted card, "Decide later" calls `keep` then `pass(id)`; on a waiting card only `pass(id)`; on a held card it is "Cancel" (`picking = false`, no write). `pass()` is needed after `keep` because a kept card becomes waiting and would otherwise stay on screen. If the current card vanishes (`watch(current)` sees undefined while `currentId` is set), `settle(currentId, 'advance')` falls back to the first undecided card, and log `info pile_card_missing`.
- **Settle rules (one function, two modes).** `run(fn, { after })` captures the acted card id `c` and in `finally` calls `settle(c, after)`. `after: 'advance'` for first decisions (pick on an unsorted or waiting card, Decide later, Skip, group skip); `after: 'stay'` for revisit actions (Give it to someone else, Skip instead, Bring back), because Requirement 6 shows the resulting banner. `settle`: if `currentId !== c` (an Undo moved the cursor mid-flight) only reset flags; else if `'stay'` or the card is still undecided (Undo landed mid-flight, or a split card with an open part) reset flags; else `currentId = nextUndecided(c)`. `onUndone` is `() => cursor.jumpTo(c.id)`. While `busy`, arrows, list jumps and every shortcut except U are disabled, so the cursor can't move under a flight.
- **Board link placement.** The board keeps its own behaviour; only a "Card by card" link is added to it. The board's skipped row stays as it is (the lists on the pile replace the need; greg's round 6 idea of a full-height skipped row is not in round 7).
- **Lists use existing state only.** "Newest first" uses `ResponsibilityCardState.updatedAt`. No new persisted fields, no schema change.
- **Beanie mode and copy.** All new strings in `uiStrings.ts` (en + beanie), American English, no em dashes. "With {name} since {date}" uses `fillTemplate`; dates go through `formatNookDate(ymdOf(iso))` (`since` is an ISO timestamp).
- **CIG.** Neutral buttons use `line-strong` borders and ink text; hover/focus tint is Heritage Orange tint with `-lift` for any orange text in dark. The Caveat welcome line stays the only Caveat on the page. rem text only.
- **Shortcuts must not fire** while typing or with an overlay open: `hasOpenOverlays()` from `@/utils/overlayStack` (covers every `BaseModal` / `BaseSidePanel`, so the edit, view and check-in drawers and `ConfirmModal`) and a shared `isTextEntryFocused()`. Ignore `event.repeat`, `defaultPrevented`, and Ctrl/Meta/Alt. No desktop-only gate: the listener mounts with the pile. While `busy`, only `U` is live (per-handler guard). No shortcut state lives outside DealPile.
- **Test ids.** The lists must not use the `deal-pick-` prefix (the E2E test clicks `[data-testid^="deal-pick-"]` first, and the fly-to target is found by that prefix). Use `deal-list-kept-<id>`, `deal-list-skipped-<id>`, `deal-list-bring-back-<id>`.

## Assumptions

1. `DealPile.vue`, `DealBoard.vue`, `WhoOwnsWhatPage.vue`, `useDealActions.ts`, `DeckActionButton.vue` are as built on `main` today (`9a969d30`); `usePersistedChoice` and `STORAGE_KEYS` exist.
2. `useDealActions` gains `undoLast()`, which calls `invokeToastAction(liveUndoToastId)` from `useToast` when a live id exists (that helper already runs the Undo, catches errors with an error toast + console.error, and no-ops if the toast expired). With no live id it logs `console.debug('[useDealActions] undoLast: no live undo toast')`. No token stored; the one-toast rule unchanged.
3. The E2E test in `e2e/specs/cross-entity.spec.ts` uses `first-deal-start`, `deal-pile`, `deal-pile-card-<id>`, `deal-pile-keep`, `deal-pick-*`, `deal-pile-skip`; those test ids are kept so it keeps passing.

## Approach

Implements the approved mockup (round 7). Style tokens from the theme skill + CIG.

0. **Extract shared helpers first (no behaviour change):** (a) move `isTextEntryFocused()` from `useWallRoomGate.ts` to `src/utils/isTextEntryFocused.ts` and import it back; (b) `otherHumans(members, card)` in `src/utils/responsibilityDeck.ts` (members minus `card.parts[0]?.holderId`), replacing `CheckInDrawer.redealTargets`' body and used by the pile's Give it to someone else; (c) `heldSince(card, part): { name; date } | null` in `useResponsibilityCardLabel` (lifts `CheckInDrawer.heldLine`'s `part.since ?? state.createdAt` + `ymdOf` + `formatNookDate` + member name); `CheckInDrawer` and the pile banner both use it.
   0.5. **`src/components/responsibilities/usePileCursor.ts`** (new; next to `useDealActions`; only `ref` / `computed`, no store import, no DOM): `usePileCursor({ cardById, initialIds, startId? })` owns `queue` (Set), `passed` (Set), `currentId`, `ordered` (queue ids resolved via `cardById`, missing dropped, then `groupByCategory`), `current`, `position` ({ category, n, total }), `canStep(±1)`, `step(±1)` (clamped at the ends, no wrap; arrows disable at an end), `jumpTo(id)`, `pass(id)`, `remaining`, and `settle(actedId, after: 'advance' | 'stay')`. Built on pure helpers exported from the same file: `isUndecided(card, passed)` (unsorted → true; waiting → not passed; held/skipped → false), `nextUndecided(ids, fromId, pred)` (first undecided after `fromId`, wrapping; if `fromId` is absent, the first undecided from the start), `pileView(status, picking)`. Unit tests run it in an `effectScope` with a plain `Map` as `cardById` (no mount).
1. **`DealPile.vue`** (reshaped): uses `usePileCursor` for all cursor state; the view comes from `pileView` (Requirement 6); the component keeps only `run()`, the flights, `pickable` and the template. `pickable` is one computed (`view === 'pick' && card.status === 'held' ? otherHumans(members, card) : members`) passed to `InlineMemberPicker` and indexed by the `1`-`9` handler, so a digit always matches its tile. Each shortcut calls the same function its button calls, which carries its own guard (`keep` needs `view === 'sort'`; `skip` needs view `'sort'` or `'pick'` and status unsorted or waiting; digits need `view === 'pick'`), so the shortcut map stays flat. K and S only act on undecided cards; revisit changes are click-only. Group skip is unchanged (only on `view === 'sort'`, `after: 'advance'`). `logOnce(action, detail)` is a 3-line local helper over a `Set`. The `scope` prop now only chooses the initial queue; rewrite the file's top doc block (it describes the removed `topId` / busy-pin / session-log model). Remove the session log (`LogEntry`, `record` / `forget`, `logEntryFor`, `gotFor`, `trayEmojis`, `keptCount` / `skippedCount`) and the `#badge` slot use; `onUndone` is `() => cursor.jumpTo(c.id)`. Remove the tally line; keep the progress bar with the remaining count derived from undecided cards in `ordered`. Delete unused keys `whoOwnsWhat.pile.useBoard` and `whoOwnsWhat.pile.tally`. Position line + side arrows; larger card at md+. Shortcuts through the new generic `useKeyboardShortcuts` (item 7); pressed feedback via `useAttentionPulse().pulse(buttonEl, 'key-press')` (class in `style.css` + reduced-motion kill list).
2. **`src/components/responsibilities/DealPileLists.vue`** (new, rendered inside `DealPile`, so the skip fly-to target is a component ref): Kept and Skipped from a pure `keptAndSkipped(cards)` in `responsibilityDeck.ts` (kept = held|waiting, skipped = skipped, both by `state.updatedAt` desc; every deck write sets `updatedAt` via `baseState`). Each list uses `useExpandableList(list, { initial: isMobile ? 3 : 6 })` + `<ShowMoreToggle>` with `action.showAllN` (ADR-025). Owner via `MemberChip` (renders nothing for a removed member → "Nobody yet"). Bring back via `useDealActions().bringBack`, like `DeckGrid`. Emits `jump(cardId)`.
   2.5. **`src/components/responsibilities/DealPileBanner.vue`** (new, presentational, no store writes): props `card`, `view` (`'held' | 'waiting' | 'skipped'`); shows the "With {name} since {date}" lines (via `heldSince`), "Waiting for a holder" or "Skipped", plus the revisit buttons; emits `give`, `skip-instead`, `split`, `bring-back`, handled by DealPile through `run(…, { after: 'stay' })`. Keeps DealPile's template a flat `v-if` chain (done / sort / pick / banner) and DealPile.vue at or below its current size.
3. **`DeckActionButton.vue`**: add `variant?: 'default' | 'choice'`; `choice` = larger padding and a Heritage Orange tint on `:hover`, `:focus-visible` and the `key-press` pulse class, `-lift` text in dark. `default` unchanged, so board and check-in callers don't change. Keep and Skip use `variant="choice"` (replacing today's gradient/grey buttons).
4. **`WhoOwnsWhatPage.vue`**: `dealMode` (`'pile' | 'board'`) via `usePersistedChoice(STORAGE_KEYS.WHO_OWNS_WHAT_DEAL_MODE, ['pile','board'], 'pile')`. `openDeal()` always sets `dealMode = 'pile'` (first deal, Deal the last N, per-card Deal). `setView('deal')` doesn't touch the mode. `showBoard = dealMode === 'board' && !isMobile`; phones never write the mode. Log `deal_mode_set` only from the two link clicks. Delete `showPile`, `useBoard` and the `use-board` emit; update the page's doc block.
5. **`DealBoard.vue`**: a "Card by card" link (emits `use-pile`); nothing else.
6. **`useDealActions.ts`**: `undoLast()` per Assumption 2; `bringBack(cardId, opts?: DealActionOptions)` takes the same `opts` as the other actions so the pile's `onUndone` works for Bring back.
7. **`src/composables/useKeyboardShortcuts.ts`** (new, generic): `useKeyboardShortcuts(map: Record<string, () => unknown>, { enabled: MaybeRefOrGetter<boolean>, tag: string, onError? })`; one `window` keydown listener removed via `onScopeDispose`; attach/detach in try/catch with a warn (the `useEscapeClose` pattern); guards from Caveats; each handler runs in `Promise.resolve().then(fn).catch(err => { console.error(`[${tag}] shortcut "${key}" failed`, err); onError?.(key, err) })`. `DealPile` passes `onError` that logs `warn pile_shortcut_error`. Store failures already toast inside `useDealActions`, so the composable never toasts.
8. **`InlineMemberPicker.vue`**: optional `numberShortcuts?: boolean` prop setting `aria-keyshortcuts="${idx+1}"` on the first 9 tiles; default off.
9. **Copy** (new keys only, en + beanie): `whoOwnsWhat.pile.position` ("{category} · card {n} of {total}"), `pile.prev`, `pile.next` (aria), `pile.withSince` ("With {name} since {date}"), `pile.waitingBanner`, `pile.giveToSomeoneElse`, `pile.skipInstead`, `pile.backTo` ("Back to {card}"), `pile.boardView`, `board.cardByCard`, `lists.kept`. Reuse `whoOwnsWhat.pile.skipped`, `whoOwnsWhat.deck.bringBack`, `whoOwnsWhat.deck.nobody`, `whoOwnsWhat.card.splitChild` / `splitLabel`, `action.showAllN`, `whoOwnsWhat.pile.split` / `pile.skip`.

## Pass 4 amendments (authoritative where earlier text differs)

1. **Flag reset**: one watcher on `[currentId, current?.status]` that does nothing while `busy`, plus `settle(actedId, after)` for the in-flight case (a Split save or a remote change while the picker is open must not open the Give picker by itself).
2. **`scope`** only chooses the initial queue; the picker title (`pile.kept` for unsorted, `pile.whoOwns` otherwise), `decideLater` and the `groupShortcut` gate read `card.status`, not `props.scope`.
3. **Deal mode**: `dealMode` changes only from the link. `showBoard = !isMobile && dealMode === 'board' && dealRequest === null`; any `openDeal()` shows the pile without touching the saved choice. The Board view link sets `dealMode = 'board'` and `dealRequest = null`; Card by card sets `dealMode = 'pile'`. (Supersedes Approach 4's "openDeal always sets dealMode".)
4. **One board toggle owned by the page**, top right of the Deal section, shown when `canDeal && !isMobile`, label `pile.boardView` or `board.cardByCard` by `showBoard`. Delete DealPile's `showBoardLink` prop. DealBoard gets no link and no emit; delete its now-unreachable `focusCardId` prop, watcher and the page binding. (Supersedes Approach 5.)
5. **Lists jump**: clicking any row in either list jumps the pile to that card; Bring back is a separate button beside the row button (never nested). The row for the current card has `aria-current="true"` and a soft highlight; `DealPileLists` takes a `currentId` prop.
6. **Test ids**: nothing new may use the `deal-pile-card-` prefix (exact-match `getByTestId` in the E2E test would hit strict mode) or `deal-pick-`.
7. **`heldSince(card, part)`** returns `{ name: string; date: string | null } | null` (null only when the part has no holder), preserving `heldLine`'s name-only fallback. CheckInDrawer passes `live(card)` into `heldSince` and `otherHumans`.
8. **`key-press`** is a keyframe animation that paints the tint (not a static rule), so `pulse()` removes it on `animationend` and reduced motion (`animation: none`) can't leave it stuck.
9. **Hover tint** inside `@media (hover: hover)`; focus-visible and key-press everywhere.
10. **`'stay'` actions don't fly** and never set `leaving`: the banner changes in place and the toast confirms.
11. **Load timing**: `usePileCursor` exposes `load(ids, startId)`, called from DealPile's existing `watch(store.isLoaded)`; until then `ready` is false and the template shows nothing.
12. **Stable list order**: ties on `updatedAt` break by category order, then id.
13. **Width**: DealPile's root `max-w-md` moves onto the pile block; the root widens (about `max-w-3xl`) so the lists sit in two columns at md+.
14. **Shortcut guard** also bails when any Escape layer is open (export a one-line `hasOpenEscapeLayer()` from `useEscapeClose.ts`); letter keys compared lowercase; `preventDefault()` only when a handler ran.
15. **`undoLast`**: `useDealActions` tracks whether the live toast has an Undo; `undoLast` no-ops (debug log) when it doesn't, and clears the id after invoking.
16. **Done state**: when nothing is left to decide, `currentId` is null and the done / celebration card shows with no arrows and no position line. "Back to <card>" is hidden when `nextUndecided` returns null and always names the card it opens.
17. **Split banner lines** start with `partCaption`.
18. **Copy**: `lists.kept` → `whoOwnsWhat.pile.listKept`; reuse `action.cancel` for the held-picker Cancel.
19. **Tests**: no page mount test (brittle); cover the mode via the browser check and a DealPile `startId` test. Add DealPile tests: a Split save with the picker open doesn't open the Give picker; Skip on the faces view works; S on a held card does nothing.
20. `src/composables/useEscapeClose.ts` joins Files Affected (Modified).

## Files Affected

- Modified: `src/components/responsibilities/DealPile.vue`, `DealBoard.vue`, `DeckActionButton.vue`, `useDealActions.ts`, `CheckInDrawer.vue`; `src/pages/WhoOwnsWhatPage.vue`; `src/utils/responsibilityDeck.ts`; `src/composables/useResponsibilityCardLabel.ts`; `src/composables/useWallRoomGate.ts`; `src/components/ui/InlineMemberPicker.vue`; `src/constants/storageKeys.ts`; `src/services/translation/uiStrings.ts`; `src/style.css`
- New: `src/components/responsibilities/usePileCursor.ts`, `src/components/responsibilities/DealPileBanner.vue`, `src/components/responsibilities/DealPileLists.vue`, `src/composables/useKeyboardShortcuts.ts`, `src/utils/isTextEntryFocused.ts`
- Tests: `src/components/responsibilities/__tests__/usePileCursor.test.ts` (no mount), `DealPile.test.ts` (updated; remove the tray / `deal-pile-got-*` cases; cursor edge cases live in `usePileCursor.test.ts`, DealPile keeps wiring, flight and E2E-id cases), `DealPileLists.test.ts`, `src/composables/__tests__/useKeyboardShortcuts.test.ts`, `responsibilityDeck.test.ts` (`keptAndSkipped`, `otherHumans`), `useDealActions.test.ts` (`undoLast` live / expired / none; `bringBack` `onUndone`), page test for the mode switch
- Help: `src/content/help/features.ts` (`who-owns-what` dealing section)
- `docs/mockups/family-responsibilities-deck-2026-09-25.html` (approved design input, already committed)
- `CHANGELOG.md`

## Help Center Coverage

- **Action**: update existing · `who-owns-what` (`src/content/help/features.ts`): the dealing section describes card by card as the default, the back/forward arrows, the Kept and Skipped lists with Bring back and jump-to-change, and the Board view link on desktop.

## Observability Coverage

Surface `responsibilities`, existing allowlisted keys only (`action`, `detail`, `count`), no names.

- `pile_step` (detail `prev|next`) and `pile_shortcut` (detail = key class `keep|skip|pick|step|undo`), each logged once per pile mount per detail (a component-local `Set`; `logEvent` itself limits 50/min/message); `pile_jump` (detail `list`), `pile_revisit_change` (detail `give|skip|bring_back`; split is logged by the edit drawer's own save), `deal_mode_set` (detail `pile|board`), `pile_lists_show_all` (detail `kept|skipped`).
- Failure paths are the existing store/`useDealActions` ones (one toast + report per failure). A current card that vanished: move on and `logEvent info pile_card_missing` (no toast). Shortcut handler errors are caught by `useKeyboardShortcuts` (console.error) and logged `warn pile_shortcut_error`.
- Success-path signals above make step/jump/revisit rates measurable ("do people use back?").

## Acceptance Criteria

- [ ] Deal view opens card by card at every width; "Board view" (md+) and "Card by card" links switch and the choice is remembered; phones never show the board.
- [ ] The pile is centered and larger on desktop, with a position line and working back/forward arrows that include decided cards.
- [ ] Keep and Skip look equal and unselected until hover/focus/shortcut.
- [ ] After a decision the pile advances to the next undecided card; the Overview's deal buttons open the pile at the right card.
- [ ] A decided card shows its holder (or waiting / skipped). Unsplit held cards offer give it to someone else (current holder excluded), skip instead and split it; bring back restores any previous holder.
- [ ] Kept (with owner) and Skipped (with Bring back) lists below the pile, newest first, show all expands, clicking a kept row jumps the pile; correct after reload.
- [ ] Shortcuts K, S, 1-9, ←/→, U work on desktop and never fire while typing or with a dialog open.
- [ ] Children's Deal view unchanged (`DeckGrid`).
- [ ] Light and dark, 360px and desktop; no horizontal scroll; the existing E2E test still passes.
- [ ] Help Center article updated to match.
- [ ] Observability events fire as listed; no new context keys.
- [ ] `npm run validate` passes.

## Testing Plan

1. Unit: `keptAndSkipped` ordering/filtering; `otherHumans`; `useKeyboardShortcuts` guards (an overlay open via `lockBodyScroll`, a focused input or contenteditable, repeat, modifiers), a throwing or rejecting handler is logged, and the listener is removed on scope dispose.
2. `usePileCursor` unit (no mount): `nextUndecided` wrap and missing-`fromId` fallback; `step` clamps at the ends; `jumpTo` adds an out-of-scope id and `position` / `total` update; `settle` advance, stay, still-undecided (split with an open part), cursor-moved-by-undo; a first-deal Decide later (keep → waiting) is passed and doesn't stick; a deleted current card falls back; `pileView` table for all 4 statuses × picking. DealPile component: decide → advances; Undo during the flight keeps the card and resets it; Undo after advancing jumps back; arrows and list jumps disabled while busy; a revisit Give or Bring back stays on the card with the new banner; the held picker excludes the holder and Cancel returns to the banner with no write; revisit actions call the right `useDealActions` method; DealPileLists (show all, bring back, jump emit).
3. Page: mode switch persisted; phones force pile; Overview deal buttons open the pile at the card.
4. E2E: the existing Who Owns What test unchanged and green.
5. Browser: desktop + 360px, light + dark: deal three cards, step back, change a holder, skip instead, bring back from the list, switch to the board and back, shortcuts.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved round 7 mockup and the current DealPile / page wiring.
- **Pass 2 (DRY + error handling)**: swapped the index cursor and in-flight pin for an id cursor over the live category order with one `settle()`; reused `useExpandableList` / `ShowMoreToggle`, `invokeToastAction` for U, `hasOpenOverlays` plus an extracted `isTextEntryFocused`, and existing copy keys; lifted `heldLine` / `redealTargets` from `CheckInDrawer` into shared helpers; generic shortcut composable with caught handler errors; fixed Req 11 (children see `DeckGrid` today) and bring-back semantics (holders restored); guarded the `deal-pick-` test-id prefix.
- **Pass 3 (Sustainability)**: moved the cursor into a mount-free `usePileCursor` with pure `isUndecided` / `nextUndecided` / `pileView`; replaced the stage ref with `pileView(status, picking)` and one flag-reset point; split the revisit banner into `DealPileBanner`; made `settle(actedId, 'advance' | 'stay')` explicit, fixing five cursor bugs (revisit actions jumping away, a first-deal Decide later sticking, a vanished card with no anchor, arrows moving during a flight, undefined held-picker Cancel); `pickable` shared by tiles and 1-9 keys.
- **Pass 4 (Fresh-eyes sweep)**: unified `onUndone` / `settle`; fixed the per-button guard that broke Skip on the faces view; `openDeal` no longer overwrites the saved deal mode; the page owns one board toggle and DealBoard's dead focus prop goes; kept CheckInDrawer's name-only held line; fixed key-press sticking under reduced motion and hover sticking on touch; K/S only on undecided cards, no flights for revisits; defined load timing, done state, stable list order, popover guards and `undoLast` on plain toasts; renamed `lists.kept`.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

2026-09-26: "looking very good - a couple thoughts regarding the dealing: on desktop, the dealing seems to not take up space very efficiently ... no way to get back to the dealing screen ... the 'keep' card is already orange and ticked ... a way to see what was kept (and who it's with) and what was skipped ... a way to move forward and back thru cards ... let me know your thoughts"

### Follow-up 1

"yes the direction sounds good, please consult /frontend-design for the approach and proceed with the mockup once the build is complete"

### Follow-up 2

"For the mockup, even on desktop, I think we should keep the card pile and the dealing as the main centered element on top as that is the focal point of the entire view. My thinking was to just have a very simple element below or to the side of the cards showing the ones kept (with owner) and skipped, and the ability to step forward and back. Let me know your thoughts on this simpler design.. the idea is to avoid it being too complicated or intimidating for the user and focus on the card dealing"

### Follow-up 3

"Yes please mock this up and keep both designs to review against each other"

### Follow-up 4

"The new simpler design looks perfect. Please go ahead and implement with /beanies-build-auto"

</details>
