# Plan: Check-in outcomes that close out or carry over, and "Still to Deal"

> Date: 2026-09-28
> Related issues: #109 (Notion tracker row; no GitHub issue)
> Plan file: `docs/plans/2026-09-28-check-in-outcomes-and-still-to-deal.md`

> **No GitHub issue created.** Approved for direct implementation (via `/beanies-build-auto`).

## User Story

As a parent running the family check-in, I want each card's answer to mean something concrete
(no issues, we talked, or save it for next time) and to deal whatever is still undealt, so the
check-in closes things out instead of producing answers nobody can see afterwards.

## Context

Today the check-in drawer (`CheckInDrawer.vue`) offers **Settling In / Let's Talk** on cards that
moved since the last check-in and **Still Works / Let's Talk / Re-deal** on cards unchanged for 90+
days (up to 3). Finish writes ONE write-once `ResponsibilityCheckIn` with four counts
(`stillWorks`, `talkAbout`, `redealt`, `dealtNow`). Which card got which answer is NOT saved;
"Let's Talk" cards are named once on the done screen and then lost. "Still Nobody" lists only
kept cards with no holder; never-sorted cards are not mentioned.

Greg decided (2026-09-28), confirming all three follow-up questions:

1. "Settling In" becomes **No Issues** (no issue, no follow-up).
2. Agenda cards get three answers: **No Issues** (no action; closed out), **We've Talked** (the
   card is recorded as discussed; closed out), **Save for Next Time** (no action now; the card
   comes back at the next check-in until answered No Issues or We've Talked). "Haven't moved in a
   while" cards keep **Re-deal** as a fourth option.
3. A **Still to Deal** section with the same meaning as the Overview's "Deal the Remaining"
   (unsorted + waiting): kept-with-nobody cards listed with Deal Now (as today), plus "and N cards
   not sorted yet"; the done screen offers **Deal the Remaining N**, opening the deal pile, so
   leaving to deal never loses unsaved answers.
4. The Overview's untitled facts tile gets the title **Good to Know**.

## Requirements

1. **Outcomes.** `type Outcome = 'noIssues' | 'talked' | 'saved' | 'redeal'`. Moved and saved-from-
   last-time cards: No Issues / We've Talked / Save for Next Time. Unchanged cards: the same three
   plus Re-deal (only when someone else could take it, as today). An unanswered card is closed out (today's behaviour), exactly like No Issues but not counted. The exception is a Saved From Last Time card: when the drawer opens it already has Save for Next Time selected (`outcomes` seeded from `agenda.saved`) and its pills are not clearable, so it keeps coming back until someone answers No Issues or We've Talked. The Finish counts and lists need no special case.
2. **Record.** `ResponsibilityCheckIn` gains two optional fields: `talkedIds?: string[]` (cards
   answered We've Talked) and `savedIds?: string[]` (answered Save for Next Time). Counts:
   `stillWorks` = No Issues, `talkAbout` = We've Talked, `redealt`, `dealtNow` as today. Omitted
   when empty (`stripUndefined` already drops undefined). `isReadableCheckIn` needs only
   `completedAt`, so older clients read the record and ignore the lists: no migration.
3. **Saved from last time.** `buildCheckInAgenda` gains a `saved` list: the cards in the anchor's
   `savedIds` (only when the anchor is a finished check-in, never a cycle start) that still exist
   and are kept (held or waiting). A saved card is listed once, in Saved: it is removed from
   `movedByCard` and from the unchanged candidates BEFORE `.slice(0, 3)`, so it never takes an
   unchanged slot. Like a moved split card today, a saved card that is waiting can also appear in
   Still to Deal (different questions: Deal Now vs an answer). Saved rows are in deck order.
   `saved` reads `checkInCardIds(anchor, 'savedIds')` only when `anchor && !isCycleStart(anchor)`.
   Section title "Saved From Last Time", first in the drawer.
4. **History.** `cardHistory(card, moves, checkIns)` (`checkIns` REQUIRED; existing test calls
   pass `[]`; `CardHistoryKind` gains `'talked'`, `HISTORY_KEYS` gains
   `talked: 'whoOwnsWhat.history.talked'`) adds a `talked` entry for every readable
   finished check-in whose `talkedIds` includes the card, dated `completedAt`: "Talked about at a
   family check-in" (the date column carries the date). Malformed records skipped. Only check-ins at or after the card's `state.createdAt` count, and a card with no state has none (a check-in can only discuss a kept card; an older entry belongs to a life before Restore defaults, which keeps check-ins but wipes states and moves). `checkIns` is typed `readonly unknown[]` like the other check-in readers.
5. **Still to Deal.** The "Still Nobody" section becomes **Still to Deal**: the kept-with-nobody
   cards with Deal Now (unchanged behaviour), plus, when there are unsorted cards, the line "and N
   cards not sorted yet" (plural keys). The count is `store.stats.unsorted` (cards can't be sorted from the drawer, so there is nothing to snapshot). The section shows when `agenda.nobody.length || store.stats.unsorted`.
6. **Deal the Remaining from the done screen.** A new pure `remainingScope(stats:
Pick<DeckStats,'unsorted'>): 'unsorted' | 'waiting'` in `responsibilityDeck.ts` (the ONE rule),
   and the store gets `remaining = computed(() => stats.unsorted + stats.waiting)`. DeckOverview
   drops its local `remaining` for `store.remaining`; DeckOverview and CheckInDrawer both emit
   `deal-remaining` with no payload; the page has ONE `dealRemaining()` calling
   `openDeal({ scope: remainingScope(store.stats) })`, and `pileScope`'s fallback uses
   `remainingScope` too. The drawer only emits `deal-remaining`. The page's `dealRemaining()` returns the scope it opened; the check-in's handler is `checkInOpen = false`, then `logEvent('checkin_deal_remaining', { detail: dealRemaining() })`, so the scope is computed once, where it is used. After Finish, when `store.remaining > 0` (reactive), the
   celebration action is `plural('whoOwnsWhat.overview.dealRemaining', store.remaining)` (existing
   keys, the drawer's existing `plural()`); otherwise Done. The footer button stays Done (close).
7. **Done screen copy.** Pills: "N no issues", "N talked about", "N saved for next time", plus the
   existing re-dealt / dealt-now pills. Body: when cards were saved, "Saved for next time: {cards}."
   (replaces "On your list to chat about this week"). The saved names come from the written record
   (`completed.savedIds`, resolved with `store.cardById`, missing dropped), not a second filter.
8. **Overview check-in card** (`CheckInCard.vue`): the agenda chips add saved cards ("{card},
   saved from last time", up to the per-kind cap) so the Overview reflects what comes back; the
   "N cards with nobody" chip shows `store.remaining` (passed by DeckOverview as a new `toDeal: number` prop) as "N cards to deal"
   (`checkin.agendaToDeal.one/.other`, replacing `checkin.agendaNobody.*`).
9. **Good to Know.** `DeckOverview` facts panel gets `:title="t('whoOwnsWhat.facts.title')"`.
10. i18n: every new key `en` + `beanie`. Removed: `checkinDrawer.settling`, `.talk`,
    `.stillWorks`, `.nobody`, `.doneTalk`, `.count.stillWorks.one/.other`, `.count.talk.one/.other`,
    `checkin.agendaNobody.one/.other`. New: `checkinDrawer.noIssues`, `.talked`, `.saveNext`,
    `.saved` (section), `.toDeal` (section), `.unsorted.one/.other`, `.doneSaved`,
    `.count.noIssues.*`, `.count.talked.*`, `.count.saved.*`, `checkin.agendaToDeal.*`,
    `checkin.agendaSaved`, `history.talked`, `facts.title`.

## Important Notes & Caveats

- The check-in record is write-once (`newCheckInId`); lists live on the record, never edited.
- Saved carry-over is one hop: the next check-in reads the anchor's `savedIds`. Saving again at
  that check-in writes the id into the new record, so it carries again.
- A cycle-start anchor (deck emptied and restarted) carries nothing: `kind === 'start'` has no lists.
- The agenda is snapshotted when the drawer opens (existing): a card dealt during the check-in
  stays on screen.
- Old clients: a check-in finished on an old client has no lists: nothing is saved, as before.
- Beanie mode: these are cosmetic surfaces; values lowercase, no euphemism rules triggered.

## Assumptions

1. `isReadableCheckIn` requires only a non-empty `completedAt` (`responsibilityDeck.ts:571`).
2. `setCheckIn` stores the whole record via `toPlain(stripUndefined(...))`
   (`responsibilityRepository.ts:70`).
3. `buildCheckInAgenda(cards, moves, anchor, today)` has two callers: `CheckInDrawer` and
   `DeckOverview` (for `CheckInCard`).
4. `cardHistory` has one caller (`CardViewDrawer`).
5. `WhoOwnsWhatPage.openDeal({ scope })` exists and the Overview already uses it for Deal the Remaining.

## Approach

- `models.ts`: add the two optional fields, and JSDoc `stillWorks` as "No Issues answers (named before the rename; kept for old records)" and `talkAbout` as "We've Talked answers; equals `talkedIds.length` when the list is present".
- `responsibilityOps.ts`: `CheckInOutcomes` = `{ stillWorks; talkedIds; savedIds; redealt;
dealtNow }` (`talkAbout` removed from the input); `buildCheckIn` writes
  `talkAbout: talkedIds.length` and the lists only when non-empty (so count and list never
  disagree); `checkin_completed` keeps `count`, adds `detail: 'talked=N;saved=N'`.
- `responsibilityDeck.ts`: agenda `saved`; `cardHistory` `talked` entries;
  `remainingScope`; ONE reader `checkInCardIds(c, 'talkedIds' | 'savedIds'): string[]` (only
  string entries of an array; anything else `[]`) and `invalidCheckInIds(checkIns)` (readable
  records whose list is present but not an array of strings). The agenda and `cardHistory` read
  only through `checkInCardIds`.
- `responsibilityStore.ts`: `remaining`; `logBadRecords` gains
  `['invalid_checkin', invalidCheckInIds(checkIns.value)]` (once per id per session, warn, the id
  never sent). An id that no longer resolves (deleted / skipped card) is normal, not logged.
- `CheckInDrawer.vue`: replace the three hand-written sections with ONE computed `sections`
  list (order: saved, unchanged, moved, toDeal; a section is included when it has rows, and `nobody` is also included when `store.stats.unsorted > 0`). Row = `{ card, meta, holderId,
kind: 'outcome' | 'deal', redeal }`: saved (meta `heldLine`, no redeal), unchanged (meta
  `dealtLine || heldLine`, redeal), moved (meta `movedLine(move)`, holder `move.toId`, no redeal),
  toDeal (kind 'deal': Deal Now or ✅). One `v-for`, one row, `InlineMemberPicker` once. Each row has `key = ${section.id}-${card.id}` (v-for key and test id); `picking` stores that row key (`{ rowKey, cardId, reason }`) and the picker's `v-if` matches `picking.rowKey === row.key`, so a card listed in two sections (saved or moved and also waiting) opens exactly one picker, in the tapped row. One
  `optionsById` replaces `movedOptions` / `unchangedOptions`: No Issues / We've Talked / Save for
  Next Time, plus Re-deal when `row.redeal && redealTargets(card).length`. Section ids are the agenda keys (`saved`, `unchanged`, `moved`, `nobody`); a `SECTION_TITLE: Record<id, UIStringKey>` map gives the heading (`nobody` → `checkinDrawer.toDeal`). Test ids are `checkin-${section.id}-${card.id}` with no exceptions. The "and N cards not
  sorted yet" line renders under toDeal. `isEmpty` is `!sections.length` (one rule). On open, `outcomes = Object.fromEntries(agenda.saved.map((c) => [c.id, 'saved']))`; `TogglePillGroup` gets `:clearable="section.id !== 'saved'"`. `setOutcome` closes the picker only when it is this card's re-deal picker (`picking.reason === 'redeal' && picking.cardId === cardId`) and the new value is not `'redeal'`; it never touches a Deal Now picker.
  `CardViewDrawer` passes `store.checkIns` to `cardHistory`.
- `CheckInCard.vue`: saved chips. `DeckOverview.vue`: facts title. `WhoOwnsWhatPage.vue`: handle
  the drawer's `deal-remaining`.

## Files Affected

- `src/types/models.ts`, `src/utils/responsibilityOps.ts`, `src/utils/responsibilityDeck.ts`,
  `src/stores/responsibilityStore.ts`
- `src/components/responsibilities/CheckInDrawer.vue`, `CheckInCard.vue`, `DeckOverview.vue`,
  `CardViewDrawer.vue`
- `src/pages/WhoOwnsWhatPage.vue`
- `src/content/help/features.ts` (Who Owns What → check-in steps: No Issues / We've Talked / Save for Next Time, Re-deal on long-unchanged cards, Still to Deal with Deal the Remaining, the done screen listing what was saved for next time)
- `src/services/translation/uiStrings.ts`
- Tests: `responsibilityDeck.test.ts` (agenda saved/unsorted, cardHistory talked),
  `responsibilityOps` tests (record lists), `CheckInDrawer.test.ts`, `cardDrawers.test.ts`,
  `DeckOverview.test.ts` (facts title, no-payload `deal-remaining`), `responsibilityStore.test.ts`
  (`remaining`, `invalid_checkin` logged once)
- `scripts/design-screenshots/who-owns-what-capture.ts` (extend: a check-in with the three answers)
- `CHANGELOG.md`, `docs/STATUS.md`

## Observability Coverage

- **Events**: existing `checkin_started` / `checkin_completed` (surface `responsibilities`);
  `checkin_completed` gains `detail: 'talked=N;saved=N'` (existing allowlisted key, counts only).
  Opening the pile from the done screen logs `checkin_deal_remaining` (info, `detail` = scope).
- **Failure modes**: the write path is unchanged (`guarded` + `write` already toast and report a
  failed save; the drawer stays open so answers are not lost). A malformed list is ignored by the
  readers (via `checkInCardIds`) and logged once as `invalid_checkin` (warn). Ids of deleted or
  skipped cards are dropped as expected.
- **Success-path signal**: `checkin_completed` on every finish, with the talked/saved split.
- **Critical**: none new.
- **Privacy**: no new keys; `detail` carries two integers.

## Acceptance Criteria

- [ ] Moved and saved cards offer No Issues / We've Talked / Save for Next Time; unchanged cards add Re-deal.
- [ ] Finishing writes `talkedIds` / `savedIds`; the next check-in shows the saved cards first
      under "Saved From Last Time"; answering them No Issues or We've Talked closes them.
- [ ] A We've Talked card's History shows "Talked about at a family check-in" on that date.
- [ ] "Still to Deal" lists kept-with-nobody cards with Deal Now and "and N cards not sorted yet";
      the done screen offers "Deal the Remaining N" and opens the deal pile.
- [ ] The Overview facts tile is titled "Good to Know"; the Overview check-in card lists saved cards.
- [ ] Light and dark; en + beanie strings; `npm run validate` green.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified.

## Testing Plan

1. Unit: agenda `saved` (from a finished anchor only; deduped against moved/unchanged; only kept,
   existing cards); a waiting card listed in both Saved and Still to Deal: Deal Now opens one picker; a saved card left as it is at Finish is written into `savedIds` again; switching Re-deal to No Issues closes the re-deal picker, clearing a moved card's answer leaves its Deal Now picker open; `cardHistory` ignores a talked check-in older than `state.createdAt` and one for a card with no state; `cardHistory` talked entries; `buildCheckIn` lists and counts;
   CheckInDrawer: option sets per section, finish writes the right counts and lists, done-screen
   Deal the Remaining emits `deal-remaining`; a saved card that is also unchanged-eligible does not
   reduce the unchanged list below 3; `remainingScope`; `checkInCardIds` / `invalidCheckInIds`.
2. `npm run validate`.
3. Browser: extend the walk: run a check-in answering one card each way, finish, reopen the next
   check-in (saved card first), open the talked card's History; Still to Deal line; light + dark.

## Outcome

Built 2026-09-28 via `/beanies-build-auto` as planned. Validate green (9477+ tests); the browser
walk runs a full check-in: a re-dealt card under Moved Since Last Time answered Save for Next
Time; the done screen names it and offers "Deal the Remaining N", which opens the pile; the next
check-in lists it first under Saved From Last Time, pre-selected; answered We've Talked, its
History shows "Talked about at a family check-in". Good to Know titles the facts tile.

- **Review round 1** (`high`, 10 findings): fixed a stale re-deal answer when a second card's
  picker opened (pre-existing); a card re-dealt in the drawer is locked to Re-deal (the record
  counted it as No Issues if switched); two missing drawer tests; `checkin_completed.count` keeps
  its old meaning (saved only in `detail`); `invalid_checkin` carries `detail` (which list) and
  records without an id are reported; saved rows show "Dealt to" after Deal Now; stale doc
  comments; the unsorted line reads "You can deal them when you finish". **Reverted** the
  `aria-pressed` added to the shared `TogglePillGroup` (toggle semantics on a single-select group;
  radio semantics across 23 consumers is a follow-up). **Not fixed:** a saved card that also moved
  shows "Sofia since <date>" rather than the move line (still shows the current holder and date).
- **Review round 2** (`high`, scoped to the fixes + help content; 9 findings, all fixed): a
  successful re-deal always records Re-deal and closes only its own picker (timing gap); a
  re-dealt card's answer pills are hidden (the row says "Dealt to …") instead of silently
  ignoring taps; one `abandonRedeal` rule (was two copies); the no-op `force` parameter removed;
  stale doc; test isolation; three help-text corrections (the re-deal exception, "while check-ins
  are on", notifications claim narrowed to the answers). Two rounds is the ceiling.
- Help: new article `family-check-in` (the support reference), the Who Owns What article updated
  (beta callout, board, Card Details + history, Good to Know, Share / Export on every view, the
  check-in summary + link, Restore note), and the daily-briefing article links to it.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from greg's four decisions.
- **Pass 2 (DRY + error handling)**: one `remainingScope` + `store.remaining` + one page handler
  (was 3 copies of the scope rule); CheckInDrawer rows from one `sections` list (was 3 hand-written
  copies + a 4th planned); counts derived from the lists; one `checkInCardIds` reader +
  `invalid_checkin` logging; saved deduped before the unchanged cap; `cardHistory` checkIns
  required; Overview chip counts all cards to deal.
- **Pass 3 (Sustainability)**: rows keyed by section + card so a card in two sections opens one picker (was a bug); no test-id exception; `unsortedCount` dropped (one formula: `store.stats.unsorted` / `store.remaining`); the drawer only emits `deal-remaining`, the page closes, opens and logs with the scope computed once; JSDoc on the kept field names `stillWorks` / `talkAbout`.
- **Pass 4 (Fresh-eyes sweep)**: an unanswered Saved card carries over (pre-selected, not clearable), as greg specified; talked history limited to the card's current life (Restore defaults keeps check-ins); `setOutcome` closes only its own re-deal picker (also fixes an existing stale-picker bug); Still to Deal shows for unsorted cards alone and `isEmpty` derives from `sections`; help article updated.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-28)

> Just a functional question regarding the check-in - when a family member does a check-in and
> clicks on the "settling in" or "let's talk" buttons - what does that actually mean? what action
> or change does it make in the app, and is there any action the user is supposed to take based
> on those responses? where can the respones be viewed in the app/view?

### Follow-up 1

> Ok understand - to keep things simple let's do the following:
>
> - Change "settling in" to "no issues" - it should clearly indicate there is no issue or
>   follow-up needed for this card
> - as part of a check-in, dealing any undealt cards should be a section (not just cards that
>   are kept but not dealt), which is same logic as we implemented on the overview page
> - For now, let's update the 3 options and actions associated with them to this:
>   1. no issues -> no action in the app, item is closed out
>   2. we've talked -> mark the card as had a discussion (or somethign to that effect), item is
>      closed out
>   3. save for next time -> no action, item is saved for the next check-in and not closed out
>      does the above work and is it a simple change?
>      also a small thing - on the overview page, the tile in the bottom right (on desktop) which
>      says things like "every grown-up holds a just for me card" has no title - what shuold we call?
>      what exactly does this tile show for the user?

### Follow-up 2

> yes to all 3, commit and push first then build it with /beanies-build-auto

(The three: Re-deal stays as a fourth option on unchanged cards; "Still to Deal" as proposed
(list kept-with-nobody, count unsorted, deal from the done screen); tile title "Good to Know".)

</details>
