# Plan: Who Owns What, the family responsibility deck

> Date: 2026-09-26
> Related issues: Notion #109 (Beanies Main Issue Tracker). No GitHub issue (row says SKIP).
> Plan file: `docs/plans/2026-09-26-who-owns-what-responsibility-deck.md`
> Mockup: `docs/mockups/family-responsibilities-deck-2026-09-25.html` (approved v7, committed `8b4b789e`)

> **No GitHub issue created.** This plan was approved for direct implementation (greg: "go ahead with /beanies-plan and proceed to /beanies-build-auto once done. only stop for a genuine showstopper or blocker"). Feature gate: NO, ship ungated.

## User Story

As a parent trying to share the mental load fairly, I want a deck of household responsibilities that my partner and I hold, split and trade inside beanies, so that who owns what is never a debate, and the app quietly puts the right person on the right things without me asking.

## Context

Families running Fair Play have no place in beanies to record who owns which household responsibility. Beanie Lists (#33) carry Fair Play-inspired categories, but a list has one owner and nothing feeds anywhere else. This adds a new Treehouse page, **Who Owns What**: a categorised deck of about 80 original beanies responsibility cards that members keep or skip, hold, split and re-deal. Card holders become creation-time defaults for meal cooks, list owners and helpful-hint assignees; the Nook briefing shows your cards, cards nobody holds, re-deal notes and the family check-in reminder; and a printable fridge sheet puts the dealt deck on paper.

The design went through five mockup rounds with greg on 2026-09-25/26 (approved v7). Key decisions (all greg, 2026-09-26):

- **Coverage, never comparison.** No per-person totals on the overview, briefing or fridge sheet. #109's original "one member holding far more" deal check is dropped (the Fair Play book advises against comparing raw counts). Small per-bean counts are allowed only in the deal rail and the by-bean view.
- **Family check-in is in v1**: every 2, 4 (default) or 8 weeks, or off.
- **One-pass first deal**: "keep this card, or skip it?" (keep first, on the left), keep asks who owns it immediately, "decide later" leaves it waiting.
- **Skip, never delete built-ins.** Only custom cards can be deleted. Built-in cards show a disabled delete tile with an (i): "this is a built-in card, so it can't be deleted. you can always skip it to keep it out of your pile."
- **Restore default cards** restores every built-in card and starts the deal over, with a choice to keep (default) or clear custom cards.
- **View + edit drawers** like activities and transactions.
- **Deal animation in v1** that shows who got what.
- **Fridge sheet PDF** following the meal planner export conventions, multi-page when needed.
- **Ninth category "people we love"**, shared with Beanie Lists.
- **Page name "Who Owns What"**, in the Treehouse between Meal Planner and The Pod.
- **About 10 hero cards get illustrations**; the rest use emoji and category tint.
- **American English** in all card copy.

## Requirements

1. **Page and navigation.** A new route `/who-owns-what` ("Who Owns What", nav emoji 🙋) in the Treehouse directly after Meal Planner, mobile category `planning`, ungated. Three views in one segmented control: **Overview** (default), **Deal**, **Deck**. The last-used view is remembered per device. Deep links: `?view=overview|deal|deck` and `?card=<cardId>` (opens the card's view drawer).
2. **Built-in deck.** ~81 static cards (draft list in Appendix A) across nine categories: `home, out, kids, health, celebrations, people, trips, projects, me`. Each card: stable id, category, emoji, i18n name key, i18n done-line key, optional group tag (for skip shortcuts, e.g. `car`), optional `splitHint` (`child` for kid cards), optional `illustration` path (hero cards). Names are Title Case in `en`, lowercase in `beanie`, American English, original wording (no Fair Play card or suit names).
3. **Card states.** Each card is in exactly one state per family: **unsorted** (never kept or skipped; only exists before/while dealing), **waiting** (kept, at least one part with nobody), **held** (kept, every part has a holder), **skipped**. The family's **deck** = waiting + held. Skipped cards are excluded from every count and from the fridge sheet.
4. **Holding.** One holder per card, or one holder per split part. Holders must be current, non-pet members. Children may hold cards. Only adults (`isAdultMember`) can deal, re-deal, keep, skip, split, edit, add, delete, restore, run a check-in or change the rhythm; children see the page read-only. A holder who is removed from the family is treated as nobody (the part becomes waiting).
5. **Splitting.** A card can be split **by child** (one part per current child, keyed by child id; a new child gets a new part with nobody automatically; a removed child's part disappears) or **by label** (free-text labels the family types, e.g. "upstairs", "the apartment"; add/remove/rename parts). Switching back to one holder keeps the first part's holder.
6. **Re-deal and history.** Changing a part's holder records a write-once move (from, to, by, at). The card shows "since <date>" and the previous holder. Both the previous and the new holder get a dismissable briefing note.
7. **Overview view.** Ring: dealt (held) out of deck. Legend: held, waiting, skipped counts, and "N in your deck, out of M in the full set". Primary button "Deal the last N" (to the Deal view filtered to waiting) when waiting > 0, secondary "See the skipped pile". **By category**: a row per category with a held/waiting bar, "all N dealt" or "N waiting", and the holders' faces (no counts). **Waiting for a holder** list with per-card Deal buttons (opens the deal pile at that card). **Recent moves** (last 30 days, newest first, max 5): re-deals, custom cards added, splits, skips, check-ins. **Family check-in card** (last check-in, agenda chips, Start / Remind me later). **Facts**: every adult holds at least one just-for-me card (✓ or a gentle nudge), N split cards, children holding cards (faces only). Never a per-person total.
8. **Deal view.** Desktop/tablet (`md:` and up): the meal-planner board turned sideways: a left rail (Deck title, "N cards still to deal", search over all kept cards, To deal / All toggle, cards grouped by category, a New card button) and one row per non-pet member (face, name, small count caption, their cards as chips, a drop target) plus a **Skipped** row as a drop target. Drag a rail card or a chip onto a row to deal/re-deal; onto Skipped to skip. Tap/keyboard fallback: tapping a card opens `InlineMemberPicker` (same as the phone pile), so touch tablets and keyboard users are fully supported. Phone: the **deal pile** (Requirement 9) over the waiting cards.
9. **Deal pile (phone deal view and first deal).** One card at a time on top of a pile. First deal asks "Keep this card, or skip it?" with **Keep** (primary, left) and **Skip**. Keep reveals "Who owns it?" with the member faces, plus "Decide later, keep it waiting". Card actions: split it (opens the split editor), skip. Group shortcuts: when the top card has a group tag with more than one unsorted card (e.g. `car`), offer "No car? Skip all 3". Progress bar and "N cards to go · kept X · skipped Y".
10. **Deal animation (v1).** On deal, the card flies to the chosen face (Web Animations API, ~550ms), the face bounces, and the card's emoji joins a small row under that face for the session, so it is visible who got what. On skip, the card drops into a Skipped tray whose emoji row grows. Every deal/skip/keep shows a toast with **Undo** (6s). Rail drops: the chip snaps into the row, the row flashes the drop highlight, the face bounces, and the same undo toast shows. Reduced motion: instant swap, no fly or bounce, toast still shows.
11. **Deck view.** Category pills (all nine, plus "Nobody yet" and "Skipped · N") filtering shelves of card tiles (portrait card: tinted slab with emoji or illustration, name, done line, holder faces/names, split caption). Skipped filter shows skipped cards with "Bring back".
12. **Card view drawer.** BeanieFormModal drawer, title "Card Details", icon = card emoji. Shows only filled fields: name, category chip, holder(s) with "since", previous holder, split parts, "Done looks like, at a minimum", "beanies uses this card for" (only when `cardUsesFor(cardId)` is non-empty). Footer: delete tile (custom cards) or disabled delete tile with (i) (built-in), outlined Edit, Close.
13. **Card edit drawer.** Every option: name, emoji, category (custom cards only; built-ins keep their name/emoji/category), holder picker, split editor (one holder / by child / by label), "What done looks like (at a minimum)" (editable for every card, stored as a family override; clearing it restores the default), "Skip this card for now" toggle. Also used to create custom cards ("New card": name, emoji, category, done line, optional holder).
14. **Delete.** Custom cards only, via the drawer's delete tile, behind a danger confirm ("Delete <name>? This is a card your family made, so deleting it removes it for good, along with its history."). Deleting removes the card state and its moves.
15. **Restore default cards.** From the page's ⋯ menu. A danger modal: "Restore the default cards and start over?", body explaining every built-in card comes back (including skipped), every holder, split and history is cleared and the deal starts again, and it can't be undone; radio options **Keep our own cards (N)** (default) / **Clear our own cards too**; Cancel / Restore and start over. Check-in history is kept. Kept custom cards stay in the deck as waiting: holders and split cleared, `custom` and `doneOverride` preserved, their moves deleted. Every non-custom state is deleted, including ids this build doesn't recognise. On success: toast, switch to Overview (which now shows the first-deal empty state).
16. **Page menu (⋯).** Share the deck, Export as PDF, Check-in rhythm (every 2 / 4 / 8 weeks / off), See skipped cards, Restore default cards.
17. **First deal.** When no built-in card has a state (every built-in card is unsorted), the Overview shows the first-deal empty state (hugging beanies, "Let's deal the deck", 3 steps, Start dealing, Browse the deck first). Start dealing opens the deal pile over all unsorted cards in category order. When the last unsorted card is sorted and every kept card has a holder, celebrate ("Every card has a holder!").
18. **Family check-in.** Rhythm in family settings: 2, 4 (default), 8 weeks, or off. Due when rhythm is on and (no check-in yet and the deck has been dealt at least rhythm-weeks ago) or (today >= last check-in + rhythm). The check-in drawer shows an agenda: cards with nobody (deal now), cards moved since the last check-in ("settling in" / "let's talk"), and up to 3 cards unchanged for the longest (at least 90 days: "still works" / "let's talk" / "re-deal"). Finish records a write-once check-in (date, by, counts of outcomes) and celebrates ("Deck checked"), showing the next due date. "Let's talk" items are listed in the completion message (no to-do created in v1).
19. **Fridge sheet.** Share (PNG) and Export as PDF, from the ⋯ menu and the Overview. Built on `ExportSheet` + `useSheetExport`: landscape A4, light only, header with the hugging mark, "Who Owns What" heading and a Caveat accent line, "Dealt as of <date>". Body: category blocks (3 columns) with each card's emoji, name, done line and holder initial pills (member colour; split parts show the part label beside each pill); waiting cards get a dashed write-in line; skipped cards omitted. Footer legend "Holders" (initial pill + name) and "- - - still to deal, write a name in", plus the wordmark and tagline. **Multi-page**: pages break between category blocks, never inside one; every page repeats a slim header ("Who Owns What · page 2 of 2") and the legend. PDF = one A4 page per sheet page; Share = one PNG with the pages stacked.
20. **Integrations (creation-time defaults, never on edit).**
    - **Meals:** a new meal in the dinner slot with no cook defaults the cook to the holder of `cooking-dinner`; a new breakfast meal defaults to the holder of `breakfast`. Only when the card is held by a single holder (unsplit). Only for `recipe` / `other` meal kinds. The meal edit modal shows an InferredHint ("Sofia holds Cooking Dinner in Who Owns What.") whenever the chosen cook equals that holder (derived, nothing stored).
    - **Lists:** the template → card mapping lives in `CARD_DEFAULTS.listTemplate` (`grocery` → `grocery-shopping`, `vacation-packing` → `trip-packing`); `listTemplates.ts` is unchanged; creating a list from such a template defaults the owner to that card's single holder instead of the current member, and NewListSheet shows an InferredHint. Blank lists keep today's owner default.
    - **Helpful hints:** hint types map to cards (`birthday-present`, `birthday-party-gift`, `celebration-gift` → `gifts-for-others`; `anniversary-plan` → `date-nights`; `trip-packing` → `trip-packing`; `trip-documents` → `passports-and-documents`). When the mapped card has a single holder who is an eligible audience member (not the birthday person), the new hint is assigned to that holder instead of the default audience. Its hint chip explains (derived) "Assigned from Who Owns What".
21. **Nook briefing (new rows, above the hint block).** (a) **Your cards** glance for the viewer when they hold at least one card (caption lists up to 3 names + "your N cards"; tap opens the page). (b) **Card moved** note for the previous and new holder of any re-deal (a move from one holder to another, made by someone else) in the last 14 days not yet dismissed, at most 3 at a time ("Laundry moved to greg on Monday." / "You now hold Laundry, from Sofia."), dismissable, synced across the member's devices. (c) **Cards with nobody** (adults only) while waiting > 0, with the first three names; tap opens the Deal view. (d) **Family check-in due** (adults only) from the due date until completed, snoozable for 7 days.
22. **Ninth category, shared with lists.** Add `people` ("People We Love" / "people we love", short "People", emoji 💞) to `ListCategory` and `LIST_CATEGORIES`, so Beanie Lists offers it too. Add `people` to the wall's private categories. Make BeanieListsPage render lists with an unknown category in a fallback shelf so future category additions can't hide lists on older clients again.
23. **Hero illustrations.** ~10 hero cards reference an optional `illustration` asset; until greg generates the images, those cards render the emoji. The plan delivers the nano-banana prompts (Appendix B).
24. **Help Center.** New how-to article, updated Beanie Lists categories section, updated daily briefing article.
25. **Telemetry** per Observability Coverage.

## Important Notes & Caveats

- **Older clients and the ninth category.** A list created in `people` syncs to a device still on 0.23. There, BeanieListsPage builds shelves only from `LIST_CATEGORIES`, so the list **does not appear on the lists page** (it still appears in due-soon, cycle shelves and the wall; its label renders as the raw id). Because `PRIVATE_LIST_CATEGORIES` only gains `people` on new clients, an old client's wall shows `people` lists publicly until it updates. Wall devices are PWAs and pick up the update on next load, but the release's internal notes must say so. The data is not lost and it reappears after the update. This is not data damage, so the update floor is not raised. Web clients update immediately; store builds follow the next release. Requirement 22's fallback shelf prevents a repeat for future additions. Record this in the release note's internal notes, not the user-facing copy.
- **Older clients and the new collections.** Adding root keys is safe: `migrateDoc` adds missing roots, and compaction keeps unknown roots (`applyAndProject.ts compactDoc` rebuilds from the whole doc). Older clients simply ignore the cards.
- **CRDT merge semantics.** Card state is always written with a whole-record `set` (`createWithId` / batch `set`), never a field `patch`. `parts` is therefore last-writer-wins per card: two adults dealing the same card (or two parts of it) at the same moment resolve to one version. Acceptable (rare, visible). A whole-record `set` also means a restore/delete racing a deal on another device can only resurrect a **complete** record, never a partial one. History is NOT an array on the card: each move is a write-once record with a unique id, so moves merge cleanly. **Moves are advisory history; card state is the truth.** A concurrent loss can leave a move whose `toId` isn't the part's current holder; `resolveDeck` ignores such superseded moves for "since" and "previous holder", and the briefing "card moved" note only shows for a move whose `toId` still holds that part. Check-ins are write-once too. The only paths that delete moves are `deleteCustom`, `restoreDefaults`, and undo of a move the same session just created. The repository header says so, following `listCycleRepository.ts`.
- **Built-in card state ids are the static card id** (deterministic), so two devices keeping the same card converge on one record instead of creating duplicates. Custom cards use `custom-<uuid>`.
- **Settings singleton is replaced whole.** Only the rarely changed check-in rhythm goes there (`responsibilityCheckInWeeks`); the last check-in is derived from the check-in records, not stored in settings.
- **CIG over mockup.** The mockup uses Caveat for "who takes this one?" in the deal pile; Caveat is forbidden for UI labels, so the pile question uses Outfit. Caveat is used only for the page welcome subtitle (one per page, via `PageWelcomeSubtitle`) and the fridge sheet accent line (matches the meal sheet). Red is used only for the delete and restore confirms (destructive). Every accent used as text has its `-lift` dark partner; every painted background has a dark partner; no opacity modifiers on readable text. rem-based text only.
- **Beanie mode floor.** Card names and cosmetic copy may be playful; delete and restore confirmations are important surfaces and keep the real nouns ("card", "cards your family made", "history", "start over").
- **Native DnD is mouse-only.** Touch tablets and keyboard users use the tap-to-deal picker (Requirement 8), which also serves accessibility.
- **Birthday exclusion is structural.** The card holder is used only when they're in the hint's computed audience, and the `birthday-present` audience already excludes the birthday person, so no special-case code is needed.
- **No numbers about people** in any copy: "your N cards" appears only to the viewer about themselves in the briefing glance.
- **Undo** is in-memory (per session) and exists only for the toast actions: `deal`, `keep` ("decide later"), `skip` (incl. group skip) and `bringBack`. Edit, split, custom create/delete, restore and check-in have no undo (edit/split are reversed by editing again; delete and restore sit behind confirms). One generic token: `UndoToken = { action; before: Record<cardId, ResponsibilityCardState | null>; afterUpdatedAt: Record<cardId, string>; createdMoveIds: string[] }`. One `undo(token)` restores exactly those records (`set` the snapshot, or `delete` when `before` is `null`) and deletes `createdMoveIds`, in one batch; no per-action inverse functions. The stale check covers every card in the token: if any live `updatedAt` differs, the whole undo is refused (visible message, `undo_stale` logged), so a group skip never half-undoes. After a reload the token is gone; re-dealing reverses the change.
- **"Why" is derived, never stored.** The "filled in from Who Owns What" explanations on meals, list templates and hint chips are computed at render time from the current holder, so there is no schema change on meals or to-dos and nothing can drift.
- **The store guard enforces child read-only** on every write path. It is an app-level rule (anyone holding the family key can write the doc), matching every other permission in beanies.

## Assumptions

1. `isAdultMember` (`src/composables/useMemberInfo.ts:34`) is the right gate for dealing (owner or ageGroup adult, never pets).
2. **Verified, with a fix.** `notificationReads` can hold card-move dismissals keyed `card-move:<moveId>` and check-in snoozes keyed `card-checkin:<dueDate>`. The bell never lists them, but `pruneReads()` deletes every id the bell doesn't derive unless its prefix is in `PRUNE_EXEMPT_PREFIXES` (`src/utils/notifications.ts`). Do **not** add them to `PRUNE_EXEMPT_PREFIXES` (its invariant is "bounded by static content count"; moves are unbounded). Add `AGED_EXEMPT_PREFIXES = [CARD_MOVE_PREFIX, CARD_CHECKIN_PREFIX]` with `AGED_EXEMPT_MAX_DAYS = 30`: `pruneReadState(map, keepIds, nowIso)` keeps these keys only while `readAt` is within 30 days (a moved note shows for 14 days and a snooze lasts 7, so nothing can resurface). One parameter + one condition in the existing pure reducer, unit tested at 29 / 31 days. Write only through `notificationsStore.markRead(id)`, the only writer, which already reports failures at `notifications-markRead`. Read through a new `notificationsStore.readState` computed; `snapshot` is refactored onto the same computed so the store reads the projection in one place.
3. **Verified: not extended.** `deliverFile` / `shareOrDownloadFile` handle one file at every layer. Share sends **one PNG of all pages stacked** (the export host wrapper is captured once). PDF uses one A4 page per sheet page. `deliverFile` only gains two `FileKind` values: `'responsibility-deck-pdf' | 'responsibility-deck-png'`.
4. **Verified:** `MEAL_SLOTS` = `breakfast | lunch | dinner | snack` (`src/constants/mealSlots.ts`).
5. **Verified:** list template keys are `grocery` and `vacation-packing` (`src/constants/listTemplates.ts`). The mapping lives in `CARD_DEFAULTS` (§1), so `listTemplates.ts` is not modified.
6. **Verified:** `useCelebration` is driven by a `configs` record. Two entries plus `celebration.deckDealt` / `celebration.checkInDone` keys; renderers untouched.
7. The E2E budget has room (21 of 25 used); this feature adds one test to an existing spec.

## Approach

This plan implements an approved mockup (`docs/mockups/family-responsibilities-deck-2026-09-25.html`). It reproduces the mockup's layout, hierarchy and interactions, with every concrete style token from the beanies theme + CIG.

### 1. Data model

**Static deck** — `src/constants/responsibilityCards.ts`:

```ts
export interface ResponsibilityCardDef {
  id: string; // stable slug, e.g. 'cooking-dinner' (never renamed)
  category: ListCategory;
  emoji: string;
  nameKey: UIStringKey; // 'cards.cookingDinner.name'
  doneKey: UIStringKey; // 'cards.cookingDinner.done'
  group?: 'car' | 'yard' | 'pool' | 'baby' | 'pet' | 'school'; // skip shortcuts
  splitHint?: 'child'; // suggested split in the editor
  illustration?: string; // /brand/cards/<id>.webp for hero cards
}
export const RESPONSIBILITY_CARDS: readonly ResponsibilityCardDef[] = [/* Appendix A */];
export function getResponsibilityCard(id: string): ResponsibilityCardDef | undefined;

/** The ONE source of truth for every place beanies uses a card as a default. */
export const CARD_DEFAULTS = {
  mealSlot: { dinner: 'cooking-dinner', breakfast: 'breakfast' },
  listTemplate: { grocery: 'grocery-shopping', 'vacation-packing': 'trip-packing' },
  hint: {
    'birthday-present': 'gifts-for-others',
    'birthday-party-gift': 'gifts-for-others',
    'celebration-gift': 'gifts-for-others',
    'anniversary-plan': 'date-nights',
    'trip-packing': 'trip-packing',
    'trip-documents': 'passports-and-documents',
  },
} as const satisfies {
  mealSlot: Partial<Record<MealSlot, string>>;
  listTemplate: Record<string, string>;
  hint: Partial<Record<HelpfulHintType, string>>;
};
export type CardDefaultTarget =
  | { kind: 'mealSlot'; slot: MealSlot }
  | { kind: 'listTemplate'; key: string }
  | { kind: 'hint'; hintType: HelpfulHintType };
/** Derived "beanies uses this card for" lines for the view drawer. */
export function cardUsesFor(cardId: string): CardDefaultTarget[];
```

Labels are resolved at render time by `useResponsibilityCardLabel` (mirrors `useListCategoryLabel`; custom cards return their plain text). It never logs. Unknown ids (a card from a newer client) are **returned** by `resolveDeck` as `unknownIds`, and the store logs `unknown_card` once per id. Detection and logging each live in exactly one place.

**Types** — `src/types/models.ts`:

```ts
export type CardSplitMode = 'single' | 'child' | 'label';
export interface CardPart {
  key: string;
  label?: string;
  holderId?: string;
} // key: 'main' | childId | label uuid
export interface ResponsibilityCardState {
  id: string; // built-in card id, or 'custom-<uuid>'
  status: 'kept' | 'skipped';
  splitMode: CardSplitMode;
  parts: CardPart[]; // 'single' → [{key:'main'}]; 'child' → keyed by childId; 'label' → label parts
  doneOverride?: string;
  custom?: { name: string; emoji: string; category: ListCategory }; // custom cards only
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ResponsibilityMove {
  // write-once
  id: string; // `${cardId}:${partKey}:${at}`
  cardId: string;
  partKey: string;
  partLabel?: string;
  fromId?: string;
  toId?: string;
  byId?: string;
  at: string;
}
export interface ResponsibilityCheckIn {
  // write-once
  id: string; // ISO date 'YYYY-MM-DD' (one per day)
  completedAt: string;
  byId?: string;
  stillWorks: number;
  talkAbout: number;
  redealt: number;
  dealtNow: number;
}
```

No `cookFromCardId` or `hintCardId` fields (see Caveats: "why" is derived). Settings: `responsibilityCheckInWeeks?: 0 | 2 | 4 | 8` (default 4 via `getDefaultSettings`).

**Document** — `src/types/automerge.ts`: add root collections `responsibilityCards`, `responsibilityMoves`, `responsibilityCheckIns` to `FamilyDocument` and `COLLECTION_NAME_SEED`. Everything deriving from `COLLECTION_NAMES` (migration, projection, cache fingerprint, export, E2E bridge, compaction) picks them up automatically.

**Repositories** — `src/services/automerge/repositories/responsibilityRepository.ts`: three `createAutomergeRepository` instances plus one `applyDeckOps(ops: DeckOp[])` batch executor using `mutate({op:'batch'})`, following `listCycleRepository.ts`. The repository **computes nothing**: it writes precomputed state sets, state deletes and move sets as one Automerge change. Every decision about what to write lives in the pure builders (§2a). This is the single write surface for the three collections, so all data loss can be audited in one file.

### 2. Pure domain logic — `src/utils/responsibilityDeck.ts` (unit tested)

- `resolveDeck(defs, states, moves, members)` → `{ cards: ResolvedCard[]; unknownIds: string[]; invalidIds: string[] }`: validates each state record's shape (`status`, `splitMode`, `parts` array; a malformed record is treated as unsorted and returned in `invalidIds`; the store logs `invalid_card_state` once per id), then merges static defs + custom states; derives `status` (`unsorted | waiting | held | skipped`); resolves parts against current members (removed or pet holder → nobody; `child` mode rebuilt from current children, preserving stored holders by child id); `since` and `previousHolderId` per part from the latest move whose `toId` equals the part's current holder (superseded moves ignored).
- `deckStats(cards)` → `{ total, deck, held, waiting, skipped, unsorted, splitCount }`.
- `categoryCoverage(cards)` → per category `{ deck, held, waiting, holderIds }` (no per-person counts).
- `recentMoves(moves, checkIns, states, today, limit)`.
- `singleHolderOf(cards, cardId)` → member id or undefined.
- `defaultHolderFor(cards, target: CardDefaultTarget)` → `{ memberId; cardId } | null` (the `CARD_DEFAULTS` lookup + `singleHolderOf`); pure so integrations and tests don't need a mounted store.
- `buildCardBriefingRows({ cards, moves, checkIns, rhythmWeeks, readState, viewerId, viewerIsAdult, today })` → the four briefing row kinds (mine / moved / nobody / checkin), each with its `dismissKey`; moved notes, the Overview "recent moves" re-deals and the check-in "moved since" agenda share one predicate, `isRedeal(m) = !!m.fromId && !!m.toId && m.fromId !== m.toId`, so first deals and clears never produce a note; a note is never shown to the member who made the move (`byId === viewerId`), and at most the 3 newest moved notes show per viewer; `useCriticalItems` only maps them.
- `isCheckInDue(weeks, checkIns, firstDealtAt, today)` and `nextCheckInDate(...)`. `firstDealtAt` = the earliest `createdAt` among kept states (derived, not stored). Check-in ids use the local date from `useToday` / `toISODateString`.
- `buildCheckInAgenda(cards, moves, lastCheckIn, today)`.
- `groupShortcut(cards, card)` → `{ group, unsortedIds }` when > 1.

### 2a. Pure operation builders — `src/utils/responsibilityOps.ts` (unit tested)

Each mutating store action is a thin call to one builder: `(resolvedCard(s), input, actorId, nowIso) → { ops: DeckOp[]; undo?: UndoToken; telemetry }`. Builders: `buildDeal` (an unsorted card becomes kept in the same op list, so the pile's Keep → pick is **one** write and one undo), `buildKeep`, `buildSkip(ids[])`, `buildBringBack`, `buildSaveCard(card, draft)` (diffs the edit drawer's draft into one op list: state set + a move per changed part), `buildCreateCustom`, `buildDeleteCustom`, `buildRestoreDefaults(keepCustom)` (rules in Requirement 15), `buildCheckIn`, `buildUndo(token)`. Move ids come from exactly one helper, `moveId(cardId, partKey, at)`; part-key rules (child ids, label uuids, `'main'`) live here and nowhere else. The store stays orchestration only: guard, `wrapAsync`, verify, log, celebrate.

### 3. Store — `src/stores/responsibilityStore.ts` (Pinia composition, modelled on `mealPlanStore`)

State: `states`, `moves`, `checkIns`, `isLoading`, `error`. Computed: `resolved`, `stats`, `coverage`, `waiting`, `myCards(memberId)`, `checkInDue`, `canDeal` (current member is adult). Actions (contract below): `deal(cardId, partKey, memberId|null)` (also keeps an unsorted card), `keep(cardId)` (decide later), `skip(cardIds[])`, `bringBack(cardId)`, `saveCard(cardId, draft)` (the edit drawer's single save: holder(s), split mode/labels, done override and the skip toggle in **one** batch), `createCustom(input)`, `deleteCustom(cardId)`, `restoreDefaults({ keepCustom })`, `completeCheckIn(outcomes)`, `setRhythm(weeks)` (via settingsStore). Each action is guard → builder (§2a) → `responsibilityRepository.applyDeckOps` → verify → log. Expected ~350 lines; if it grows past ~450, move check-in (`checkInDue`, `completeCheckIn`, `setRhythm`) into `useResponsibilityCheckIn`. Undo: only `deal`, `keep`, `skip` and `bringBack` return `{ result, undo: UndoToken }` (shape in Caveats); `undo(token)` runs `buildUndo`. `defaultHolderFor(target)` wraps the pure `defaultHolderFor(resolved, target)` (§2) and returns `null` while not loaded. `load()`, `resetState()`.

**Action contract (one report per failure, never silent):**

- Every write goes through `wrapAsync(isLoading, error, fn, { action: 'responsibilityStore:<name>', surface: 'responsibilities' })`. `wrapAsync` already toasts, and its toast already reports, so there is **no** separate `reportError`. `surface` is a new optional `WrapAsyncOptions` field; the non-panic branch adds `surface` and `context: { action }` to the `showToast` options **only when provided**, so existing calls and `useStoreActions.test.ts` assertions don't change.
- Returns the result on success, `null` otherwise. Every `null` has already been shown and logged, so callers branch on falsy and **never** toast again (same contract as `listStore.copyListForMembers`).
- Refusal when `!canDeal` (views hide controls for children; this is the backstop): info toast `whoOwnsWhat.error.readOnly` + `logEvent warn write_refused` (detail = action). No `reportError`, because nothing broke.
- Card no longer exists (deleted or restored on another device mid-drag or while the drawer is open): info toast `whoOwnsWhat.error.cardGone` + `logEvent warn card_missing`, return `null`.
- Guard order is identical in every action (`canDeal` → card exists → every holder id is a current non-pet member, else info toast `whoOwnsWhat.error.cardGone` + `logEvent warn invalid_holder` → builder), implemented once in a local `guarded(action, cardId?, fn)` helper so refusal and missing-card paths can't drift. `setRhythm`, `completeCheckIn` and `undo` go through `guarded` too.
- Batch writes resolve to `undefined`, so after every `applyDeckOps` call the store **verifies with a projection read**; on a miss it throws `new Error(t('whoOwnsWhat.error.saveFailed'))` inside the `wrapAsync` fn (the message is the user-facing toast title), so one toast and one report fire, identified by `action`.
- `restoreDefaults`: `errorToast: false`; its catch calls `showToast('error', t('whoOwnsWhat.restore.failed'), t('whoOwnsWhat.restore.failedHelp'), { surface: 'responsibilities', critical: true, error, context: { action: 'restore_defaults', stage } })`. One report, at critical.
- Undo refuses when the live record's `updatedAt` differs from the token's (another device changed it): info toast `whoOwnsWhat.undo.stale` + `logEvent warn undo_stale`, nothing overwritten. Undo writes also go through `wrapAsync`; `showToast`'s `actionFn` guard catches anything thrown.
- Celebrations fire on the **transition**: `deck-dealt` fires inside the action whose write moves `stats.waiting + stats.unsorted` from >0 to 0, never from a watcher, so a reload or sync never replays it.

Wired into `App.vue loadFamilyDataInner`, the `syncStore` reload list and `resetAllAppStores`.

Load `responsibilityStore` in the **same** `Promise.all` batch as `activityStore` / `mealPlanStore`, so it's loaded before `useHelpfulHints`' first debounced reconcile (1s); otherwise a hint created in that gap keeps the default audience for good (keyed reconcile never reassigns).

**Dependency direction (one-way, no cycles).** `responsibilityStore` imports only `familyStore`, `settingsStore`, `translationStore` and its repository. It never imports `mealPlanStore`, `listStore`, `todoStore`, `notificationsStore`, `useCriticalItems` or `useHelpfulHints`. Consumers depend on it, never the reverse. Briefing read-state is passed **into** `buildCardBriefingRows` by `useCriticalItems` from `notificationsStore.readState`. State this rule in the store's file header. `mealPlanStore → responsibilityStore` is its first store-to-store edge and stays one-way.

### 4. Shared UI extractions (DRY, done first)

Each extraction lands as its own commit, before any feature code, with the consumer's existing or characterisation test green at that commit: (1) `wrapAsync` surface, (2) useAnchoredPopover + SortMenu, (3) createDragPayload + useMealDrag, (4) ModalSecondaryButton + four modals (markup-only, class-string parity), (5) export runner, resolver, fonts and legend + MealPlannerPage behind the characterisation test, (6) ConfirmModal choices, (7) ListCategoryPills generic, (8) notifications aged prune. Any one can be reverted alone.

- **Segmented controls: no new component.** Use the existing `src/components/ui/TogglePillGroup.vue` (`variant: 'orange'`) for Overview/Deal/Deck, To deal/All, and the split mode. `ViewToggle.vue` is not touched.
- **`src/composables/useAnchoredPopover.ts`**: extract `SortMenu.vue`'s popover code (float above clipping containers, drop-up, viewport clamp, click-outside including the floated node, `useEscapeClose`, scroll/resize, arrow-key focus over a caller-given item selector). `SortMenu` is refactored onto it; update its `TODO(consolidation)` comment with the components still left.
- **`src/components/ui/OverflowMenu.vue`**: ⋯ trigger + `role="menu"` of `{ id, labelKey, icon, tone?, disabled?, disabledReasonKey? }` on `useAnchoredPopover`. `BeanHero`'s add menu is **not** migrated in this feature (labelled "Add" trigger, no characterisation test, Pod regression risk for no functional gain); it is listed in `useAnchoredPopover`'s `TODO(consolidation)` comment as the next consumer. SortMenu is migrated because OverflowMenu needs the composable and `SortMenu.test.ts` guards it.
- **Deck ring**: `src/components/responsibilities/DeckRing.vue` (single consumer; move to `ui/` when a second one appears). SVG ring, brand gradient, slate-05 track with a dark partner, animates from 0 on mount, static under reduced motion.
- **`src/composables/useDragPayload.ts`**: `createDragPayload<T>(dataTag: string)` factory extracted from `useMealDrag.ts` (keeps the Firefox `setData` fix), called **once at module scope** per payload type (`export const useMealDrag = createDragPayload<MealDragPayload>('beanies-meal')`), so each board has its own singleton ref and a meal drag can never be read as a card drag. `useMealDrag`'s public API is unchanged, so its consumers aren't edited.
- **`src/composables/useFlyTo.ts`**: `flyTo(el, targetEl)` only (Web Animations API, awaits `.finished`, returns immediately under `prefersReducedMotion()` from `@/utils/prefersReducedMotion`). `.finished` rejects with `AbortError` if an element detaches mid-flight: catch, `console.warn('[useFlyTo] animation aborted', err)`, resolve, so a deal is never blocked. **Bounce and the row drop flash reuse `useAttentionPulse().pulse(el, 'card-bounce' | 'drop-flash')`**, with both classes in `style.css`'s reduced-motion kill list.
- **BeanieFormModal**: add `deleteDisabledReason?: string` prop: renders the delete tile disabled plus an `InfoHintBadge` with the reason.
- **`src/components/ui/ModalSecondaryButton.vue`**: the outlined full-width footer button duplicated verbatim in `GoalViewModal`, `MedicationViewModal`, `AccountViewModal` and `TransactionViewEditModal` (ActivityViewEditModal keeps its conditional variant). Move those four onto it; `CardViewDrawer` uses it for Edit.
- **Confirm with choices**: add `choices?: { id: string; label: string }[]` (already translated, like `detail`) and `defaultChoice?: string` to `useConfirm` options, and a `selectedChoice` field on the singleton state. `confirm()` keeps resolving `boolean`, and **every** `confirm()` call resets `choices` / `selectedChoice` so a stale radio group can't leak into the next confirm. `confirmChoice(opts)` is a 3-line wrapper: `const ok = await confirm(opts); return ok ? state.selectedChoice ?? opts.defaultChoice ?? null : null`. `ConfirmModal` renders the radio group between message and buttons only when `choices` is non-empty. (`ChoiceModal` doesn't fit: pick-to-act list, no danger confirm or radio default.)
- **ListCategoryPills**: make it generic (`<script setup lang="ts" generic="E extends string = never">`) with `extras?: { id: E; label: string; emoji?: string }[]` rendered after the categories with the same classes, and `modelValue: ListCategory | E | null`. Existing consumers infer `E = never` and keep today's exact type. Covers the Deck view's "Nobody yet" / "Skipped · N".
- **Export**:
  - `pngBlobsToPdf(blobs[])` in `useSheetExport.ts` (loops `addPage` + `addImage`, reusing `loadJsPdf` / `imageSize`); `pngBlobToPdf` becomes a one-item call.
  - `src/composables/useSheetExportRunner.ts` extracted from `MealPlannerPage.runExport`: busy format ref, mount gate, `stage` tracking, `export-start` log (surface passed in, `count` = pages), `recordPerf`, `ExportError` → one `showToast('error', …, { surface, error, context: { format, stage } })`, `finally` unmount. Caller supplies `build()`, `el()` (the stacked wrapper, for PNG), `pageEls()` (one element per page, for PDF via `pngBlobsToPdf`; the meal sheet returns `[el()]`), `filename`, `kind`, `surface`, `perfName`, and failure copy keys `failedKey` / `failedHelpKey`. The meal sheet keeps surface `plan-export` and `mealPlanner.export.failed*`, so its telemetry and copy don't change. For the stacked Share PNG, the runner lowers `pixelRatio` to `min(2, sqrt(16e6 / (w*h)))` so the canvas stays under the iOS Safari limit (~16.7M px). MealPlannerPage refactored onto it.
  - `EXPORT_FONTS` moves to a shared `SHEET_EXPORT_FONTS` next to `ExportSheet` (per-sheet extras parameter).
  - MealPlannerPage's `cook()` resolver becomes `useExportMemberResolver()` (`initialsById` + `resolveMemberColor`).
  - `MealExportLegend.vue` → **`ExportPeopleLegend.vue`** (`label`, `people`, `hint`; `ExportCook` → `ExportPerson`), used by both sheets.
  - Optional `pageLabel` and `compact` header props on `ExportSheet.vue`.
  - Two `FileKind` values on `deliverFile`; no multi-file change.
- **Celebrations**: `deck-dealt` and `check-in-done` config entries in `useCelebration`.
- **`src/components/responsibilities/useDealActions.ts`** (feature-local): `deal`, `keep`, `skip`, `bringBack` → store action → on a truthy result, the undo toast (`action.undo`, 6s) and `undo`. Used by `DealPile`, `DealBoard`, `CheckInDrawer` "deal now" and the Deck view's "Bring back", so the undo toast exists in exactly one place. Animation stays in the components (`useFlyTo`); the toast fires only after the write resolves. Only one deck undo toast is visible at a time: `useDealActions` dismisses its previous toast before showing the next (`showToast` returns the new toast id, a non-breaking void → number change; `dismissToast(id)` exists). `undo` resolves truthy on success so `DealPile` can remove the emoji from its session row.
- **Copy**: a shared `action.undo` key (none exists today).

### 5. Page and components — `src/pages/WhoOwnsWhatPage.vue`, `src/components/responsibilities/`

- `WhoOwnsWhatPage.vue`: header (`PageWelcomeSubtitle` "Who's holding what this week? 🙋", `AddEntityButton` "Add a Card" for adults, `OverflowMenu`), `TogglePillGroup` view switch persisted with `usePersistedChoice(STORAGE_KEYS.WHO_OWNS_WHAT_VIEW, VIEWS, 'overview')` (key in `src/constants/storageKeys.ts`). `?view=` is checked against `VIEWS`; invalid → overview with a `console.warn`. `?card=` goes through `useDeepLinkParam` (`ready` = store loaded); an id that doesn't resolve is **consumed** after an info toast `whoOwnsWhat.deepLink.missing` + `logEvent warn deep_link_miss`. Export host uses `useSheetExportRunner` (surface `deck-export`). Export and Share show only when the deck has at least one kept card.
- `DeckOverview.vue` (waiting list, recent moves and facts are short sections inside it) + `FirstDealEmptyState.vue` (hugging PNG via a plain `<img>`) + `CategoryCoverage.vue` + `CheckInCard.vue`. Every face group uses `ActivityOwnerStack`; single faces use `MemberChip size="dot"`.
- `DealBoard.vue` (desktop rail + member rows + skipped row; `useCardDrag` from `createDragPayload<CardDragPayload>('beanies-card')`; tap-to-deal via `InlineMemberPicker`; writes through `useDealActions`).
- `DealPile.vue` (phone deal view + first deal; keep/skip, `InlineMemberPicker` with the `#badge` slot = the session emoji row under each face, fly-to targets found by `tileTestidPrefix`; group shortcut; skipped tray; `useFlyTo`; writes through `useDealActions`; Keep → pick is one `deal` call, only "Decide later" calls `keep`).
- **No new picker.** "Who owns it?" (pile, DealBoard tap fallback, check-in "deal now") reuses `InlineMemberPicker` with `members` = current non-pet humans, title "Who owns it?", `dismissStyle="close"`, `backLabel` "Decide later" (`cancel` = keep it waiting). Holder fields in forms use `FamilyChipPicker` (`mode="single"`, `:members` = eligible).
- `DeckGrid.vue` + `ResponsibilityCardTile.vue` (pills via `ListCategoryPills` with `extras`).
- `CardViewDrawer.vue` (BeanieFormModal drawer, `saveLabel` = Close, `ModalSecondaryButton` Edit in `#footer-start`, `showDelete` for custom cards or `deleteDisabledReason` for built-ins; "beanies uses this card for" from `cardUsesFor`), `CardEditDrawer.vue` (create + edit; `useFormModal` + `useFormValidation`, `EmojiPicker`, `ListCategoryPills tone="edit"`, `FamilyChipPicker`, `ToggleSwitch`, `FormFieldGroup`), `CardSplitEditor.vue` (`TogglePillGroup` mode + a `FamilyChipPicker` per part). `CardEditDrawer` edits a local draft and saves once through `store.saveCard(cardId, draft)` (or `createCustom`); it never calls several store actions in sequence. Delete: `confirm({ variant: 'danger', title: 'whoOwnsWhat.delete.title', message: 'whoOwnsWhat.delete.message', detail: <card name>, confirmLabel: 'action.delete' })` (confirm titles take no parameters). Close only on a truthy store result.
- Restore defaults: `confirmChoice({ variant: 'danger', title: 'whoOwnsWhat.restore.title', message: 'whoOwnsWhat.restore.message', confirmLabel: 'whoOwnsWhat.restore.confirm', choices: customCount ? [{ id: 'keep', label: <keep own (N)> }, { id: 'clear', label: <clear own> }] : undefined, defaultChoice: 'keep' })`. No new modal component.
- `CheckInDrawer.vue` (BeanieFormModal drawer: agenda sections, finish).
- `ResponsibilityExportBody.vue` + `src/utils/responsibilityExportModel.ts` (`buildExportBlocks` using `useExportMemberResolver`; `paginateExport` by estimated block heights with a fixed page capacity; one `ExportSheet` per page with `ExportPeopleLegend`). An under-estimate is safe: `pngBlobsToPdf` scales each page to fit and never clips.
- Undo toasts: only in `useDealActions` (§4): `showToast('success', …, undefined, { actionLabel: t('action.undo'), actionFn: () => store.undo(token), durationMs: 6000 })`.

### 6. Integrations

- `responsibilityStore.defaultHolderFor(target)` is the only lookup. Callers log `card_default_applied` under their own surface.
- **Meals**: in `mealPlanStore.createMeal` only (the single create path; `copyWeek` keeps copied cooks). When `cookMemberId` is unset **and `input.kind` is `'recipe'` or `'other'`**, apply `defaultHolderFor({ kind: 'mealSlot', slot })?.memberId`, log `meal-planner card_default_applied` (`slot`). `MealEditModal` shows `InferredHint` "Sofia holds Cooking Dinner in Who Owns What." whenever the chosen cook equals that holder (derived). On save, if the cook moved away from the holder, log `card_default_overridden` (`slot`).
- **Lists**: `listTemplates.ts` unchanged. `NewListSheet` computes `defaultHolderFor({ kind: 'listTemplate', key })` per template and shows the `InferredHint` **on the template tile before the pick** (the sheet closes on pick). `pickTemplate` keeps `meId` as `memberId` (so `createdBy` stays the creator) and passes the holder as `overrides.ownerId` (merged with the existing category override). `listStore.createList` already refuses an unresolvable owner with a toast + report.
- **Helpful hints**: `HelpfulHintsInput.cardHolders?: Partial<Record<HelpfulHintType, string>>`, built in `useHelpfulHints` from `CARD_DEFAULTS.hint` + `defaultHolderFor`. `useHelpfulHints` adds one watch source: a **narrow string key** of the hint-mapped cards' single holders (e.g. `'gifts-for-others=m1|date-nights=|…'`), never a deep watch of card states. In `buildDesired`, when the holder is **in the computed audience**, the audience becomes `[holder]`. `ComputeResult` gains `cardHolder: { used: number; ineligible: number }`, logged once per reconcile (`helpful-hints card_holder_used` / `card_holder_ineligible`, `count`). Existing hints are never reassigned (keyed reconcile). `TodoItemRow`'s hint chip says "Assigned from Who Owns What" when the hint's sole assignee equals `defaultHolderFor({ kind: 'hint', hintType })` (derived).
- **Nook**: `useCriticalItems.ts` gets `CriticalItem.type 'card'` plus two generic optional fields, `dismissKey?: string` and `route?: RouteLocationRaw`. Rows come from the pure `buildCardBriefingRows` (§2), inserted above the hint block (one mapping loop, no deck logic).
  - Moved notes and the check-in row set `completable: true`, so **the existing tick is the dismiss**. `FamilyStatusToast.handleComplete` gets one generic branch: `if (item.dismissKey) emit('dismiss', item.dismissKey)` (no card-specific code in the shared component); `FamilyNookPage` calls `notificationsStore.markRead(key)`. A failed write is already reported by `applyReducer`; the row stays.
  - Tap on an item with `route` emits an explicit `open-route` (never falls through to `open-activity`); the page routes with `router.push(item.route)`.
  - The check-in row shows **from the due date until completed**. "Remind me later" (on the Overview card) writes the same `card-checkin:<dueDate>` read, hiding the row for 7 days from its `readAt`.

### 7. Ninth category

`ListCategory` += `'people'`; `LIST_CATEGORIES` entry (💞, `#E17055`); `lists.category.people` / `lists.categoryShort.people`; `PRIVATE_LIST_CATEGORIES` += `people`, and `isWallSafeList` also returns false for any category not in `LIST_CATEGORIES` (future categories fail closed on older walls, mirroring the fallback shelf); `BeanieListsPage` fallback shelf for unknown categories (label "Other") that logs `logEvent warn lists unknown_category` once per id (detail = id); check `ListCategoryPills` wraps cleanly at 360px with nine pills.

### 8. Copy

All strings in `uiStrings.ts` under `whoOwnsWhat.*` (UI) and `cards.<camelId>.name|done` (deck), each with `en` + `beanie`. Pluralisation via `.one` / `.other`. Important-surface prefixes `whoOwnsWhat.delete`, `whoOwnsWhat.restore` added to the `uiStrings.test.ts` list. American English checked on every value.

## Files Affected

**New**

- `src/constants/responsibilityCards.ts`
- `src/utils/responsibilityDeck.ts`, `src/utils/responsibilityOps.ts`, `src/utils/responsibilityExportModel.ts`
- `src/services/automerge/repositories/responsibilityRepository.ts`
- `src/stores/responsibilityStore.ts`
- `src/composables/useResponsibilityCardLabel.ts`, `src/composables/useDragPayload.ts`, `src/composables/useFlyTo.ts`, `src/composables/useAnchoredPopover.ts`, `src/composables/useSheetExportRunner.ts`, `src/composables/useExportMemberResolver.ts`
- `src/components/ui/OverflowMenu.vue`, `src/components/ui/ModalSecondaryButton.vue`
- `src/components/export/ExportPeopleLegend.vue` (renamed from `MealExportLegend.vue`, which is deleted)
- `src/pages/WhoOwnsWhatPage.vue`
- `src/components/responsibilities/` — `DeckOverview.vue`, `FirstDealEmptyState.vue`, `CategoryCoverage.vue`, `CheckInCard.vue`, `DeckRing.vue`, `DealBoard.vue`, `DealPile.vue`, `DeckGrid.vue`, `ResponsibilityCardTile.vue`, `CardViewDrawer.vue`, `CardEditDrawer.vue`, `CardSplitEditor.vue`, `CheckInDrawer.vue`, `useDealActions.ts`
- `src/components/export/ResponsibilityExportBody.vue`
- Tests: `src/pages/__tests__/MealPlannerPage.export.test.ts` (characterisation), `src/components/responsibilities/__tests__/useDealActions.test.ts`, `src/utils/__tests__/responsibilityDeck.test.ts`, `src/utils/__tests__/responsibilityOps.test.ts`, `src/utils/__tests__/responsibilityExportModel.test.ts`, `src/stores/__tests__/responsibilityStore.test.ts`, `src/components/responsibilities/__tests__/DealPile.test.ts`, `src/components/ui/__tests__/OverflowMenu.test.ts`, `src/composables/__tests__/useSheetExportRunner.test.ts`, a ConfirmModal choices case

**Modified**

- `src/types/models.ts` (types, `ListCategory`, `Settings.responsibilityCheckInWeeks`)
- `src/types/automerge.ts` (3 collections)
- `src/services/automerge/repositories/settingsRepository.ts` (default rhythm)
- `src/App.vue`, `src/stores/syncStore.ts`, `src/utils/resetStores.ts`, `src/stores/index.ts`
- `src/constants/navigation.ts`, `src/router/index.ts`, `src/constants/storageKeys.ts`
- `src/constants/listCategories.ts`, `src/utils/wallJobs.ts`, `src/pages/BeanieListsPage.vue`, `src/components/lists/NewListSheet.vue`, `src/components/lists/ListCategoryPills.vue`
- `src/stores/mealPlanStore.ts`, `src/components/mealplan/MealEditModal.vue`, `src/pages/MealPlannerPage.vue` (export runner, member resolver, shared fonts and legend), `src/composables/useMealDrag.ts`
- `src/utils/helpfulHints.ts`, `src/composables/useHelpfulHints.ts`, `src/components/todo/TodoItemRow.vue`
- `src/composables/useCriticalItems.ts`, `src/components/nook/FamilyStatusToast.vue`, `src/pages/FamilyNookPage.vue`
- `src/utils/notifications.ts` (aged-exempt prefixes + nowIso on pruneReadState), `src/stores/notificationsStore.ts` (expose `readState`)
- `src/components/ui/SortMenu.vue` (onto useAnchoredPopover; BeanHero deferred, listed in the TODO(consolidation) comment)
- `src/composables/useConfirm.ts`, `src/components/ui/ConfirmModal.vue` (choices)
- `src/composables/useStoreActions.ts` (`surface` option on `wrapAsync`)
- `src/components/ui/BeanieFormModal.vue`, `src/composables/useSheetExport.ts`, `src/components/export/ExportSheet.vue`, `src/utils/deliverFile.ts`, `src/composables/useCelebration.ts`
- `src/components/goals/GoalViewModal.vue`, `src/components/pod/MedicationViewModal.vue`, `src/components/accounts/AccountViewModal.vue`, `src/components/transactions/TransactionViewEditModal.vue` (ModalSecondaryButton)
- `src/services/translation/uiStrings.ts`, `src/services/translation/uiStrings.test.ts`
- `src/utils/mealExportModel.ts` (`ExportCook` → `ExportPerson`), `src/components/export/__tests__/exportComponents.test.ts` (legend rename)
- `src/composables/useToast.ts` (return the toast id)
- Tests updated: `src/composables/__tests__/useStoreActions.test.ts` (surface case), `src/utils/__tests__/notifications.test.ts`, `src/composables/__tests__/useCriticalItems.test.ts`, `src/utils/__tests__/helpfulHints.test.ts`
- `src/style.css` (`card-bounce`, `drop-flash` + reduced-motion kill list)
- `src/content/help/features.ts`, `src/content/help/how-it-works.ts`, `src/utils/helpLinks.ts`
- `e2e/specs/cross-entity.spec.ts` (one test)
- `docs/mockups/family-responsibilities-deck-2026-09-25.html` (approved design input, already committed)
- `CHANGELOG.md`, `docs/STATUS.md`

## Help Center Coverage

- **Action**: new article · **Category**: features · **Type**: how-to · **Slug**: `who-owns-what` · **Title**: Who Owns What: Share the Jobs That Keep Your Home Running
  - **Scope**: what the deck is, how to deal it the first time (keep or skip, then who owns it), splitting by child or by place, re-dealing, the overview, the family check-in, printing the fridge sheet, and how beanies uses your cards as defaults.
  - **Notes**: built-in cards can be skipped, not deleted; restore default cards starts the deal over (choose to keep your own cards); only grown-ups deal; the overview never compares people.
- **Action**: update existing · `beanie-lists` (`features.ts` categories section ~:1590): add People We Love.
- **Action**: update existing · `your-daily-briefing` (`how-it-works.ts` ~:293): the new card rows (your cards, moved cards, cards with nobody, check-in due), without counting item kinds.
- Register `who-owns-what` in `HELP_PATHS` (`src/utils/helpLinks.ts`); link it from the first-deal empty state ("How the deck works").

## Observability Coverage

Surface **`responsibilities`** (store and page), **`deck-export`** (fridge sheet), plus existing surfaces for integrations. Context uses only existing allowlisted keys (`action`, `kind`, `count`, `stage`, `format`, `slot`, `route_path`, `detail` with enum strings only). **No new context keys**, so no allowlist or store-declaration change. Never card names or member names.

- **Success-path events (info)**: `deck_loaded` (count = deck size, detail = `unsorted|dealing|dealt`; change-gated), `card_kept`, `card_skipped` (count, detail `single|group`), `card_dealt` (kind = category, detail `first|redeal|clear`), `split_set` (detail = mode), `custom_created`, `custom_deleted`, `bring_back`, `undo` (detail = original action), `deck_dealt`, `restore_defaults` (detail `keep_custom|clear_custom`, count), `checkin_started`, `checkin_completed` (count), `rhythm_set` (detail = weeks), `export-start` from `useSheetExportRunner` (format, count = pages) plus `deliverFile` delivery telemetry and `perfTiming.record('deck-export', ms)`.
- **Integrations**: `meal-planner` `card_default_applied` / `card_default_overridden` (slot); `lists` `card_default_applied` (detail = template key); `helpful-hints` `card_holder_used` / `card_holder_ineligible` (count, once per reconcile).
- **Failure modes** (one report per failure, never two):
  - Store writes through `wrapAsync` with `surface: 'responsibilities'` and `action` (toast + automatic report). `restore_defaults` is `severity 'critical'` through its own single `showToast({ critical: true })`. Failed batch verification throws inside `wrapAsync` (message `whoOwnsWhat.error.saveFailed`, `action`).
  - Warnings with an info toast and no report: `write_refused` (child write), `card_missing` (card gone mid-action), `undo_stale`, `deep_link_miss`. `unknown_card` and `invalid_card_state` are warnings logged once per id with no toast and **no id** in `detail`; `invalid_holder` warn with the refusal toast. `lists unknown_category` sends `detail` = the id only when it matches `/^[a-z-]{1,32}$/`, otherwise `'invalid'` (the value comes from the document).
  - Export: `useSheetExportRunner` on `deck-export`, `ExportError` stages (`render | rasterize | pdf | deliver`); delivery outcomes from `deliverFile` (surface `file-delivery`).
  - Briefing dismiss and snooze writes: reported by `notificationsStore.applyReducer` (`notifications-markRead`); the row stays.
  - `useFlyTo` abort: `console.warn` and resolve (cosmetic).
- **Rates**: every action logs on success, so skip, undo, re-deal, check-in completion and default-override rates are measurable. `logEvent` rate-limits identical messages to 50/min, so per-card counts during a fast first deal are approximate; `deck_loaded` / `deck_dealt` give the exact state.

## Acceptance Criteria

- [ ] Who Owns What appears in the Treehouse after Meal Planner on desktop and in the mobile Planning stack; Overview is the default view; view is remembered.
- [ ] A new family keeps or skips and deals the whole deck in one pass; Keep is primary and first; Decide later leaves a card waiting; group shortcuts skip a whole group; the celebration fires once when every kept card is held.
- [ ] The deal animation shows the card flying to the face with the emoji row updating; skip drops into the tray; every action offers Undo that restores the previous state (and refuses safely when stale); reduced motion disables the motion.
- [ ] Desktop drag-and-drop deals, re-deals and skips; tap-to-deal works on touch and keyboard.
- [ ] Overview shows dealt ring, waiting and skipped counts, coverage by category with faces, waiting list, recent moves, check-in card and facts, and never a per-person total.
- [ ] Split by child and by label work; a new child gets a new part with nobody; a removed holder becomes nobody.
- [ ] Re-deals record history; previous and new holders see a dismissable briefing note, synced across their devices and kept for 30 days by the aged prune exemption (never resurfacing).
- [ ] View drawer shows only filled fields; edit drawer has every option; "What done looks like (at a minimum)" override works and can be cleared.
- [ ] Custom cards can be created, edited and deleted behind a confirm; built-in cards show the disabled delete tile with the (i) text.
- [ ] Restore default cards resets built-ins and history and keeps or clears custom cards as chosen.
- [ ] Check-in rhythm 2/4/8/off works; the briefing row appears from the due date until completed (snoozable) and never when off; completing records a check-in and celebrates.
- [ ] Fridge sheet exports as PDF (multi-page when needed, never splitting a category) and shares as one PNG, matching the meal sheet conventions; the meal sheet export still works unchanged after the extraction.
- [ ] New dinner/breakfast meals, grocery/packing template lists and gift/date/packing/document hints default to the single card holder with a visible (derived) reason, only on creation, and can be overridden.
- [ ] Children can view but not change anything; pets never appear in pickers.
- [ ] Beanie Lists offers People We Love; lists with an unknown category appear in a fallback shelf.
- [ ] Refactored consumers (SortMenu, MealPlannerPage, useMealDrag, the four view modals, ConfirmModal, FamilyStatusToast, notifications pruning) behave exactly as before.
- [ ] Light and dark mode correct on every surface (tokens, `-lift` accents, dark partners); beanie mode lowercase; zh strings flow through the pipeline; American English everywhere.
- [ ] Help Center article(s) listed in **Help Center Coverage** added/updated and verified to match the shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; no new context keys).
- [ ] `npm run validate` passes (type-check, lint, unit tests, build).

## Testing Plan

1. **Unit (pure)**: `responsibilityDeck.test.ts` — status derivation for all four states, removed/pet holders → nobody, child-split rebuild on child add/remove, stats and coverage, recent moves ordering, `singleHolderOf` (split → undefined), check-in due math for all rhythms incl. off and first check-in, agenda selection, group shortcuts, `unknownIds`, first-deal moves (no `fromId`) produce no moved note, the actor sees no note for their own move, moved-note cap 3, `buildCardBriefingRows` (superseded move hidden, dismissed/snoozed hidden, adults-only rows), malformed record → unsorted + `invalidIds`, superseded move ignored for since/previous. `responsibilityOps.test.ts`: `buildDeal` on unsorted keeps + deals in one op list; `buildSaveCard` emits one move per changed part and none for unchanged; `buildUndo` restores/deletes exactly the token's records and moves. `responsibilityExportModel.test.ts` — blocks never split, page count, waiting write-in rows, skipped omitted.
2. **Store**: keep/skip/deal/re-deal write the right batch (state + move), undo restores exactly, refuses when any card in a group token is stale (nothing written), only deal/keep/skip/bringBack return tokens, `saveCard` writes one batch, restore defaults with keep/clear custom, delete custom removes moves, child refusal, check-in record, deck-dealt fires once on the transition.
   2a. **Refactor safety (before extracting)**: a characterisation test for `MealPlannerPage` export (busy flag cleared on throw, one toast per stage failure). Existing `SortMenu`, `ConfirmModal` and `BeanieFormModal` tests stay green after the extractions.
   2b. **Drift guards**: every id in `CARD_DEFAULTS` exists in `RESPONSIBILITY_CARDS`; every `listTemplate` key exists in `LIST_TEMPLATES`; every hint key is a `HelpfulHintType`; every card has `en` + `beanie` name and done keys.
   2c. **Silent-failure cases**: `pruneReadState` keeps `card-move:` / `card-checkin:` keys younger than 30 days and prunes older ones; a stale undo is refused with a toast; a batch verification miss surfaces one toast; `restoreDefaults` failure reports once at critical; `useFlyTo` resolves on abort; the stacked PNG pixel ratio is clamped for 5+ pages.
3. **Integrations**: `mealPlanStore` default applied only when unset and single holder; `helpfulHints` holder assignment within audience + no reassignment of existing hints; `useCriticalItems` new rows, order above hints, adults-only rows, dismissed moved notes hidden; list template default (`ownerId` = holder, `createdBy` = current member); eat_out / leftovers / skip meals never get a default cook; the wall hides a list whose category is unknown; a hint reconcile after `responsibilityStore` loads applies the holder; the narrow holder key changes only when a hint-mapped card's single holder changes.
4. **Components**: OverflowMenu (Escape, outside click, disabled item reason), ConfirmModal choices (a plain confirm after a choices confirm renders no radio group), DealPile keep → pick (InlineMemberPicker) → flyTo called → undo, BeanieFormModal disabled delete reason, ListCategoryPills extras (without extras keeps its ListCategory model type).
5. **i18n**: uiStrings tests (beanie present, important surfaces), no bare strings lint.
6. **E2E** (one test in `cross-entity.spec.ts`): open Who Owns What, start dealing, keep and deal two cards, skip one, assert the exported data has two held states, one skipped state and two moves.
7. **Browser verification** (real browser, both themes, 360px and desktop): first deal end to end, drag on the rail, tap-to-deal, drawers, split, restore, check-in, fridge sheet PDF with a full deck (multi-page), briefing rows as adult and child, meal/list/hint defaults, meal planner export unchanged.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved v7 mockup and three codebase research sweeps (data layer, UI building blocks, integrations).
- **Pass 2 (DRY + error handling)**: checked every reuse claim against the code. Dropped SegmentedControl (TogglePillGroup), BeanPicker (InlineMemberPicker/FamilyChipPicker), RestoreDefaultsModal (confirm() with choices) and the global ProgressRing (local DeckRing). Removed the cookFromCardId/hintCardId fields (derived) and the per-card integration tag (one CARD_DEFAULTS map). Fixed Assumption 2 (pruneReads would delete card-move dismissals; prefixes now exempt) and Assumption 3 (deliverFile stays single-file; Share sends one stacked PNG). Extracted useSheetExportRunner, ExportPeopleLegend, shared export fonts and useExportMemberResolver from MealPlannerPage, useAnchoredPopover from SortMenu, and ModalSecondaryButton from four view modals. Gave wrapAsync a surface option. Added a one-report-per-failure matrix.
- **Pass 3 (Sustainability)**: split the store into pure op builders (utils) + thin orchestrating store + a repository that computes nothing (`applyDeckOps`); undo scoped to deal/keep/skip/bringBack with one generic snapshot token; `deal` implies keep and the edit drawer saves as one atomic `saveCard`; whole-record `set` writes and `resolveDeck` shape validation; moves are advisory (superseded moves ignored); card-move/check-in reads age-pruned at 30 days instead of exempt forever; BeanHero migration deferred; `confirmChoice` keeps confirm's boolean; briefing rows from a pure builder with a generic `dismissKey` / `route`; one `useDealActions` for undo toasts; generic `ListCategoryPills`; one-way store dependency rule; old-client wall exposure of `people` lists noted; extraction commits sequenced and individually revertible.
- **Pass 4 (Fresh-eyes sweep)**: fixed first-deal moves flooding the briefing (`isRedeal`, actor-exclusion, cap 3); meal cook default only for recipe/other kinds; list `createdBy` preserved (holder via `overrides.ownerId`); defined restore-with-keep (custom → waiting; first-deal state keyed on built-ins); export runner gains per-page PDF rendering + iOS canvas pixel-ratio clamp and keeps the meal sheet's surface/copy; `wrapAsync` surface/context only when passed, translated verify errors; one visible undo toast at a time; store-side holder validation with every write guarded; unknown list categories fail closed on the wall; removed stale `integration` / `cookFromCardId` / `hintCardId` / template `cardId` / bean-picker / `*Batch` references; added missing test and legend-rename files.

## Appendix A: Built-in deck (draft, ~81 cards)

Names below are the `beanie` (lowercase) values; `en` is Title Case. Done lines are drafted during implementation in the same voice as the mockup ("everyone fed by seven, most nights"), American English, one short line each.

- **home**: cooking dinner, breakfast, dishes, laundry, floors, sparkling bathrooms, trash night, home supplies, fixing things, the seasonal swap, decluttering, mail and paperwork, home rent / mortgage / insurance, the family budget check, paying the bills, the family calendar, wifi gadgets and passwords, pet care, plants, snow and ice
- **out**: grocery shopping, car care (group car), packages and returns, points and coupons
- **kids**: lunchboxes, babysitters and nannies, school forms, school vacations, school drop-off, kids' bags for the day, sports and clubs, tutors and lessons, morning routine, bedtime routine, bath time and haircuts, clothes that fit, potty training and diapers (group baby), homework and school supplies, talking to teachers, helping at school, new school new year, friends and screens, night wake-ups, learning at home, being there (kid cards default `splitHint: 'child'` where it makes sense)
- **health**: doctor and dentist, medicine cabinet, our emergency plan, health insurance and claims, wills and life insurance, kid's special needs and mental health support
- **celebrations**: the big holidays, birthday parties, gifts for others, cards and thank-yous, tooth fairy duty, having people over, photos and memories, weekend plans, giving back, faith and traditions
- **people**: date nights, grandparents, keeping up with family, aging parent or in-law care
- **trips**: trip packing, planning trips, passports and documents, outings and culture
- **projects**: the yard (group yard), furniture and decorations, the renovation, moving, bikes, the pool (group pool), camping gear, the vegetable patch (group yard), the fireplace
- **me**: time to myself, moving my body, seeing my friends

## Appendix B: Hero illustrations (nano-banana prompts)

Ten hero cards: cooking dinner, laundry, trash night, bedtime routine, school drop-off, grocery shopping, birthday parties, date nights, time to myself, the big holidays. Shared style prompt (prefix each): "beanies.family mascot style: soft rounded bean characters with knitted beanie hats, warm Heritage Orange #F15D22, Terracotta #E67E22, Deep Slate #2C3E50 and Sky Silk #AED6F1 accents, flat vector with gentle shading, transparent background, square 512x512, no text, friendly and calm". Per card:

1. cooking dinner: "a parent bean stirring a big pot on a stove, steam curling up, a small bean setting the table".
2. laundry: "a bean carrying an overflowing laundry basket, socks spilling out, folded towels stacked beside".
3. trash night: "a small bean proudly wheeling a trash can to the curb under a crescent moon".
4. bedtime routine: "a parent bean reading a picture book to a sleepy small bean tucked in bed, night light glowing".
5. school drop-off: "a parent bean holding hands with a small bean wearing a backpack at a school gate".
6. grocery shopping: "a bean pushing a shopping cart full of vegetables and bread, a list in hand".
7. birthday parties: "two beans holding a birthday cake with candles, balloons and bunting behind".
8. date nights: "two grown-up beans sharing a candlelit dinner, holding hands across the table".
9. time to myself: "a bean relaxing in an armchair with headphones and a mug, eyes closed, content".
10. the big holidays: "a bean family decorating a tree together with lights and a star, gifts beneath".

Output files: `public/brand/cards/<card-id>.webp` (512x512, transparent). Until they exist, those cards render their emoji.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan #109 → assembled block)

The assembled `=== BEANIES PRE-PLAN ===` block stored on Notion #109's "beanies-plan prompt" property (2026-09-26), built from the row plus these greg prompts:

- 2026-09-25 15:45: "please create a mockup for notion issue #109 - we are not building yet but i need a mockup for marketing purposes - it should look impressive, welcoming, engaging, fun, a bit silly, as per the issue plan captured in noton, pls go ahead to create the mockup as a claude artifact and ask any questions as required. we will not be building now"
- 2026-09-25: mockup round 2 and 3 feedback (real shell, frontend-design review, edit/assign, meal planner rail alternative, lowercase beanie mode). Full text in `docs/prompts/2026-09/2026-09-25-family-responsibilities-deck-mockup.md`.
- 2026-09-26: "Ok let's pick up #109 again ... i like the 'card rail' approach ... we should have a 'dashboard' view ... the numbers of cards one parent owns vs another is not the goal ... flesh out some of the rest of the mockup screens ..." (verbatim in the prompt log file).
- 2026-09-26: "agree on both, drop the comparison check and include check-in in v1 - also for the first deal ... 'keep this card, or skip it?' ... print the deck as a pdf ... a proper deal animation ... provide an option to delete a card ... restore the default set of cards ..." (verbatim in the prompt log file).
- 2026-09-26: "for #1, agree to remove delete for built-in cards, but with a short (i) explanation ... for #2 ... should we allow the list to spill over into a second page? ... print ... a list of all the fair play cards ..."
- 2026-09-26: "agree to add the ninth category, and please make the below updates to the beanies card labels. in general, use American terms rather than british ..." (label list verbatim in the prompt log file).
- 2026-09-26: "for the ninth category, should we align this with lists also as part of the plan to ensure everything is consistent?"
- 2026-09-26 pre-plan answers: page name "Who Owns What"; art for a few hero cards; mockup approved as is; check-in 2, 4 or 8 weeks, or off.

### Follow-up 1

2026-09-26: "yes, go ahead with /beanies-plan and proceed to /beanies-build-auto once done. only stop for a genuine showstopper or blocker"

</details>
