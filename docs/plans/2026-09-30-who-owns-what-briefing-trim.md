# Plan: Who Owns What briefing trim + "still to deal" nav badge

> Date: 2026-09-30
> Related issues: #109 (Who Owns What, follow-up)

## Context

The Nook daily briefing carries four Who Owns What rows (plan `2026-09-26-who-owns-what-responsibility-deck.md`, item 21). greg found "Your cards in Who Owns What" permanent, non-actionable and non-dismissable, so it reads as clutter and pushes actionable rows down. "Cards with nobody" is an action, but the site convention for "action needed in an area" is an orange count badge on the nav item (over budget, unbooked travel, overdue to-dos, due lists), not a briefing row. Approved in-thread by greg on 2026-09-30.

## Approach

1. **Remove the "Your cards" row.** Drop `kind: 'mine'` from `CardBriefingRow` / `buildCardBriefingRows` (`src/utils/responsibilityDeck.ts`) and its `cardItem` case in `src/composables/useCriticalItems.ts`. Delete `whoOwnsWhat.briefing.mine`, `mineCount.one`, `mineCount.other`.
2. **Card moved notes: 7 days.** `MOVED_NOTE_DAYS` 14 → 7. Already dismissable at any time by ticking (writes `card-move:<id>` to the member's synced `notificationReads`; no time gate), so no change there. Update the `notifications.ts` comment that cites 14 days (the 30-day `AGED_EXEMPT_MAX_DAYS` still covers 7; value unchanged).
3. **Remove the "Cards with nobody" row.** Drop `kind: 'nobody'` and its `cardItem` case; delete `whoOwnsWhat.briefing.nobody.one|other`.
4. **Orange `stillToDeal` count badge on the Who Owns What nav item, adults only** (the three documented steps):
   - `KNOWN_BADGE_KEYS` += `'stillToDeal'` (`src/constants/navigation.ts`);
   - `useNavBadges`: `stillToDeal: { kind: 'count', count: isAdultMember(familyStore.currentMember) ? responsibilityStore.stats.waiting : 0 }` (`waiting` = kept but not fully owned, including a split card with an unowned part);
   - `/who-owns-what` nav item gets `badgeKey: 'stillToDeal'`.
     Free with the registry: count pill in the desktop sidebar, mobile drawer and bean stack, the "N need attention" aria label, and the orange dot on the phone's Planning tab while > 0.
5. **Help + tests.** `how-it-works.ts` `your-daily-briefing`: the Who Owns What list keeps "a card moved" (a week) and "check-in due". `features.ts`: the nav item counts kept cards that still need an owner (adults). Tests: `responsibilityDeck.test.ts` (no mine/nobody; 7-day window), `useCriticalItems.test.ts` (card rows), `useNavBadges.test.ts` (stillToDeal, adult vs child).

## Assumptions (checked 2026-09-30)

- Who Owns What has no `requiresFlag`, so a badge cannot light a hidden page.
- `responsibilityStore.stats.waiting` exists and the store is populated off-page (the briefing already reads it).
- Adulthood via `isAdultMember(familyStore.currentMember)`, as the briefing's `viewerIsAdult`.

## Acceptance Criteria

- An adult with kept-but-unowned cards sees an orange count on Who Owns What in the sidebar (desktop) and the Planning tab dot + bean-stack count (phone); a child sees none; the count falls as cards are dealt and disappears at 0.
- The Nook briefing never shows "Your cards in Who Owns What" or "N cards have nobody yet".
- A re-deal by someone else shows a "card moved" note to both sides for 7 days, dismissable by ticking.

## Observability Coverage

No new events. `deck_loaded` (`responsibilityStore`) already logs the deck state (`detail: 'dealing'` while cards wait), which is the badge's input; no sibling nav badge logs, and a badge render has no failure path.

## Dark Mode Coverage

No new painted surface: `NavBadge.vue`'s pill sits on the Deep Slate sidebar/drawer in both modes and is reused unchanged. Check the pill and the Planning-tab dot in dark at desktop + phone.

## Files affected

- `src/utils/responsibilityDeck.ts`, `src/composables/useCriticalItems.ts`, `src/utils/notifications.ts` (comment)
- `src/constants/navigation.ts`, `src/composables/useNavBadges.ts`
- `src/services/translation/uiStrings.ts`
- `src/content/help/how-it-works.ts`, `src/content/help/features.ts`
- tests: `src/utils/__tests__/responsibilityDeck.test.ts`, `src/composables/__tests__/useCriticalItems.test.ts`, `src/composables/__tests__/useNavBadges.test.ts`

## Outcome (2026-09-30)

Built as planned, plus one adjacent fix found in browser verification:

- **`NavBadge.vue` dot variant gets `block`.** Measured in the browser walk (`scripts/design-screenshots/wow-badge-capture.ts`): the phone tab bar's attention dot rendered at **0x0**, because the dot is a bare `<span>` (inline) and `h-2 w-2` does not apply to an inline box. So no phone tab had ever shown its attention dot, for any badge (to-dos, budgets, travel, lists). With `block` it measures 8x8, visible on Planning in light and dark. Pinned by `src/components/ui/__tests__/NavBadge.test.ts`. The dot variant is only used by `MobileBottomNav`.
- Review (`/code-review high`) fixes: the gate uses `responsibilityStore.canDeal` (the store's own write gate) instead of re-implementing it; the moved-note window is strict (`> today - 7`, so a note shows on 7 calendar days and is gone a week after the move); the features help names the count as the Overview's "Still to Deal".
- Deliberately kept: cards left with "Decide Later" keep the badge lit until dealt or skipped (greg's spec: the count of kept, un-owned cards); the badge opens the page's last view, and the Overview's Still to Deal panel links straight to dealing; no per-viewer badge telemetry (no sibling badge logs; `deck_loaded` covers deck state); stale `zh.json` keys are left for the translation pipeline's `removeStaleKeys`.
- Second review (scoped to the fixes, `high`): no code defects. Fixed its label findings: the Overview lists these cards under "Waiting for a Holder" ("Still to Deal" is the check-in drawer's label), and the help now mentions split cards with an unowned part; the briefing's check-in gate (`viewerIsAdult`) now reads `responsibilityStore.canDeal` too, so the badge, the check-in row and deck writes share one rule.
