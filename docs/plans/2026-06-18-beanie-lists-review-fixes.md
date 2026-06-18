# Plan: Fix all 15 findings from the Beanie Lists (#33) re-review

> Date: 2026-06-18
> Related issues: None — direct implementation (no GitHub issue requested)
> Plan file: `docs/plans/2026-06-18-beanie-lists-review-fixes.md` (saved here on approval)
> Flag status: all work is behind `familyLists` (committed `false`). **Nothing deploys.** Flag stays off; these fixes are the gate for a future flip.

## User Story

As a beanies.family developer, I want every confirmed bug and cleanup from the max-effort re-review of the #33 Beanie Lists batch fixed, so the feature is correct, leak-free, DRY, and CIG-compliant before `familyLists` is ever flipped on.

## Context

The `/code-review` re-run over `6ffc3d03..HEAD` (the #33 build + the trusted-device auth change + the `useEscapeClose` rewrite) confirmed **10 correctness bugs** and **5 quality issues**, and added 3 new confirmed bugs the first pass missed. The two riskiest rewrites (auth, escape-stack) came through clean and need no change. This plan fixes all 15 findings. Several share a root cause, so the fixes consolidate into a handful of shared helpers rather than 15 isolated patches.

The whole feature is gated `familyLists: false`, so prod is unaffected — but the must-fix set (F1–F4) are the cross-device fail-open / privacy leaks that gate ungating, and the rest are user-visible correctness + cleanup that should land before launch.

## Requirements

Grouped by severity. Each item names the verified site and the fix.

### Must-fix (gate the flag flip) — fail-open / privacy / broken core

1. **F1 — Flag-gate the `list-completed` notification.** `src/utils/notifications.ts:239` derives the notification with no `familyLists` guard (the briefing IS gated), and `loadLists()` runs ungated in central load — so a flag-OFF device with synced list data fires a bell that dead-ends at `/nook`.
2. **F2 — Reset `listStore` on sign-out.** `src/utils/resetStores.ts:23-42` resets 12 sibling stores but not `listStore`; sign-out is a soft `router.replace` (no reload), so the prior family's list data stays live in Pinia on `/login`.
3. **F3 — Clear completion stamps on lifecycle flip.** `ListDetailModal.vue:80-99` `setLifecycle` never clears `completed/completedBy/completedAt`; the repo only deletes keys explicitly set to `undefined`, so stamps persist → spurious `list-completed` for a recurring list; the inverse instantly files.
4. **F4 — Honor the global member filter on the Lists page.** `src/stores/listStore.ts:49` display getters map over raw `lists`; the member-filtered getters have zero consumers. To-Dos/Activities honor the filter; `/lists` doesn't.

### Should-fix (user-visible correctness, contained)

5. **F5 — Re-derive completion in `removeItem`.** `src/stores/listStore.ts:267` deletes an item without re-deriving filing; deleting the last unchecked item leaves a 100%-checked one-off that never files/celebrates/notifies (`toggleItem` is the only derive path).
6. **F6 — Hide empty lists from the briefing.** `src/composables/useCriticalItems.ts:312` — surface a list only when `remaining > 0` (greg's decision: keep undated lists, but only if they still have unchecked items; drop the empty "0 left" line). Also fixes child→parent spillover of empty lists.
7. **F7 — Resolve linked entity names from the full store, not the windowed getter.** `ListDetailModal.vue:155-160` resolves names via `upcomingTrips`/`upcomingActivities` (windowed + member-filtered), so a past/far-future/filtered link shows "Linked to " with no name.
8. **F8 — Clear the `?view=` query on modal close.** `BeanieListsPage.vue:32/167` — re-tapping the same notification is a NavigationDuplicated no-op because the stale query is never cleared, so the modal won't reopen.
9. **F9 — Fallback finisher name + use `fillTemplate`.** `notificationKinds.ts:92` does `.replace('{finisher}', n.subtitle ?? '')` → "Finished by " (trailing space) when the finisher member was deleted.
10. **F10 — Reset `cycleCelebrated` when adding to a recurring list.** `src/stores/listStore.ts:253` — adding an item to a completed recurring list leaves `cycleCelebrated: true`, so re-completing that cycle never celebrates.

### Quality (cheap; F11 is a real CLAUDE.md violation CI can't catch)

11. **F11 — Remove sub-12px / arbitrary-rem font sizes.** `LinkedLists.vue`, `ListDetailModal.vue` (incl. scoped `.lbl`/`.link-chip`/`.linkpill`), `ListTile.vue`, `NewListSheet.vue` — `text-[0.6xx rem]` and scoped `font-size: 0.xx rem` violate the 12px floor + break Large reading mode; **stylelint only matches `text-[Npx]`, not rem**, so CI misses these.
12. **F12 — Replace `buildMessage` with `fillTemplate`.** `useCriticalItems.ts:380` re-implements interpolation with single-occurrence `.replace`. (The `notificationKinds.ts:92` instance is folded into F9.)
13. **F13 — De-duplicate three copy-pasted blocks.** progress math (`LinkedLists.vue:63` vs `ListTile.vue:23`), category-pill selector ×3 (`NewListSheet`/`ListDetailModal`/`BeanieListsPage`), trip/activity link-picker ×2 (`ListDetailModal.vue:352-411`).
14. **F14 — Delegate `classifyOwnerAudience` to `classifyAudience`.** `src/utils/audience.ts:62` re-implements the same decision tree the file's own header forbids duplicating.
15. **F15 — Fix `useEscapeClose` test isolation.** `useEscapeClose.test.ts` shares the module-global stack with no `beforeEach` reset; cleanup relies on `scope.stop()`, skipped if an assertion throws first.

## Important Notes & Caveats

- **Do NOT touch the two clean rewrites.** The `useEscapeClose` module-stack logic and the `googleAuth.ts` trusted-device preserve were both re-confirmed structurally safe — F15 only adds a test `beforeEach`, no production change.
- **The repo clears a key only when it's explicitly `undefined`** (`automergeRepository.ts:100-116` `keysToDelete`). So clearing stamps means passing `{ completed: undefined, completedBy: undefined, completedAt: undefined }` — not omitting them, and not `false`/`null` for the two timestamp/id fields.
- **`isListDue` returns `'overdue' | 'today' | 'noDue' | null`** — `null` for recurring AND future-dated; `'noDue'` only for an undated one-off. The future-dated date pill in `ListTile` is **by design** (do not "fix" it — refuted in review).
- **F4 must keep behavior identical when no member filter is active.** `createMemberFiltered` returns everything when the filter is `'all'`, so routing the base getters through `filteredLists` is a no-op in the default state.
- **F7: only the name resolution of an already-linked entity changes.** The link _picker_ still offers only upcoming entities (you link to a future trip) — don't widen the picker.
- **F1: keep `notifications.ts` pure (Pass 3).** Gate at the `notificationsStore` snapshot boundary, NOT inside the pure deriver — see Approach B/F1.
- **i18n: no new key (Pass 2).** F9 reuses the existing `medicationLog.someone` (`en/beanie: 'someone'`). No `npm run translate` needed unless other wording changes.
- **F11 mapping:** every offending size (`< 0.75rem`) goes **up** to `text-xs` (0.75rem / 12px) for utility classes, or `≥ 0.75rem` in place for scoped named classes — never down; never touch already-compliant sizes.

## Assumptions

> Review before implementing — valid at planning time.

1. Both `vacationStore.vacations` (`:427`) and `activityStore.activities` (`:578`) are exported (Pass 3 confirmed) — F7 needs no store change.
2. No consumer relies on `listStore.activeLists`/`completedLists`/`dueSoonLists`/`listsByCategory` being **un**-filtered. The notification/briefing derivers read `listStore.lists` (raw) directly, and `reconcileRecurringLists` operates on `lists.value` — so making the display getters member-filtered (F4) is safe.
3. The `familyLists` flag stays committed `false` for this whole change; no deploy.
4. `effortScope`-based isolation in `useEscapeClose.test.ts` plus a new `beforeEach` reset is sufficient; the composable can expose a tiny test-only reset without changing production behavior.

## Approach

Order of work: **F1 first and isolated** (Pass 3 — it's the only change that touches an already-shipping surface, the notification bell, even with the flag off; sequence + `npm run validate` it alone so a bisect is trivial if the bell misbehaves), then shared helpers (so the bug fixes consume them), then the rest of must-fix, should-fix, quality, then tests. Validate after each group with `npm run validate`.

### A. Shared helpers (build once, reuse everywhere — DRY)

- **`deriveCompletion` in `listStore.ts`** — extract the completion/filing logic currently inline in `toggleItem` (lines 210-231) into one private helper `deriveCompletion(items, list, opts?) → { patch, shouldCelebrate }` that: computes `allDone`; for a one-off sets/clears the `completed/completedBy/completedAt` triple; for a recurring list sets `cycleCelebrated` when newly all-done and **clears `cycleCelebrated` when no longer all-done**. Called by `toggleItem`, `addItem`, and `removeItem` after mutating `items`, so all three stay consistent — fixes **F5** + **F10** and removes the inline duplication.
  - **Celebrate split (Pass 2):** the `celebrate('goal-reached', …)` confetti+undo call stays ONLY in `toggleItem`. `addItem`/`removeItem` apply the returned `patch` but **ignore `shouldCelebrate`** — add a one-line `// no celebration on add/remove` comment at each call site so a future edit doesn't wire confetti in.
  - **Transition-guard the "set" branch (Pass 4):** the helper sets `completed`/`cycleCelebrated` only on a real transition (**was-not-all-done → is-all-done**, comparing against the list's PRIOR state), not merely on `allDone`. Otherwise removing the one open item from an already-celebrated recurring list (`allDone` already true, `cycleCelebrated: true`) would re-emit a `cycleCelebrated: true` no-op write and muddy the "newly" semantics. Lock this in the helper contract AND a test: `removeItem` of the last open item on an already-celebrated recurring list produces an **empty/no-op** patch.
  - **`completedBy` actor on a remove (Pass 3 — resolve this):** deleting the last _unchecked_ item newly-completes a one-off, but there is **no acting member**. Decision: `removeItem`'s newly-complete one-off path sets `completed: true` + `completedAt` but **does NOT set `completedBy`** (pass no actor) — so the list **files** (moves to Completed, fixing F5) but fires **no** "finished by" notification (the deriver requires `completedBy && completedBy !== createdBy`). That's correct: nobody _finished_ it, an item was removed. `toggleItem` keeps passing `byMemberId`. So `deriveCompletion`'s actor arg is optional.
- **`setLifecycle(listId, nextLifecycle)` action in `listStore.ts`** (MVO altitude + closes a silent failure) — moves the lifecycle-patch logic out of `ListDetailModal.vue` into a store action **wrapped in `wrapAsync`** (`@/composables/useStoreActions`, the same toast+`reportError`+result-or-null discipline every other list action uses). Build **ONE declarative patch object** with explicit `undefined` for every cleared key in both directions (Pass 3 — not two divergent branches), always including the completion triple (`completed/completedBy/completedAt: undefined`), plus set/clear `frequency`/`lastResetDate`/`cycleCelebrated`. Fixes **F3**; the `wrapAsync` wrap closes the silent-failure gap (today the component's `void listStore.updateList(...)` calls swallow the returned `null`). The modal delegates to the action.
  - **Required doc changes (Pass 3 + Pass 4):** the store header comment (`listStore.ts:34-37`) asserts only `toggleItem`/`reconcileRecurringLists` mutate `completed`/`lastResetDate`/`cycleCelebrated`, AND the `removeItem` comment (`:266`) says "Completion is never derived here (lives only in toggleItem)". Both become false once `setLifecycle`/`addItem`/`removeItem` derive completion — **update both comments** so the invariant docs match the code.
- **`listProgress(list)` pure helper in `src/utils/listLifecycle.ts`** — returns `{ total, done, pct }` with the 0-division guard (empty list → `{ total: 0, done: 0, pct: 0 }`, never `NaN`; test asserts this since both callers run it on lists mid-edit). `LinkedLists.vue` and `ListTile.vue` both call it (the `progressLabel = fillTemplate(t('lists.progress'), …)` stays at the render site for i18n). Fixes the progress half of **F13**.
- **`<ListCategoryPills>` — a THIN WRAPPER over the existing `ui/TogglePillGroup.vue`** (per Pass 2; do NOT hand-roll pill markup). Map `LIST_CATEGORIES` → `TogglePillGroup` options, using the existing **`useListCategoryLabel`** composable for labels. Expose **two explicit, independent boolean props — `:clearable` and `:show-all`** (Pass 3 — NOT a `variant` enum that secretly bundles both behaviors). (`CategoryChipPicker.vue` is finance-only — wires the finance `useCategoryLabel` — so it's correctly excluded; `TogglePillGroup` is the real primitive.) Replaces the three copy-pasted blocks. Fixes the pill half of **F13**.
- **Link picker — reuse `ui/EntityLinkDropdown.vue` / `ui/ActivityLinkDropdown.vue` if they fit; otherwise LEAVE the two inline blocks as-is** (Pass 3). The trip + activity picker blocks (`ListDetailModal.vue:351-408`) are duplicated _within one file_ — low-stakes, contained. If an existing dropdown fits, reuse it. If neither fits cleanly, extract at most a tiny in-`<script>` filter helper for the shared `matches`/filter logic — **do NOT author a brand-new shared `<ListLinkPicker>` component** as part of this flag-off cleanup (over-engineering for two blocks in one file; defer to when the feature ships). Addresses the picker half of **F13**.
- **`fillTemplate`** (`src/utils/fillTemplate.ts`, already exists, `replaceAll` + function-replacer) — replaces the local `buildMessage` in `useCriticalItems.ts` (**F12**) and **both** unsafe `.replace` sites in `notificationKinds.ts` (`:92` finisher = F9, and `:87` `assignedByName` — same `$`-unsafe single-occurrence defect, fixed in the same touch).

### B. Must-fix

- **F1 — gate at the STORE boundary, keep the deriver pure (Pass 3).** Do NOT import `isFlagEnabled` into `src/utils/notifications.ts` — `deriveNotifications` is a documented pure/deterministic/Vue-free/config-free function (`:1-13`), and importing config punctures that contract and forces every test to stub the flag. Instead gate where store+flag access is already normal: `src/stores/notificationsStore.ts:102` → `lists: isFlagEnabled('familyLists') ? listStore.lists : []`. One line; the deriver's list loop then naturally produces nothing when the flag is off. **Drop** the proposed `if (isRecurring(list)) continue` — the existing `!list.completed`/`!list.completedBy` guards (`notifications.ts:241-243`) already make recurring lists unreachable, so it's a fourth guard for a structurally-impossible case.
- **F2** — add `useListStore().resetState();` to `resetAllAppStores()` (`resetStores.ts`), beside `useTodoStore()`.
- **F3** — via the new `setLifecycle` store action (section A); `ListDetailModal` calls `listStore.setLifecycle(...)` instead of building the patch inline.
- **F4** — point `activeLists`/`completedLists`/`dueSoonLists`/`listsByCategory` at the member-filtered base `filteredLists` (currently only `filteredActiveLists`/`filteredCompletedLists` use it, and those are dead). Delete the now-redundant `filteredActiveLists`/`filteredCompletedLists`. `BeanieListsPage` needs no change — it consumes the (now filtered) base getters.

### C. Should-fix

- **F5 / F10** — `removeItem` and `addItem` call `deriveCompletion` (section A).
- **F6** — in the `useCriticalItems` list block, after `const remaining = …` add `if (remaining === 0) continue;`.
- **F7** — `linkedTripName`/`linkedActivityName` in `ListDetailModal` resolve by id over the full `vacationStore.vacations` (`vacationStore.ts:427`) / `activityStore.activities` (`activityStore.ts:578`) collections — **both confirmed exported (Pass 3), no store change needed** — not the windowed `upcomingTrips`/`upcomingActivities`.
- **F8** — in `BeanieListsPage`, change `@close="selectedListId = null"` to a `closeDetail()` handler that also `router.replace({ query: { ...route.query, view: undefined } })` (copy the `AccountsPage.vue:65-79` pattern verbatim).
- **F9** — route `notificationKinds.ts:92` through `fillTemplate(t('lists.notif.finishedBy'), { finisher: n.subtitle || t('medicationLog.someone') })` — **reuse the existing `medicationLog.someone` key** (`uiStrings.ts:736`, `en/beanie: 'someone'`); do NOT add a new `lists.notif.someone` key (Pass 2: that's the duplication the lens forbids). Same touch fixes the `:87` `.replace` (see helper A).

### D. Quality

- **F11 — minimal + mechanical (Pass 3); do not let it expand.** Fix ONLY genuinely sub-12px sizes (`< 0.75rem`): the `text-[0.625rem]`/`text-[0.66rem]`/`text-[0.6875rem]`/`text-[0.7rem]`/`text-[0.74rem]` **template utility** occurrences (`ListTile.vue:90,110`; `LinkedLists.vue:110,139,148,178,183,188`; `NewListSheet.vue:104`; `ListDetailModal.vue:374,403`) → `text-xs`. For sub-12px **scoped named classes** only (`ListDetailModal.vue` `.lbl` `0.66rem`, `.link-chip`/`.linkpill` `0.74rem`), bump the `font-size` to `≥ 0.75rem` **in place** — do NOT bulk-swap scoped class sizes to utility classes (mixing paradigms makes the next visual diff noisy). **Leave compliant `0.75rem`/`0.82rem` (e.g. `.picker-row`) alone.**
- **F12** — delete `buildMessage` (`useCriticalItems.ts:378-385`) and convert **all ~10 call sites** (todo/holiday/list blocks: lines 143, 160, 175, 201, 239, 272, 278, 284, 367 + the list block) to `fillTemplate` — do not leave the file half-converted with `buildMessage` still defined (Pass 4). Frame as a **bug fix**, not just dedup: `.replace` is first-occurrence + `$`-pattern-unsafe. Two deliberate, invisible-in-practice deltas: `fillTemplate` replaces all occurrences (desired) and renders nullish as `''` (every key here always supplies its placeholders, so no visible change). (`lowercaseFirst` at `:390` is local and stays.)
- **F13** — wire `LinkedLists`/`ListTile` to `listProgress`; `NewListSheet`/`ListDetailModal`/`BeanieListsPage` to `<ListCategoryPills>` (thin `TogglePillGroup` wrapper); `ListDetailModal`'s two picker blocks reuse `EntityLinkDropdown`/`ActivityLinkDropdown` if they fit, else leave inline (no new shared component — see helper A).
- **F14** — keep `classifyOwnerAudience` as a **thin one-line delegate** — `return classifyAudience(ownerId ? [ownerId] : [], viewer, resolveMember)` — rather than deleting it. This removes the duplicated body (the lens's goal) while preserving the named API used at `useCriticalItems.ts:307` AND the existing `audience.test.ts` describe block (`:71-91`), so no caller/test churn. Verified equivalent across all branches (assignee / hidden-adult / forChild / unassigned / pet; empty array → `unassigned`/`hidden`-pet).
- **F15** — export a test-only reset from `useEscapeClose` (or reset the module stack) and call it in a `beforeEach` in `useEscapeClose.test.ts`.

## Files Affected

**Production:**

- `src/stores/notificationsStore.ts` (F1 — flag-gate the `lists` input at the snapshot boundary; `notifications.ts` stays pure/untouched)
- `src/utils/resetStores.ts` (F2)
- `src/stores/listStore.ts` (F3 setLifecycle, F4 getters, F5/F10 deriveCompletion)
- `src/components/lists/ListDetailModal.vue` (F3 call, F7 name resolution, F11 fonts, F13 pills + link-picker)
- `src/pages/BeanieListsPage.vue` (F8 query clear, F13 pills)
- `src/composables/useCriticalItems.ts` (F6 guard, F12 fillTemplate)
- `src/components/notifications/notificationKinds.ts` (F9)
- `src/services/translation/uiStrings.ts` — **no new key** (F9 reuses `medicationLog.someone`); only touch + `npm run translate` if any wording changes
- `src/utils/audience.ts` (F14)
- `src/utils/listLifecycle.ts` (A: `listProgress`)
- `src/components/lists/LinkedLists.vue` (F11 fonts, F13 progress)
- `src/components/lists/ListTile.vue` (F11 fonts, F13 progress)
- `src/components/lists/NewListSheet.vue` (F11 fonts, F13 pills)
- `src/composables/useEscapeClose.ts` (F15 test-only reset export)

**New:**

- `src/components/lists/ListCategoryPills.vue` (thin `TogglePillGroup` wrapper)
- (No new link-picker component — reuse existing dropdowns or leave the two inline blocks; Pass 3.)

**Tests:**

- `src/stores/__tests__/listStore.test.ts` (F5/F10/F3)
- F1 test at the store boundary — assert `notificationsStore` passes `lists: []` to the deriver when `familyLists` is off (and the existing `notifications.test.ts` list-completed cases still pass with `lists` supplied)
- `src/components/notifications/__tests__/` or unit for F9 fallback
- `src/composables/__tests__/useEscapeClose.test.ts` (F15)
- new: `listLifecycle` progress test; `audience.test.ts` re-run for F14; a `useCriticalItems`/briefing test for F6 if a harness exists

## Acceptance Criteria

- [ ] F1: with `familyLists` off, a synced completed list produces **no** `list-completed` notification (unit test); recurring lists never notify.
- [ ] F2: `resetAllAppStores()` clears `listStore.lists`; verified by test + by sign-out leaving no list data in Pinia.
- [ ] F3: flipping one-off→recurring clears `completed/completedBy/completedAt`; recurring→one-off does not auto-file; no spurious notification (test).
- [ ] F4: selecting a family member narrows `/lists` exactly like To-Dos; the two dead `filtered*` getters are gone.
- [ ] F5: deleting the last unchecked item **files** a one-off (moves to Completed) **without** confetti and **without** a false "finished by" notification (no `completedBy` actor on a remove) (test).
- [ ] F6: an empty / 0-remaining list never appears in the briefing; undated lists with ≥1 item still do.
- [ ] F7: a list linked to a past/far-future/filtered trip or activity shows the correct name in the chip.
- [ ] F8: re-tapping the same list notification reopens the modal.
- [ ] F9: a deleted finisher renders "Finished by someone" (translated), not "Finished by ".
- [ ] F10: re-completing a recurring list after adding an item celebrates again (test).
- [ ] F11: no `text-[X.Xrem]` or scoped sub-12px `font-size` remains in any list component; Large reading mode scales all list text.
- [ ] F12: `buildMessage` removed; briefing strings go through `fillTemplate`.
- [ ] F13: progress math, category pills, and link picker each exist once and are reused.
- [ ] F14: `classifyOwnerAudience` delegates to `classifyAudience`; existing audience tests pass.
- [ ] F15: `useEscapeClose` tests reset module state in `beforeEach`; pass under reordering.
- [ ] `npm run validate` green; `familyLists` still committed `false`; nothing deployed.

## Testing Plan

1. `npm run validate` (type-check + lint + unit) green after each group.
2. New/updated unit tests above all pass; run `npx vitest run src/stores/__tests__/listStore.test.ts src/utils/__tests__/notifications.test.ts src/composables/__tests__/useEscapeClose.test.ts src/utils/__tests__/audience.test.ts`.
3. Manual (dev, `familyLists` ON in dev): create one-off + recurring lists; flip lifecycle both ways and confirm stamps/notifications; delete the last open item and confirm filing + celebration; add an item to a completed recurring list, re-check, confirm celebration; link a list to a trip then move the trip to the past and confirm the chip name; tap a list notification, close, re-tap → reopens; select a member filter → `/lists` narrows; empty list absent from the Nook briefing.
4. Toggle Settings → Appearance → Text size → Large and confirm all list text scales (F11).
5. Confirm `featureFlags.committed.ts` still `familyLists: false`; do not deploy.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted fixes for all 15 findings, consolidated into 6 shared helpers (deriveCompletion, setLifecycle, listProgress, ListCategoryPills, ListLinkPicker, fillTemplate reuse) so root causes are fixed once; resolved the F6 product fork per greg (keep undated lists only when items remain).
- **Pass 2 (DRY + error handling)**: Reused existing primitives instead of hand-rolling — `TogglePillGroup` for `<ListCategoryPills>`, `EntityLinkDropdown`/`ActivityLinkDropdown` reuse-first for the link picker, the existing `medicationLog.someone` key for F9 (dropped the new key), `wrapAsync` for `setLifecycle` (closes the `void updateList` silent-failure gap); kept `classifyOwnerAudience` as a thin delegate (no caller/test churn); scoped F11 to truly sub-12px sizes only; framed F12 as a bug fix; added the `removeItem`-must-not-celebrate guard; flagged the `activityStore.activities` export as a blocker to verify.
- **Pass 3 (Sustainability)**: Kept the pure `deriveNotifications` deriver pure — moved F1's gate to the `notificationsStore` snapshot boundary and dropped the redundant recurring guard; made `setLifecycle` one declarative patch + flagged the required store header-invariant update; resolved the `completedBy`-on-remove question (files without a false notification); replaced the `<ListCategoryPills>` `variant` enum with two explicit booleans; demoted the link-picker to reuse-or-leave-inline (no new component); tightened F11 to mechanical in-place fixes; sequenced F1 first + isolated.
- **Pass 4 (Fresh-eyes sweep)**: Verified the high-risk changes are side-effect-free (F4 has no hidden unfiltered-getter consumers; F1 store-gate + dropped recurring guard sound; F8 `router.replace` preserves sibling query params; F14 delegate exact). Added five contract refinements: transition-guard in `deriveCompletion` (no-op patch on remove of an already-celebrated recurring list), full `buildMessage` deletion across all ~10 call sites, the `removeItem:266` comment fix, and an empty-list `listProgress` test assertion.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

`/beanies-plan prepare a plan to fix all findings` — invoked immediately after the max-effort `/code-review` re-run over `6ffc3d03..HEAD` confirmed 10 correctness + 5 quality findings (3 of them new vs the prior 20-finding baseline).

### Clarification 1 (AskUserQuestion — No-due briefing)

Q: How should undated lists behave in the daily briefing? → **A: "Keep, but only if items remain"** (hide empty/0-left undated lists; undated lists with ≥1 unchecked item still surface).

</details>
