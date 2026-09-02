# Plan: One meaning for colour — unified bean identity across calendars and to-dos

> Date: 2026-09-02
> Related issues: None — direct implementation
> **No GitHub issue created.** This plan was approved for direct implementation; the full prompt history is in the Prompt Log below.
> Plan file: `docs/plans/2026-09-02-bean-identity-unification.md`
> Mockup: `docs/mockups/2026-09-02-member-card-identity.html`

## User Story

As a parent glancing at the wall or the planner, I want to see **whose** each event is without decoding a colour I was never taught, so that I can read the family's day in one look — and as a family with more than one bean whose name starts with the same letter, I want that to still be unambiguous.

## Context

Activity cards currently carry identity in a 5px coloured left edge. Four problems, all confirmed in the codebase:

1. **The edge is unlabelled.** Colour means nothing until the mapping is memorised, and nothing on a card teaches it.
2. **Member colours can collide.** `FamilyMemberModal.vue:146-147` assigns a colour with `Math.random()` from a six-item palette; `CreateMembersStep.vue:130-132` round-robins on `addedMembers.value.length` — which **excludes the pod owner**, so the second bean can collide with the owner on the very first family. Two divergent implementations, neither enforcing uniqueness.
3. **One device, two meanings.** The wall's left edge means _who_ (`wallActivityColour`). The planner's day/week grids use the same 5px edge for the _category_ colour (`getActivityColor`), documented at `DailyCalendarView.vue:113-117`. The dashed edge exists there only because hue was already spoken for.
4. **Category hue never worked.** `activityCategories.ts` defines **95 categories across 86 unique colours**. The Appointments group alone is `#DC2626 / #EF4444 / #B91C1C / #F87171 / #FCA5A5` (`activityCategories.ts:17-27`) — five shades of red for dentist, doctor, eye exam, haircut, therapy, at 5px width.

The resolution: **hue encodes the bean on every surface; category moves to the emoji it already owns** (95/95 coverage, 84 distinct glyphs). Faces carry identity so hue is reinforcement rather than the sole signal. This is a low-cardinality channel finally spent on the low-cardinality dimension.

Three supporting discoveries make this cheap:

- **`activity.color` is not a user choice.** There is no colour picker in `ActivityModal`. `color.value` is only ever assigned from `getActivityCategoryColor(newCategory)` (`ActivityModal.vue:386`, and `:328` on load) and written back at save (`:667`). It is a denormalised copy of the category colour. Retiring it costs no user-facing capability and needs no migration.
- **A "Party" category group already exists** — `activityCategories.ts:130-144`: `anniversary`, `baby_shower`, `bar_mitzvah`, `birthday`, `graduation`, `wedding`, `other_celebration`, with a group emoji `🎉` at `:285`. Celebration detection is a group check, not a hand-maintained id list, and a future Party category celebrates automatically. (Note `work_party` sits in group `Work` at `:253` — it will not auto-celebrate by group, which is correct.)
- **Every primitive this needs already exists in some form.** `classifyActivityChip` (resolve-then-count, deduped) in `useActivityChipClass.ts`; `ConfettiEffect.vue`; `BeanieIcon` + `icons.ts`; a 3-cap-plus-`+n` at `WeeklyCalendarView.vue:514-515`. The work is consolidation, not invention.

## Requirements

1. **Colour means the member, on every activity surface.** Wall chips, wall today view, month chips, day/week grid blocks, day timeline, all-day chips, list cards.
2. **Category is shown as its emoji** on cards, resolved as `activity.icon ?? getActivityFallbackEmoji(activity.category)`.
3. **Owner faces are right-anchored** on every card. The card's text left edge never moves; only right padding varies.
4. **Face stack caps at 3 + `+n`**, implemented once.
5. **The context rule**: in a bean-lane/member-column layout the lane already names the owner, so a solo card shows no face; a shared card shows the other beans. Every non-lane surface shows all owners.
6. **Three tiers**: solo = single wash + face; shared (2+ named owners) = blended wash of the first two owners' hues + faces + dashed edge; celebration = gradient border + overhanging emoji sticker + confetti.
7. **Heritage Orange stays "everyone"** — the no-owner case only. It does not become a third owner kind.
8. **Celebration tier applies to activities only**, never to to-dos or lists.
9. **Celebration detection**: category group `Party` wins outright; otherwise title matching with whole-word matches, errand-verb suppression, and emoji detection; overridable by an explicit per-activity toggle.
10. **Member colours are unique within a family.** Taken colours are shown as taken and cannot be picked; new beans take the next free colour. **A member's own current colour is always selectable** so existing colliding data stays editable.
11. **Two-letter initials on collision**, applied per family and only where two members share a first initial. A member photo, where set, wins over both. **The rule lives at the avatar layer** — inside the single `BeanieAvatar`, reading `familyStore.initialsById` — so every surface that renders a face inherits it and no call site can forget it. Cards, stacks, pickers and filters all get it for free.
12. **Cards show faces; pickers show face + name — with one deliberate exception.** Activity cards, to-do cards and list tiles show faces only. `FamilyChipPicker`, `MemberChipFilter` and `WallFooter` show face + name. **`TodoMemberFilter` stays compact, faces only** (user's explicit decision): every option is visible at once and tapping toggles rather than chooses, so it reads as a segmented control rather than a chooser — and requirement 11 guarantees its initials are unambiguous.
13. **Wall details sheet**: remove the location→category fallback; location always means location, with an empty state; category gets its own cell; rows gain icons from the `BeanieIcon` registry.
14. **Planner details modal gains the same icon rows**, and its inline location-pin SVG moves into the icon registry.
15. **DRY**: **exactly one avatar component** (`BeanieAvatar`, extended — see Phase 0), one owner-stack component, one classification path, one colour-assignment helper, one initials source, one celebration predicate, one activity-emoji helper. **Net component count must go down, not up: five avatar implementations collapse to one, and no new photo-loading code is written.**

## Important Notes & Caveats

- **`ActivityOwnerStack.vue` is purely presentational — for a correctness reason, not a lint one.** An earlier justification ("the wall would gain its first store-reading leaf") is false: `WallMemberFace.vue:16` already imports `getMemberAvatarUrl`, which calls `usePhotoStore()` (`useMemberInfo.ts:22`). The finance zone (`eslint.config.js:318-364`) bans _finance_ stores only, and the wall's own views (`WallTodayView.vue:54`) read `familyStore` directly. The real reason the stack takes resolved members as a prop is that **classification must happen once per activity, not once per face** — a stack that classified internally would re-derive the owner set on every render of every face, and could disagree with the wash colour its parent already computed. Store access stays at each call site.
- **The avatar resolves its own photo, and that is correct and already the status quo.** `WallMemberFace.vue:16` already imports `getMemberAvatarUrl` (→ `photoStore`), and `BeanieAvatar` already takes a resolved `photoUrl` prop. No new zone exposure either way.
- **Do NOT build a new `MemberFace` component.** `BeanieAvatar.vue` already owns the circle, the size scale, the colour ring, the pastel background, **and a photo overlay with correct load-state handling** (`:100-117`) — the illustration stays visible while the photo loads and on error, rather than flashing. A new component would re-implement all of that. The only genuine axis of variation across all five current implementations is _what shows when there is no photo_: the beanie illustration (character) or the member's initials (identity). That becomes one prop, not one component.
- **Do not machine-translate the celebration keyword list — this deviates from the approved mockup, deliberately.** The mockup says the word lists "belong in the translation layer". `scripts/updateTranslations.mjs` parses `STRING_DEFS` out of `uiStrings.ts` and pipes each value through the MyMemory API; a keyword list run through machine translation produces unusable matchers. The lists therefore live in a **hand-curated, locale-keyed constant**, treated as matching data rather than UI copy. Only the user-facing celebration _label_ goes in `uiStrings.ts`. Only `en` and `zh` exist, so this is two hand-curated lists, not a maintenance tail.
- **`activity.color` must stop being written, not migrated.** Per ADR-032, deleting from the Automerge doc reclaims nothing from the `.beanpod`, so a migration buys nothing. Stop writing it on save and stop reading it for card hue; leaving existing values in place is harmless. `getActivityColor` itself **stays** — `ActivityViewEditModal.vue:501` uses it for the category badge, which is exactly where category colour still belongs.
- **Hue flipping meaning is user-visible.** Ship as one coherent release with a release note; do not land it surface-by-surface — a half-migrated hue is worse than either end state.
- **Colour uniqueness is load-bearing for the initials fix.** Requirement 10 must land before or with requirement 11, never after.
- **Uniqueness cannot be enforced retroactively.** Families created before this release may already hold duplicates. The rule is forward-only: new assignments are unique, the picker blocks taking someone else's, and an existing collision surfaces as a named warning in the edit form rather than as an unsaveable form.
- **Do not replace `#ef4444` with a rose or coral.** The palette already contains `#ec4899` pink (`memberColors.ts:21`), and the whole argument in Context #4 is that neighbouring hues at small sizes are not a signal — a rose would rebuild the exact failure this change exists to fix, one row down. **Use teal `#14b8a6`**: maximally separated from the five survivors and from Heritage Orange `#F15D22`. Two pinned tests (`matchesAssigneeFilter.test.ts:141`, `wallActivities.test.ts:108`) assert the palette never contains `SHARED_EVENT_COLOR`; they must stay green.
- **Keep the dashed edge.** It is now redundant with hue and faces, and worth keeping as the one shared-state cue that survives colour blindness and needs no face to be read.
- **`activityDetailRows` keeps both exclusions** — finance, and time/place ("they are the two things every surface leads with", `activityDetails.ts:36-43`). The mockup draws When and Location as rows; in the shipped wall sheet they are the **hero band** (`WallSheet.vue:358-382`), which is the same intent expressed better. Category joins the hero band as its own cell; icons attach to the `dl` rows below it.
- **The telemetry allowlist has a server-side mirror.** `diagnosticContext.ts:52-53`: `infrastructure/lambda/telemetry/index.mjs` holds a copy pinned by a Lambda test. New keys must land in both, or they are stripped after leaving the device — the observability work failing silently.

## Assumptions

> Review these before implementation.

1. Retiring category hue from cards is acceptable given the detail panes still name and colour the category. **Confirmed with Greg.**
2. `activity.color` has no consumer outside card hue and the detail badge. Verified by call-site search (13 call expressions across 7 files, all card hue except `ActivityViewEditModal.vue:501`); re-verify before deleting the write.
3. **Decision: the palette stays at six.** The "do not replace `#ef4444` with a rose" note forbids adding a hue that neighbours an existing one, and both previously-proposed additions break exactly that rule — indigo `#6366f1` sits between blue `#3b82f6` and violet `#8b5cf6`, and cyan `#0891b2` sits beside the new teal `#14b8a6`. Six well-separated hues plus Heritage Orange is what the wheel affords at 5px and at 24px, which is the whole argument in Context #4. The overflow path therefore **ships as designed**: `nextFreeMemberColor` returns the colliding member, the form names them out loud, and the `member-colour` event measures how many real families actually exceed six. **No question is left open before Phase 0.**
4. Machine translation is not used for the celebration keyword lists; only English and Chinese lists are hand-curated at ship time.
5. To-do and list cards have an assignee concept compatible with `normalizeAssignees`. Verified for `TodoItemRow.vue:209`; list tiles use a single `ownerId` (`ListTile.vue:76`, `ListCycleTile.vue:66`), so the stack takes a one-member array there.
6. The wall's `beanieWall` flag stays `false` for this release, so wall changes ship dark and are verified in dev only.

## Approach

### Phase 0 — One face, one initial, one colour rule (must land first)

This phase deletes more than it adds. Today there are **five** "coloured circle showing a person" implementations — `BeanieAvatar.vue`, `WallMemberFace.vue`, `MemberChip.vue:41-51` (the `dot` size), `MemberChipFilter.vue:62-67` and `FamilyChipPicker.vue:117-122`. Three derive the initial with `name.charAt(0)`, which breaks on an emoji or astral-plane name that `WallMemberFace.vue:33` handles correctly with `[...name.trim()][0]`. Adding a stack on top of that would make six.

**They collapse into one: `BeanieAvatar`, extended.** It is already the most complete of the five and has **33 usages across 24 files**, so it is the destination rather than another casualty.

- **`src/components/ui/BeanieAvatar.vue` (extended, replaces four)** — gains `fallback?: 'beanie' | 'initials'` (default `'beanie'`, so **all 33 existing usages are untouched**), plus `initials?: string` and the existing `color` driving the ring, the background and — in `initials` mode — the fill. The photo overlay, its load-state handling, `referrerpolicy="no-referrer"` and the `photo-error` emit are already there (`:100-117`) and now serve every surface.
  The one genuine axis of variation across all five implementations is _what shows when there is no photo_: the beanie illustration (character, warmth) or the member's initials (identity). `WallMemberFace`'s own doc comment already argues exactly this — _"the beanie is chosen from age group and species, so a family with two adults gets three identical faces, and the one job this element has on a shared board is telling them apart"_ — and that reasoning becomes the prop's documentation instead of a second component's justification.
  **`variant` becomes optional, NOT a discriminated union.** `BeanieAvatar.vue:26` uses `withDefaults(defineProps<Props>(), {...})`, and `withDefaults` does not accept a union type — a discriminated union would force the file to abandon its defaults for `color`/`size`/`ariaLabel`/`photoUrl`, churning all 24 call-site files. `Props` stays a single interface with `variant?: AvatarVariant`. A computed guard replaces the discriminator: when `fallback === 'beanie'` and no `variant` is supplied, render `'adult-other'` **and** `console.error('[beanieAvatar] fallback="beanie" requires a variant prop — falling back to adult-other. Pass getMemberAvatarVariant(member), or set fallback="initials".')` once per mounted instance. Missing-variant is loud, not silent, without breaking `withDefaults`.
  **One size step is ADDED; none are changed.** `xs/sm/md/lg/xl` keep their exact current values (24/32/40/48/64px, `BeanieAvatar.vue:41-47`), so all 24 existing call-site files are provably untouched. One step is appended: **`2xl` = `h-14 w-14` (56px)**, the destination for `WallMemberFace`'s `lg`. **There is no `2xs`** — the only surface that wanted one was `ColorCircleSelector`'s decorative holder marker, and once `MemberChip`'s dot callers move to `ActivityOwnerStack`, that is its single consumer. A decoration does not justify a size step below the 12px typography floor plus a rule forbidding `fallback="initials"` beneath it. The swatch marker is `xs` (24px) inside the `h-8 w-8` (32px) swatch and identifies its holder by the translated `:title` and `aria-disabled` label, not by two letters. Explicit mapping — `MemberChip` dot (16px) → `xs`; `MemberChipFilter.vue:62-67` (18px) → `xs`, growing rather than shrinking, since requirement 12 leans on that surface for legibility; `FamilyChipPicker.vue:77` (24/28px) → `xs`, the non-compact state shrinking 28→24px as the one intentional pixel change; `WallMemberFace` `sm` (32) → `sm`, `md` (44) → `lg` (48), `lg` (56) → `2xl`. **Border width is unchanged** — the existing `border: 2px solid` (`:79`) already ships at `xs` today, so deriving it from size would visually shift existing usages and contradict this plan's own byte-identical criterion. The separating white ring belongs to `ActivityOwnerStack`, the only thing that overlaps faces.
  - `WallMemberFace.vue` is **deleted**. It has **five** call sites, not the three previously listed: `WallChoreBoard.vue:180` (`md`), `WallBeanColumn.vue:52` (`compact ? 'md' : 'lg'`), `WallTodayView.vue:203` (`md`), `WallFooter.vue:55` (`sm`), `WallPeripheralCards.vue:257` (`sm`). All take `<BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials">`. **`WallSheet.vue` is NOT a call site** — it already imports `BeanieAvatar` (`:14`).
  - `MemberChip.vue`'s **`dot` size is deleted**, not delegated — callers use `BeanieAvatar` directly. `MemberChip` is then purely a _name pill_ (`sm`/`md`), which is a different component with a different job and stays. (It is arguably now misnamed; renaming it is separable churn and explicitly out of scope.)
  - `MemberChipFilter.vue` and `FamilyChipPicker.vue` drop their inline circles for `BeanieAvatar`.
- **`useMemberAvatarBindings()` (new composable in `useMemberAvatar.ts`)** — resolves `familyStore` and `photoStore` **once in `setup()`** and returns `memberAvatarBindings(member)`, a per-member function with no store lookups in its body. It must NOT be a bare exported function called from a template: `v-bind="memberAvatarBindings(member)"` would run `usePhotoStore()` + `useFamilyStore()` once per face per render, and a month grid paints 100+ faces. ⚠️ **It lives in `useMemberAvatar.ts`, and the two photo helpers move there with it.** `useMemberAvatar.ts` imports only `vue` + types today, which is why it is the destination — but `memberAvatarBindings` needs `getMemberAvatarUrl` and `markMemberAvatarError`, and those live in `useMemberInfo.ts`, which statically imports `useAccountsStore` (`:2`). Importing them from there would put a finance store back into every avatar call site, undoing the store-free-leaf defect in the same breath as fixing it. Move both function bodies (`useMemberInfo.ts:20-33`) into `useMemberAvatar.ts` — they need `photoStore` only, never `accountsStore` — and re-export them from `useMemberInfo.ts` so the twelve existing import sites are untouched. Only then is "`BeanieAvatar` imports no store" true rather than asserted. `memberAvatarBindings(member)` returns the complete prop bag _including the error handler_: `{ variant: getMemberAvatarVariant(member), color: resolveMemberColor(member.color), photoUrl: getMemberAvatarUrl(member), initials: familyStore.initialsById.get(member.id), ariaLabel: member.name, onPhotoError: () => markMemberAvatarError(member) }`. Every member face in the app becomes `<BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="…" />`.
  **This is what stops the consolidation replacing one component with five copies of its logic.** `WallMemberFace.vue:29` resolves the photo and `:52` wires `markMemberAvatarError` _internally_, whereas `BeanieAvatar` takes a resolved `photoUrl` (`:22`) and emits `photo-error` (`:38`) — so without this helper each wall site would hand-write photo resolution, error wiring, variant, colour and initials lookup, and a site that forgot `@photo-error` would silently stop marking unresolved photos. Photo-error wiring cannot be forgotten because it is not a separate line.
  It also fixes a live inconsistency: `WallSheet.vue:330-336, 424, 696` pass `:variant` and `:color` but **no `photoUrl`**, so member photos never render in the wall sheet today while `WallMemberFace` shows them two components away.
- **`familyStore.initialsById` (new getter)** — `Map<memberId, string>`: one letter, or two where another member in the roster shares the first initial. Computed **once** from the roster and reactive. A per-face `memberInitials(member, roster)` helper is O(n) per call and therefore O(n²) per stack per render; a store getter is O(n) total and every face is a map read. The pure `computeInitials(members): Map<string,string>` core is exported from `src/utils/memberInitials.ts` for testing; the store getter is a one-line wrapper. Call sites pass the resolved string into `BeanieAvatar`'s `initials` prop, keeping the avatar presentational.
- **`src/constants/memberColors.ts`**:
  - Swap `#ef4444` → teal `#14b8a6`.
  - Add `nextFreeMemberColor(members): { color: string; reused: FamilyMember | null }` — first unused palette entry; when all are taken, the least-used one **plus the member it collides with**, so the caller can say so out loud. Returning the collision instead of a bare string is what makes the exhaustion case impossible to handle silently.
  - Add `takenColors(members, excludeId?): Map<string, FamilyMember>` — the one derivation both callers pass to the selector. `excludeId` keeps a member's own colour selectable when editing.
- Replace `Math.random()` at `FamilyMemberModal.vue:146-147` and the owner-excluding round-robin at `CreateMembersStep.vue:130-132` with `nextFreeMemberColor`. Both then pass `takenColors(...)` to the selector.
- **`ColorCircleSelector.vue`**: add `taken?: Map<string, FamilyMember>`. Today it is a 40-line file with one `<button>` and no `:disabled`, no `title`, no aria at all. A taken swatch renders hatched + dimmed, carries the holder's `BeanieAvatar` at `xs` with `fallback="beanie"` (a 24px marker inside the `h-8 w-8` swatch — the swatch identifies the holder by its translated `:title` and its `aria-disabled` label, not by two letters), and is a genuine `:disabled` + `:aria-disabled` button with a translated `:title` naming the holder — not an unstyled no-op, which would be a silent failure wearing a hover state.
- **Exhaustion and collision are both spoken aloud, never swallowed:**
  - `nextFreeMemberColor` returning a `reused` member → the form shows a translated notice ("all colours are taken — {name} will share {other}'s colour") and emits one `logEvent({ level: 'info', surface: 'member-colour' })`.
  - Editing a member whose current colour is already held by someone else → the same notice, and their own swatch stays selectable so the form can save.

### Phase 1 — Shared identity primitives

- **`src/components/ui/ActivityOwnerStack.vue`** — purely presentational. Props: `members: FamilyMember[]`, `max?: number` (default 3), `size?`. Renders the overlap, the ring, the `+n` overflow, and `BeanieAvatar fallback="initials"`. **No `variant` prop** — there is one avatar component now. No store imports, no classification. This is where the cap lives, once. It replaces **eight** hand-rolled overlap stacks: `DailyCalendarView.vue:519`, `WeeklyCalendarView.vue:869`, `MonthChip.vue:138`, `DayTimeline.vue:264` and `:377`, `WallTodayView.vue:208`, `WallSheet.vue:336`, `TimelineSegmentCard.vue:102`. (`WallUnlockPad.vue:165` is a login pad, not an owner stack — explicitly out of scope.) It mirrors the `moreCount` arithmetic already at `WeeklyCalendarView.vue:514-515`, which is the only site that caps _and_ shows `+n` today.
- **`src/utils/activityEmoji.ts`**: `activityEmoji(activity)` = `activity.icon ?? getActivityFallbackEmoji(activity.category)` — collapses **six** duplicates: `MonthChip.vue:52-55`, `ActivityListCard.vue:55`, `ScheduleCards.vue:67`, `ScheduleCards.vue:119`, `useCriticalItems.ts:217` and `FamilyPlannerPage.vue:863`. `getActivityFallbackEmoji` already terminates in `'📌'`, so this can never return empty.
- **`src/utils/activityCelebration.ts`**: `isCelebrationActivity(activity, keywords)` — pure, returning `{ celebrating: boolean; rule: 'override' | 'category-group' | 'emoji' | 'keyword' | 'none'; suppressed: 'errand-verb' | null }` so the _reason_ is available to the caller rather than reconstructed. Category group `Party` wins; else whole-word title match against the locale keyword list, suppressed when the title opens with an errand verb; emoji in the title is a direct match. **Named `activityCelebration`, not `celebration`** — `src/composables/useCelebration.ts` already owns "celebration" in this codebase (the app-wide overlay/shower system). Locale keyword lists live in `src/constants/celebrationKeywords.ts`.
  **Celebration is orthogonal to `ActivityChipClass.kind`, never a fourth kind.** `kind` answers "whose is this" (`solo` / `shared` / `family`) and drives hue; celebration is a decoration layered on top, so a shared birthday is `shared` _and_ celebrating. Adding `'celebration'` to the union would make ownership and decoration one axis and force every consumer of `kind` to re-learn it.
  `isCelebrationActivity` is memoised on `${activity.id}:${activity.updatedAt}:${locale}` inside `useActivityIdentity`, because a whole-word regex sweep over the keyword list on every chip on every paint of a 100+ chip month grid is work done once per activity, not once per frame.
- **Confetti reuses `src/components/ui/ConfettiEffect.vue`** (`active` + `colors` props, `position: absolute; pointer-events: none`). No new confetti is written. Three bounds, because the component animates 10 nodes from mount with `forwards` and nothing else limits it:
  1. **Dense surfaces get the gradient border and the sticker, never the confetti** — `MonthChip`, week grid blocks and all-day chips are too small for it to read and can hold several celebrations at once. Confetti is limited to full-width card surfaces: wall today, day timeline, agenda/list cards.
  2. **Once per activity per session.** A virtualised or re-keyed card re-mounts on scroll, and `forwards` means it replays every time. `useActivityIdentity` holds a module-level `Set<activityId>` of already-celebrated cards and returns `celebration.confetti: false` on subsequent mounts — the border and sticker still render, so nothing is lost visually. The `Set` is cleared on family change (the same watcher `familyStore` uses for the blank-colour warning), so it cannot grow across pod switches or outlive a sign-out.
  3. **`useReducedMotion` at the call site** suppresses only the confetti; the border and sticker are static and stay.
- **Collapse the owner derivations onto `classifyActivityChip`.** **Two** are genuine re-implementations, not one: `WallTodayView.vue:108-112` and `WallSheet.vue:270-274` (consumed at `:331` and `:420`) — both `membersFor`, both un-deduped `.map(id => members.find(...))`, so a duplicate id from a CRDT merge renders the same face twice. Two more are thin wrappers around the shared `isSharedEvent` that also need the member list and derive it separately: `WallEventChip.vue:32` and `DailyCalendarView.vue:119-125`. All four take `classifyActivityChip`, which returns `kind` **and** `members` in one pass.
  ⚠️ **`classifyActivityChip` must start returning the solo owner in `members`.** It returns `members: []` for the one-owner case today (`useActivityChipClass.ts:83`), pinned by `useActivityChipClass.test.ts:64`, because the _lane_ rule was baked into the classifier — but `WallTodayView.membersFor` and `WallSheet.membersFor` return every owner, and requirement 5 says a non-lane surface shows all of them. Swapping them onto the classifier as it stands would **silently delete the owner's face from wall today and the wall sheet**. The classifier therefore returns the resolved owner list in all four branches (`family` → humans, `solo` → `[member]`, all-dead-ids → `[]`, `shared` → owners), and the "solo shows no stack" decision moves to `useActivityIdentity`'s lane rule, where requirement 5 already lives. `useActivityChipClass.test.ts:64` (`solo` → `[]`) changes to `[member]`; `:88` (all-dead-ids → `[]`) stays. `MonthChip.vue:139`'s `classification.kind !== 'solo'` guard is deleted with its hand-rolled stack.
  **Ordering constraint:** the classifier change and the two `membersFor` deletions must land in the **same** commit — neither is correct without the other.
- **`classifyActivityChip` stops re-implementing `effectiveAssignees`.** `useActivityChipClass.ts:63-72` hand-rolls a resolve-then-dedupe that `assignees.ts:27-34` already owns. It derives its id list from `effectiveAssignees(activity, id => Boolean(memberById(id)))` and maps to members, so there is one dedupe rule rather than two that can drift.

### Phase 2 — Card surfaces

**The rule is written once, in `src/composables/useActivityIdentity.ts`, and each surface consumes it.** Today the wash is hand-rolled at seven call sites with **four different alpha suffixes** for the same intent — `+ '15'` (`DailyCalendarView.vue:392`, `DayTimeline.vue:250`), `+ '18'` (`DailyCalendarView.vue:495`, `WeeklyCalendarView.vue:844`), `+ '12'` (`DayTimeline.vue:352`), and two template-literal forms, `` `${color}1f` `` (`MonthChip.vue:99`) and `` `${color}15` `` (`AllDayActivityChip.vue:44`). Re-applying that shape ten times under a new colour rule guarantees the same drift one release later.

`useActivityIdentity()` returns `identityFor(activity, opts?: { laneMemberId?: string })` → `{ color, kind, stackMembers, emoji, celebration, style }`, where:

- `color` / `kind` / `stackMembers` come from **one** `classifyActivityChip` call (never re-derived per face),
- `stackMembers` already applies requirement 5 — when `laneMemberId` is supplied, a solo card returns `[]` and a shared card returns the other beans — so **no call site decides the lane rule**, which is the same reasoning that put the initials rule inside `BeanieAvatar`,
- `emoji` is `activityEmoji(activity)`,
- `celebration` is `isCelebrationActivity(...)`,
- `style` is the single wash/edge style object (`borderLeftColor`, `background` at **one** documented alpha constant `WASH_ALPHA`, and the dashed edge for `kind === 'shared'`).

**The shared blend is a `style.background`, not a `color`.** `classifyActivityChip` and `wallActivityColour:83` both return Heritage Orange for 2+ owners, and `matchesAssigneeFilter.test.ts:130-133` pins that with a documented reason ("a shared event never wears one person's colour"). Requirement 6 does **not** change either function's return type: `identityFor().color` stays the single **edge/hairline** colour — the first owner's hue for `shared`, matching the mockup's "hairline in the first owner's colour" — while `style.background` becomes a two-stop `linear-gradient(90deg, …)` of `stackMembers[0]` and `[1]` at `WASH_ALPHA`. The original regression ("a joint event looked like one person's") is now defended three other ways — the blend, the dashed edge and the face stack — none of which existed when that test was written. Heritage Orange survives as the `family` (no-owner) colour only, which is requirement 7. Exactly one test edit follows and must be deliberate: `matchesAssigneeFilter.test.ts:130-133` becomes "a two-owner event wears the first owner's edge and neither owner's flat fill". `wallActivities.test.ts:100-108` (no-owner) stays green unchanged.

Each surface becomes `v-bind` of `style` plus `<ActivityOwnerStack :members="…">` plus the emoji — not five decisions. **`ActivityOwnerStack` stays purely presentational and gains no `laneMemberId` prop**; the lane rule is a member-set question, not a rendering one, so it belongs in the composable that already holds the classification.

Then, per surface:

- Wall: `WallEventChip.vue`, `WallTodayView.vue`, `WallLanesView.vue`, `WallDaysView.vue` (+ `wallActivityColour` in `src/utils/wallActivities.ts`. **Its `||` at `:84` is load-bearing** — `membersById.get(owners[0]!)?.color || getActivityColor(activity)` currently absorbs an empty-string colour, so dropping the fallback without a replacement returns `''` and paints a transparent chip. It becomes `return resolveMemberColor(membersById.get(owners[0]!)?.color);`).
- Planner: `MonthChip.vue` (drop `md:hidden` at `:138`), `DailyCalendarView.vue`, `WeeklyCalendarView.vue`, `DayTimeline.vue`, `AllDayActivityChip.vue`, `ActivityListCard.vue`.
- Stop reading `getActivityColor` for card hue; stop writing `activity.color` at `ActivityModal.vue:667`. `getActivityColor` stays for the category badge at `ActivityViewEditModal.vue:501`.
- `AllDayActivityChip.vue:29-38` currently `console.warn`s on a falsy colour. That guard moves to the shared fallback and the component's local `NEUTRAL_FALLBACK` is deleted.

### Phase 3 — To-dos and lists

- Replace the name-pill `MemberChip` with `ActivityOwnerStack` on to-do and list **cards** only: `TodoItemRow.vue:209`, `ListTile.vue:76`, `ListCycleTile.vue:66`, `TimelineSegmentCard.vue:97,119`.
- **`MemberChip size="md"` stays.** It has two live call sites — `ActivityViewEditModal.vue:1190` and `TodoViewEditModal.vue:455` — both the view-mode assignee row of a detail modal, which is a _name_ surface, not a card. Removing it blanks both rows.
- Leave `FamilyChipPicker`, `MemberChipFilter` and `WallFooter` as face + name (`WallFooter.vue:57-58` already is). **`TodoMemberFilter` stays faces-only** per requirement 12.
- Give `WallFooter` and `MemberChipFilter` the member-colour wash so the filter reads as the key it is assumed to be, rather than losing the bean's colour to selection state (`MemberChipFilter.vue:35-36` currently repaints the whole pill slate-on-select).
- **No celebration styling on to-dos.**

### Phase 4 — Details surfaces

- **Make icon names type-safe first.** `icons.ts:543` declares `BEANIE_ICONS: Record<string, BeanieIconDef>`, so `keyof` is `string` and `BeanieIcon.vue:33-35` silently substitutes a three-dot circle for any typo. Change the sub-registries and `BEANIE_ICONS` to `satisfies Record<string, BeanieIconDef>`, export `export type BeanieIconName = keyof typeof BEANIE_ICONS`, and narrow `BeanieIcon`'s `name` prop to it.
  **This is a five-file change, not one.** Six dynamic bindings feed that prop: `ChoiceModal.vue:45` and `RecurringEditScopeModal.vue:54` (`opt.icon`), `PageHeader.vue:7,30` (`icon: string` prop), `CategoryIcon.vue:31,43` (`categoryInfo.icon || 'more-horizontal'`), `AccountTypeIcon.vue:32` (template literal `` `account-${type}` ``), `ConfirmModal.vue:31`. Narrow the icon fields they read from too. `AccountTypeIcon`'s template literal resolves only if `account-${AccountType}` is provably in the registry — verify with `npm run type-check`; if not, keep that one site `as BeanieIconName` with a comment.
  ⚠️ **`satisfies` breaks the registry's own three accessors.** Removing the index signature means `getIconDef` (`icons.ts:559`), `getAccountTypeIcon` (`:566`) and `getAssetTypeIcon` (`:573`) all stop compiling — each indexes with a plain `string` under `strict: true`. Keep their public `(name: string)` signatures (`BeanieIcon`'s runtime fallback and `CategoryIcon`'s data-driven names need them) and cast **once**, inside the module that owns the registry: `return (BEANIE_ICONS as Record<string, BeanieIconDef>)[name];`, likewise for the two typed sub-registries. One contained cast in the definition file, never one per call site.
  **Belt and braces:** because a `satisfies` narrowing with a deliberate cast in the accessor makes the compile-time guarantee real only for the six statically-bound call sites, `BeanieIcon.vue:31-36`'s three-dot fallback also gains `console.error('[beanieIcon] unknown icon "' + props.name + '" — add it to BEANIE_ICONS in src/constants/icons.ts or fix the name')`. Compile-time **and** runtime.
- `ActivityDetailRow` gains `icon?: BeanieIconName`; `activityDetailRows` populates it. The type already carries `memberId` "so a renderer can show their avatar" (`activityDetails.ts:28`) — the wall currently ignores it; both surfaces now render `BeanieAvatar`.
- `WallSheet.vue:370-382`: delete the `v-if="activity.location" / v-else-if="activity.category"` fallback. The location hero cell always renders, with a translated empty state; category becomes its own hero cell with its emoji pill.
- `ActivityViewEditModal.vue`: add the same icon rows; move its inline location-pin SVG (`:1282-1310`) into `src/constants/icons.ts` as `map-pin`.
- Add missing registry icons: `map-pin`, `clock`, `tag`. (`calendar`, `repeat`, `users`, `file-text` already exist.)

### Latent defects this change must fix, not inherit

1. **A colourless bean renders a transparent chip.** `useMemberInfo.ts:86-88` uses `member?.color ?? fallback`, so an **empty-string** colour returns `''` rather than the grey fallback; `MemberChip.vue:31` bypasses the composable entirely. Once hue is the primary identity signal this is a blank card.
   **The fix must not route through `useMemberInfo`.** That module statically imports `useAccountsStore` (`:2`), so having `BeanieAvatar` resolve colour through the composable would pull a finance store into every avatar in the app — contradicting this plan's own acceptance criterion. Instead: export `NEUTRAL_MEMBER_COLOR = '#6b7280'` and a pure `resolveMemberColor(color?: string): string` (truthy-and-non-blank, else neutral) from `src/constants/memberColors.ts` — which the store-free-leaf latent defect makes genuinely zero-import. `resolveMemberColor` stays pure: no telemetry, no module state (see Observability). `useMemberInfo.ts:7`'s `DEFAULT_COLOR`, `useActivityChipClass.ts:18`'s `NEUTRAL_FALLBACK` and `AllDayActivityChip.vue:29`'s `NEUTRAL_FALLBACK = 'rgb(100, 116, 139)'` all delete and import it. `getMemberColor` changes `?? fallback` to a blank check. `MemberChip`'s `member?.color ?? ''` and `BeanieAvatar`'s `color` default both route through `resolveMemberColor`. `BeanieAvatar` then imports one constants module and no store.
2. **`#6b7280` is declared twice** — `DEFAULT_COLOR` (`useMemberInfo.ts:7`) and `NEUTRAL_FALLBACK` (`useActivityChipClass.ts:18`), plus a third `NEUTRAL_FALLBACK = 'rgb(100, 116, 139)'` in `AllDayActivityChip.vue:28`. One exported constant; the other two deleted.
3. **Two functions disagree about a dead-id-only event, and the classifier is right.** `classifyActivityChip` returns `solo` + neutral (`useActivityChipClass.ts:80-82`); `isSharedEvent` returns `true` (`0 !== 1`, `assignees.ts:52`).
   **Do NOT "resolve" this by making the classifier return `family`** — an earlier draft of this plan proposed exactly that, and it re-creates a documented regression: `family` means Heritage Orange (requirement 7, "everyone") and `members: humans`, so one corrupt record would paint every family face. `useActivityChipClass.ts:76-82` explicitly rejects this ("rather than misrepresent the chip as a multi-person event").
   Leave `classifyActivityChip` **unchanged**. Change `isSharedEvent` (`assignees.ts:56`) to `const n = effectiveAssignees(...).length; return n === 0 ? normalizeAssignees(entity).length === 0 : n !== 1;` — an event whose ids all went stale is nobody's, shown neutral and solo, matching the classifier; a genuinely unassigned event (zero raw ids) stays shared, which is today's behaviour for every real record. Its two callers, `DailyCalendarView.vue:124` and `WallEventChip.vue:31`, are style-only, so the blast radius is the corrupt-data case alone. **`belongsInMemberColumn` is deliberately excluded and must not be touched.** It uses raw ids on purpose, and `assignees.ts:63-79` states why: _"Resolving first would turn an event whose every id has gone stale into a family-wide one shown in every column, which is a louder failure than the quiet one it has now."_ Add a test pinning the divergence.
4. **`memberColors.ts` is not the store-free leaf this plan assumes.** `memberColors.ts:39` re-exports `HERITAGE_ORANGE` **from** `@/composables/useActivityChipClass`, which imports `useFamilyStore` and `useMemberInfo` — and `useMemberInfo.ts:2` statically imports `useAccountsStore`. Importing `resolveMemberColor` from `memberColors.ts` would therefore pull a finance store into every avatar in the app, which is precisely the outcome Latent Defect #1 exists to prevent. It also means `src/utils/wallActivities.ts:9` already reaches `accountsStore` transitively from inside the wall's lint zone (the zone catches direct imports only, as `eslint.config.js:322-332` states openly).
   **Invert the dependency, do not add another module.** Move the `HERITAGE_ORANGE = '#F15D22'` declaration and its doc comment **into** `src/constants/memberColors.ts`, and have `useActivityChipClass.ts` import it from there. Keep `export const HERITAGE_ORANGE` re-exported from `useActivityChipClass.ts` so `useActivityChipClass.test.ts:2` and `MonthChip.vue:97` are untouched, and keep `SHARED_EVENT_COLOR` as a local alias in `memberColors.ts`. After this, `memberColors.ts` imports nothing, and `BeanieAvatar`, `ActivityOwnerStack` and `wallActivities.ts` all become genuinely store-free — verifiable rather than asserted.
5. **`useMemberInfo` must become finance-free, and this is now load-bearing rather than tidy.** Pass 3 makes `memberColors.ts` a zero-import leaf, which fixes the `wallActivities.ts` → `SHARED_EVENT_COLOR` hop. But the new `useActivityIdentity` composable calls `classifyActivityChip` via `useActivityChipClass()`, which imports `useMemberInfo` (`useActivityChipClass.ts:2`), which statically imports `useAccountsStore` (`useMemberInfo.ts:2`) — so the moment a wall view consumes `useActivityIdentity`, the finance store is back in the wall's import graph by a new route.
   `useMemberInfo`'s **only** `accountsStore` consumers are `getMemberNameByAccountId` and `getMemberColorByAccountId` (`:96-110`). Move those two into an accounts-side helper (e.g. `src/composables/useAccountMemberInfo.ts`) and delete the import. Only **two** files consume them — `TransactionsPage.vue:73` and `TransactionViewEditModal.vue:55`, both finance surfaces — so the move is contained. ~15 lines, and it turns the wall's finance guarantee from "no leaf happens to import it transitively" — which `eslint.config.js:322-332` openly admits the zone cannot check — into something structurally true. **Do this in Phase 0, before `useActivityIdentity` exists**, or the new composable ships the regression.
6. **A fourth default member colour, and a fourth variant resolver.** `useMemberAvatar.ts:34` defaults colour to `#3b82f6` (blue) where the other three fallbacks use neutral grey — so `resolveMemberColor` collapses four, not three. And `OnboardingInvitePanel.vue:85-87` returns `(member.avatar as AvatarVariant) || 'classic'`, where `'classic'` is not in `AvatarVariant` and `member.avatar` is not a field on `FamilyMember`; `getAvatarImagePath` absorbs it via `?? AVATAR_IMAGE_PATHS['adult-other']`, so **every invitee silently renders the neutral bean today**. `EveryoneSpread.vue:168` carries its own copy. Both are fixed by adopting the shared bindings, not as separate tasks.
7. **`WallMemberFace` has already drifted and lost a production fix.** It renders a photo with no `referrerpolicy="no-referrer"` (`:47-53`), while every other photo-rendering component in the app carries it — `BeanieAvatar.vue:114`, `PhotoViewer.vue:398`, `PhotoThumbnail.vue:139`, `MedicationCard.vue:83`, `MilestoneThumb.vue:106`, `PolaroidImage.vue:103` — because Google's lh3 CDN rate-limits per-Referer (documented incident, 2026-05-04). It also swaps to the photo immediately with no load-state, so a slow photo shows an empty coloured circle where the initial should be. **This is the argument for consolidation made concrete**: the newest copy silently dropped a hard-won fix. Both defects vanish when the file is deleted in favour of `BeanieAvatar`.
8. **`WallTodayView.membersFor` renders duplicate faces.** `:103-108` maps raw `normalizeAssignees` through `.find()` with no dedupe. Fixed for free by moving to `classifyActivityChip`.

Also noted and now **fixed rather than deferred**: all five avatar implementations collapse into `BeanieAvatar` in Phase 0.
**Noted, deliberately out of scope**: `TransactionsPage.vue:1291-1295` hand-rolls a _sixth_ gradient-circle-with-initial, but keyed on an **account** rather than a member, on a finance surface this change does not otherwise touch. Adopting `BeanieAvatar` there is a good follow-up; doing it here would widen the diff into the money pages for no design benefit. `MemberPill.vue:27-30` maps variants to emoji glyphs — a different medium, not an avatar; leave it alone. Still out of scope: `repeat`/`refresh` and `file`/`file-text` are duplicate paths in the icon registry.

### Sequencing note — the wall ships dark

`featureFlags.committed.ts` has `beanieWall: false`, so every wall change lands behind a flag that is off in production. **The user-visible blast radius of this release is the planner and to-dos only.** The planner changes have no flag and are the part that needs the release note.

### Sequencing note — two landings, not one

The "ship as one coherent release" rule applies to the **hue flip** (Phases 1–3), not to the whole plan. Phases 0 and 4 change no visible semantics: five avatar implementations become one, colours become unique, and unknown icon names become compile errors. They land **first, as their own commit**, verified by the acceptance criterion that all 33 pre-existing `BeanieAvatar` usages render unchanged.

This matters for revertability, which is the point: if the hue rule needs backing out, `git revert` of the second commit must not drag the avatar consolidation, the `referrerpolicy` fix and the colour-uniqueness rule back out with it. Phase 0 must land before Phase 1 regardless (requirement 10 gates requirement 11), so this costs no extra sequencing — only a commit boundary.

## Files Affected

**Created**

- `src/composables/useActivityIdentity.ts` (the single card-identity rule: colour, stack members incl. the lane rule, emoji, celebration, wash style)
- `src/components/ui/ActivityOwnerStack.vue`
- `src/utils/activityEmoji.ts`
- `src/utils/activityCelebration.ts`
- `src/utils/memberInitials.ts` (pure `computeInitials`; the store getter wraps it)
- `src/constants/celebrationKeywords.ts`
- tests for each of the above

**Deleted**

- `src/components/wall/WallMemberFace.vue` → absorbed by `BeanieAvatar fallback="initials"`
- `MemberChip.vue`'s `dot` size → callers use `BeanieAvatar` directly

**Data layer**

- `src/components/ui/BeanieAvatar.vue` — `fallback` + `initials` props; `variant` becomes **optional (not a discriminated union)** with a loud runtime guard; `2xs`/`2xl` **added** to the size scale, with `xs`–`xl` byte-identical
- `src/constants/memberColors.ts` — `nextFreeMemberColor`, `takenColors`, red→teal swap
- `src/components/ui/ColorCircleSelector.vue` — `taken` prop, disabled + titled swatches
- `src/components/family/FamilyMemberModal.vue` — replace `Math.random()` (`:146-147`), pass `taken`, collision notice
- `src/components/login/CreateMembersStep.vue` — replace owner-excluding round-robin (`:130-132`)
- `src/stores/familyStore.ts` — `initialsById` getter
- `src/composables/useMemberAvatar.ts` — `useMemberAvatarBindings()`; its `#3b82f6` colour default routed through `resolveMemberColor`
- `src/composables/useMemberInfo.ts` — colour fallback fix (`:88-90`); `DEFAULT_COLOR` deleted in favour of `memberColors.ts`; **`accountsStore` import removed** (the two `…ByAccountId` helpers move out)
- `src/composables/useAccountMemberInfo.ts` (new) — `getMemberNameByAccountId` + `getMemberColorByAccountId`, and their call sites re-pointed
- `src/components/onboarding/OnboardingInvitePanel.vue`, `src/components/scrapbook/EveryoneSpread.vue` — drop their local `avatarVariantFor` for `getMemberAvatarVariant`
- `src/composables/useActivityChipClass.ts` — import the shared fallback; derive ids from `effectiveAssignees`; import `HERITAGE_ORANGE` from `memberColors.ts` rather than declaring it. **The all-dead-ids case stays `solo` + neutral — see Latent Defect #3.**
- `src/utils/assignees.ts` — `isSharedEvent` only; `belongsInMemberColumn` unchanged, with a pinning test

**Card surfaces**

- `src/components/wall/WallEventChip.vue`, `WallTodayView.vue`, `WallLanesView.vue`, `WallDaysView.vue`, `WallSheet.vue`
- `src/components/wall/WallChoreBoard.vue`, `WallBeanColumn.vue`, `WallPeripheralCards.vue` (Phase 0 avatar swap)
- `src/utils/wallActivities.ts`
- `src/components/planner/MonthChip.vue`, `DailyCalendarView.vue`, `WeeklyCalendarView.vue`, `DayTimeline.vue`, `AllDayActivityChip.vue`, `ActivityListCard.vue`
- `src/components/nook/ScheduleCards.vue`, `src/pages/FamilyPlannerPage.vue`, `src/composables/useCriticalItems.ts` (emoji helper only)
- `src/components/planner/ActivityModal.vue` — stop writing `activity.color` (`:667`); add the celebration override control (reusing the modal's existing save `try/catch` + `reportError` path)

**To-dos and lists**

- `src/components/todo/TodoItemRow.vue` (`:209`)
- `src/components/lists/ListTile.vue` (`:76`), `ListCycleTile.vue` (`:66`), `LinkedLists.vue`, `ListDetailModal.vue`, `ListCycleModal.vue`
- `src/components/travel/TimelineSegmentCard.vue` (`:97`, `:119`)

**Pickers / filters**

- `src/components/wall/WallFooter.vue`, `src/components/common/MemberChipFilter.vue`, `src/components/ui/FamilyChipPicker.vue`, `src/components/ui/MemberChip.vue`
- `src/components/todo/TodoMemberFilter.vue` — face component swap only; stays faces-only

**Details surfaces**

- `src/utils/activityDetails.ts` — `icon: BeanieIconName` on `ActivityDetailRow`
- `src/components/wall/WallSheet.vue` (`:370-382`)
- `src/components/planner/ActivityViewEditModal.vue`
- `src/constants/icons.ts` — `satisfies` + `BeanieIconName` export; add `map-pin`, `clock`, `tag`
- `src/components/ui/BeanieIcon.vue` — narrow `name` to `BeanieIconName`; add the unknown-icon `console.error`
- `src/components/common/PageHeader.vue`, `CategoryIcon.vue`, `AccountTypeIcon.vue`, `src/components/ui/ChoiceModal.vue`, `RecurringEditScopeModal.vue` (icon-name narrowing)
- every current `WallMemberFace` / `MemberChip size="dot"` call site (see Phase 0)

**Strings, docs, telemetry**

- `src/services/translation/uiStrings.ts`
- `src/utils/diagnosticContext.ts` — `ALLOWED_CONTEXT_KEYS`
- `infrastructure/lambda/telemetry/index.mjs` — the pinned mirror
- `docs/runbooks/native-store-submission.md` + `PrivacyInfo.xcprivacy` + `privacy.astro`
- `src/content/help/*`
- `docs/mockups/2026-09-02-member-card-identity.html`
- `CHANGELOG.md`, `docs/STATUS.md`

**Tests to update**

- `AllDayActivityChip.test.ts`, `CalendarGrid.test.ts`, `CalendarGrid.today.test.ts`, `MonthDayCard.test.ts`, `CalendarMonthStream.test.ts`
- `MonthChip.test.ts`, `useActivityChipClass.test.ts`, `wallActivities.test.ts`, `matchesAssigneeFilter.test.ts`
- `MemberChip.test.ts` — **keep the `sm`/`md` cases**; the `dot` case is deleted along with the size
- `OnboardingInvitePanel.test.ts` and any other `BeanieAvatar` test — must stay green unchanged, proving the `fallback` default preserved existing behaviour

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Scope**: the article(s) describing the planner and the beanie wall need the colour rule restated — colours identify people, not activity types — plus how shared events and celebrations read, and where to change a bean's colour.
- **Notes**: call out that a bean's colour is now unique within the family, that changing it changes every card that bean appears on, and that a family created before this release may still hold a duplicate until someone edits it.

## Observability Coverage

**The volume constraint drives the design.** `logEvent` rate-limits to 50 events per `(surface, normalized-message)` per minute and console-warns when the cap trips (`logEvent.ts:74-103`). A month grid paints 100+ chips, so an event emitted from a per-render classifier or celebration predicate would be **suppressed within a single paint** and would flood the console. Events therefore fire at **decision points** (a save, an assignment) or as **one debounced per-session summary**.

**Events**

| surface                  | level  | when                                                                                                                                                                                                                                                                                                                                                                                         | context                                                                                                                                                               |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity-owner-resolve` | `warn` | once per session, debounced ~30s: aggregate of chips whose `assigneeIds` held ids resolving to nobody                                                                                                                                                                                                                                                                                        | `count`, `kind` (`partial` \| `all-dead`)                                                                                                                             |
| `member-colour`          | `info` | a bean is assigned a colour                                                                                                                                                                                                                                                                                                                                                                  | `action` (`assign` \| `reuse` \| `collision-edit`), `count` (taken), `kind` (`palette-free` \| `palette-full`)                                                        |
| `member-colour`          | `warn` | one event per member holding a blank/missing colour, emitted **once from `familyStore` when the roster changes** — never from `resolveMemberColor`, which stays a pure function in a zero-import constants module. A render-path emitter would need process-global mutable state in a constants file and an order-dependent test; a roster watcher is O(n) once per change and needs neither | `action: 'missing-colour'`, `count`                                                                                                                                   |
| `activity-celebration`   | `info` | on save only, when the celebration state is computed or overridden                                                                                                                                                                                                                                                                                                                           | `action` (`auto` \| `override-on` \| `override-off`), `kind` (`category-group` \| `emoji` \| `keyword` \| `none`), `error_code` (reused for `suppressed:errand-verb`) |

**Not instrumented, by design**

- _Missing registry icon_ — made a **compile error** in Phase 4, so there is nothing left to observe.
- _Two-letter initials_ — a pure function of the roster, fully covered by unit tests and visible on screen.
- _Per-render celebration decisions_ — see the volume constraint.

**Failure modes covered**

- _Confetti on the wrong event_ — `activity-celebration` records which rule fired at save time, so a spike in `kind: keyword` relative to `category-group` is the signal that title matching is over-firing.
- _A birthday that never celebrates_ — the same event fires with `kind: none`.
- _Dead assignee ids_ — the debounced summary makes that accumulation measurable for the first time, at a volume the firehose will accept.
- _Palette exhaustion_ — `action: 'reuse'` tells us how many real families exceed the palette. If Assumption #3 is accepted, this branch and its event are deleted rather than shipped.
- _A colourless bean_ — previously rendered a transparent chip and told nobody.

**Success-path signal.** `member-colour` and `activity-celebration` fire on the success path too. Both are well under `TELEMETRY_FLOOR_MS = 250`, so they are counted events rather than `perfTiming` records.

**Critical vs telemetry.** Nothing here warrants `severity: 'critical'`. Failures in the member-save path keep their existing `reportError` handling.

**Privacy / store gate.** `kind`, `action` and `error_code` already exist in the allowlist and are reused per the file's own convention (`diagnosticContext.ts:81-82`). ⚠️ **`count` does NOT** — the file carries only feature-scoped counters (`hint_count`, `file_count`, `notif_count`, `wallet_count`, `inferred_count`, `detail_field_count`), so a generic `count` is **one new key**, and every event in the table above depends on it. As written without this correction, all four events would be **stripped server-side** — the exact silent failure this section warns about two paragraphs earlier. It must land in `ALLOWED_CONTEXT_KEYS` **and** in the pinned Lambda mirror (`infrastructure/lambda/telemetry/index.mjs`, `diagnosticContext.ts:52-53`) **and** in the data-collection table in `docs/runbooks/native-store-submission.md` with its consumers (`PrivacyInfo.xcprivacy`, the store Data-Safety/App-Privacy answers, `privacy.astro`) — all five files are already in Files Affected, so this is a scope correction, not new work. All values are counts or fixed enums; **no activity titles, member names or free text may be logged**.

## Acceptance Criteria

- [ ] Every activity surface colours by member; no card surface reads `getActivityColor` for hue (it survives only for the category badge at `ActivityViewEditModal.vue:501`)
- [ ] `activity.color` is no longer written on save; existing values are left in place and ignored
- [ ] Category emoji renders on every activity card, resolved through the single `activityEmoji()` helper
- [ ] Owner faces are right-anchored on every card; the title's left edge is identical across cards with 0, 1, 2 and 3+ owners
- [ ] Face stack caps at 3 with a `+n` overflow, implemented **once** in `ActivityOwnerStack`
- [ ] Solo cards in a bean-lane / member-column layout show no face; shared cards show the other beans
- [ ] Shared = blended wash + faces + dashed edge; no-owner = Heritage Orange; celebration = gradient border + sticker + `ConfettiEffect`
- [ ] Celebration styling appears on activities only, never on to-dos or lists
- [ ] Party-group categories always celebrate; keyword matching is whole-word, errand-verb suppressed, emoji-aware, and overridable from the activity form
- [ ] Member colours are unique within a family going forward; taken swatches are `disabled` with a translated title naming the holder and show that member's face; new beans take the next free colour via one shared helper
- [ ] A member whose colour already collides can still be edited and saved, and is told about the collision by name
- [ ] Palette exhaustion shows a named notice and logs — it never silently reuses
- [ ] `#ef4444` is no longer in the member palette; the two pinned "palette excludes Heritage Orange" assertions still pass
- [ ] Two-letter initials appear only where two members share a first initial; photos win over initials; initials are grapheme-safe; **the rule is implemented once, at the `BeanieAvatar` call boundary via `initialsById`**, so cards, stacks, pickers and filters all inherit it
- [ ] To-do and list **cards** show faces; `FamilyChipPicker`, `MemberChipFilter` and `WallFooter` show face + name; **`TodoMemberFilter` stays faces-only and compact**
- [ ] `WallFooter` and `MemberChipFilter` carry the member-colour wash
- [ ] Wall sheet: the location→category fallback is gone; location always renders with an empty state; category has its own hero cell
- [ ] Both details surfaces render icon rows from the `BeanieIcon` registry; no inline location-pin SVG remains
- [ ] `BeanieIconName` exists and `BeanieIcon`'s `name` prop uses it — an unknown icon name fails `npm run type-check`
- [ ] **There is exactly one avatar implementation.** `WallMemberFace.vue` is deleted, `MemberChip`'s `dot` size is deleted, and `MemberChipFilter` / `FamilyChipPicker` no longer hand-roll a circle — all render `BeanieAvatar`. `grep -c` for inline `name.charAt(0)` avatar spans returns 0
- [ ] **No new photo-loading code was written.** Every photo path goes through `BeanieAvatar`, so `referrerpolicy="no-referrer"` and the load-state fallback now apply on the wall too
- [ ] All **33** pre-existing `BeanieAvatar` usages across **24** files render unchanged (the `fallback` default is `'beanie'`), and `xs/sm/md/lg/xl` pixel values are byte-identical to pre-change
- [ ] Every member face in the app is rendered via `useMemberAvatarBindings()`'s `memberAvatarBindings`, resolved once per component setup rather than once per face per render, so `grep -rn "photo-error" src --include=*.vue` shows no site wiring it by hand except the three non-member avatars (`BeanCard.vue:242`, `BeanAvatarPicker.vue:125`, `BeanHero.vue:202`, which use `refreshAvatar`/`refreshPhotoUrl` from `useAvatarPhotoUrl`)
- [ ] Member photos now render in `WallSheet`'s owner stack, which they did not before
- [ ] `BeanieAvatar` with `fallback="beanie"` and no `variant` renders `adult-other` **and** console.errors; `BeanieIcon` console.errors on an unknown name
- [ ] `MemberChip size="md"` still renders in `ActivityViewEditModal` and `TodoViewEditModal`; `MemberChip` is now name-pill-only
- [ ] `ActivityOwnerStack.vue` and `BeanieAvatar.vue` import no finance store, and `npm run lint` passes the wall finance zone
- [ ] **Both** `membersFor` duplicates are deleted (`WallTodayView.vue`, `WallSheet.vue`); `classifyActivityChip` is the only owner-set path and derives its ids from `effectiveAssignees`; a duplicated assignee id renders one face
- [ ] `belongsInMemberColumn` is **unchanged**, and a test pins its intentional divergence from `isSharedEvent`
- [ ] All **six** duplicate `activity.icon ?? getActivityFallbackEmoji(...)` expressions are deleted; all **eight** hand-rolled overlap stacks route through `ActivityOwnerStack`
- [ ] `#6b7280` / neutral-fallback is declared exactly once, in `memberColors.ts`, and `BeanieAvatar` imports no store. **All four** prior fallbacks are gone, including `useMemberAvatar.ts:34`'s blue `#3b82f6`
- [ ] `src/constants/memberColors.ts` has **zero imports**, and a unit test asserts it (a module-graph assertion, not a grep) — so `HERITAGE_ORANGE` no longer travels from a composable into a constants file and out again into `BeanieAvatar` and the wall zone
- [ ] `src/utils/wallActivities.ts` no longer reaches `accountsStore` transitively, **and neither does `useActivityIdentity`** — `useMemberInfo` no longer imports it at all, pinned by a module-graph test
- [ ] The card wash is expressed **once**, via `useActivityIdentity`'s `style`, at a single `WASH_ALPHA` constant — ``grep -rnE "\+ '[0-9a-f]{2}'|\}[0-9a-f]{2}\`" src/components/planner src/components/wall`` returns 0, and no surface concatenates a hex alpha by hand
- [ ] The bean-lane rule (requirement 5) is implemented **once**, in `useActivityIdentity`; no component decides for itself whether to hide a solo face in a lane
- [ ] Confetti never renders in a month chip, a week grid block or an all-day chip; it fires at most once per activity per session, and not at all under reduced motion
- [ ] `MemberChipFilter`'s face grows 18px → 24px; `2xl` (56px) is the only added size step and `xs`–`xl` are byte-identical, border included
- [ ] `fallback="beanie"` renders the existing bordered pastel container unchanged; `fallback="initials"` renders a flat member-colour fill with a white glyph, and the two pickers' `linear-gradient` fills are gone
- [ ] `OnboardingInvitePanel` and `EveryoneSpread` use `getMemberAvatarVariant`; the invalid `'classic'` variant is gone and invitees render their real bean
- [ ] All user-visible strings route through `t()`; celebration keyword lists live in a hand-curated locale constant, not `uiStrings.ts`, and `npm run translate` still parses `uiStrings.ts`
- [ ] Help Center article(s) added/updated and verified to match the shipped behavior
- [ ] Diagnostic logging implemented and verified (events fire with the stated `surface`/`context`; **no event fires from a per-render path**; the new `count` key is present in `ALLOWED_CONTEXT_KEYS`, the Lambda mirror **and** the store-declaration table, and the Lambda mirror test passes)

## Testing Plan

**Unit**

1. `nextFreeMemberColor` — returns the first unused colour; returns the colliding member when the palette is full; never returns a held colour while a free one exists; deterministic.
2. `takenColors` — excludes the member being edited, so their own colour stays selectable.
3. `computeInitials` — one letter normally; two letters for both members on collision; unaffected by a third non-colliding member; stable when a colliding member is removed; correct for an emoji/astral-plane first character.
4. `isCelebrationActivity` — Party-group categories match regardless of title; `"Buy birthday present"` does **not** match; `"partygoer"` and `"Anniversary Road"` do not match; `"Max's bday 🎂"` matches by emoji; the manual override wins in both directions; the Chinese keyword list matches Chinese titles; the returned `rule` is correct in every case.
   4b. `useActivityIdentity` — a solo card with `laneMemberId` set returns an empty stack; a shared card in a lane returns only the _other_ owners; the same card with no `laneMemberId` returns every owner; `classifyActivityChip` is invoked exactly once per call (spy assertion), not once per face; the celebration predicate is memoised across repeated calls for the same activity.
5. `activityEmoji` — prefers `activity.icon`, falls back to the category emoji, never returns empty.
6. `classifyActivityChip` — existing tests still pass; the all-dead-ids case still returns **`solo` + neutral** (a pinned regression test naming the reason: `family` would paint every family face from one corrupt record); de-duplication of a repeated assignee id; ids derived from `effectiveAssignees`.
7. `isSharedEvent` vs `belongsInMemberColumn` — a **pinning test** asserting they disagree on an all-dead-ids record, with the reason in the test name.
8. `resolveMemberColor` — **pure**: blank, whitespace and `undefined` all return the neutral colour; a valid hex passes through; no telemetry, no module state, no imports. The blank-colour warning is tested separately against `familyStore`'s roster watcher (one event per blank member per roster change, none for a healthy roster).
   8b. `isSharedEvent` — all-dead-ids returns `false` (matching the classifier); zero raw ids returns `true`.

**Component**

9. `BeanieAvatar` — `fallback="beanie"` (default) is byte-identical in behaviour to today, pinned by the existing `OnboardingInvitePanel` test; `fallback="initials"` renders initials on the member hue; the photo overlay only shows on `load` and reverts on `error` in **both** modes; `referrerpolicy` is present in both.
10. `ActivityOwnerStack` — renders ≤3 faces plus `+n`; renders nothing for an empty roster; renders `BeanieAvatar`; an import-graph assertion that it pulls no store.
11. `ColorCircleSelector` — a taken swatch is `disabled`, carries a title naming the holder, and does not emit on click; the excluded (own) colour is selectable.
12. `MemberChip` — the `dot` size is gone (a type error if requested); **`sm`/`md` name pills still render**, guarding `ActivityViewEditModal` and `TodoViewEditModal`.
13. `BeanieIcon` — a type-level test (`@ts-expect-error`) proving an unknown icon name does not compile.
14. Alignment regression — render cards with 0/1/2/4 owners and assert the title element's computed `left` is identical across all four.

**Integration / manual**

15. Walk the real app: wall lanes, wall days, wall today, month, week, day, agenda, list, to-dos, lists — in **light and dark**, at phone, tablet and wall widths, with Large text mode on.
16. Open an **existing** family that already holds a duplicate colour; confirm both members are still editable and the collision notice names the other bean.
17. Create beans until the palette runs out and confirm the exhaustion notice appears.
18. Create two beans sharing a first initial and confirm two-letter initials appear on both, everywhere — including the wall, the pickers and `TodoMemberFilter`.
    18b. Spot-check a sample of the 33 pre-existing `BeanieAvatar` usages across 24 files (sidebar, login person picker, pod hero, onboarding invite, photo thumbnails) and confirm nothing changed visually, and that the merged size scale did not shift any of them.
19. Open an activity with no location and confirm the wall sheet shows the location empty state and a separate category cell.
20. Confirm the wall still shows no financial figure anywhere, and `npm run lint` passes the finance zone.
21. Switch to Chinese and confirm celebration detection still fires and no English leaks into any new string; run `npm run translate`.
22. Open the month view with a busy month and confirm **no `[telemetry] rate cap hit` warnings** appear in the console.

**Regression**

23. Full suite green, `npm run type-check`, `npm run lint`.
24. E2E: existing planner specs pass unchanged; no new E2E test is added, per the ADR-007 three-gate filter.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the four-phase approach from the approved mockup, with the wall finance-zone constraint, the celebration keyword translation risk, and the latent-defect list.
- **Pass 2 (DRY + error handling)**: Corrected four factual errors (`MemberChip md` has live call sites; the finance-zone rationale; `belongsInMemberColumn`'s raw-id choice is deliberate; only one owner derivation is a true duplicate); replaced the `variant`-prop stack with a single face component collapsing four avatar implementations (later superseded — see the consolidation note below); moved initials to a store getter to avoid O(n²); renamed `celebration.ts` to avoid colliding with `useCelebration`; reused `ConfettiEffect`; made unknown icon names a compile error instead of a telemetry event; redesigned telemetry around the 50/min rate cap and flagged the Lambda allowlist mirror; replaced rose with teal.
- **Post-Pass-2 user direction (substantial — passes re-run)**: Greg asked why the avatar implementations were not consolidated to a single place. They now are: rather than building a new `MemberFace`, `BeanieAvatar` is extended with a `fallback: 'beanie' | 'initials'` prop (default preserves all 33 existing usages across 24 files), absorbing `WallMemberFace`, `MemberChip`'s `dot` size and the two inline circles — five implementations to one, with no new photo-loading code. This also fixes `WallMemberFace`'s missing `referrerpolicy="no-referrer"`, a production fix every other photo component carries.
- **Pass 2 (re-run, post-consolidation)**: Caught blocking errors in the consolidation — `WallMemberFace` has five call sites not three (and `WallSheet` is not one of them); `withDefaults` cannot take a discriminated union so `variant` becomes optional with a loud runtime guard; sizes must be **added** (`2xs`/`2xl`) not merged, since two absorbed sizes sit below today's minimum. Added `memberAvatarBindings()` to stop the consolidation replacing one component with five copies of its photo/error wiring. Found a second `membersFor` duplicate (`WallSheet`), eight overlap stacks not five, six emoji duplicates not four, and that `classifyActivityChip` re-implements `effectiveAssignees`. Rejected two of the plan's own proposals as regressions: routing `BeanieAvatar` colour through `useMemberInfo` (pulls a finance store into every avatar) and making the all-dead-ids case return `family` (paints every family face from one corrupt record). Corrected the call-site count to 33 usages / 24 files.
- **Pass 3 (Sustainability)**: Found the plan's store-free guarantee to be false — `memberColors.ts:39` re-exports `HERITAGE_ORANGE` _from_ `useActivityChipClass`, which reaches `useAccountsStore`, so `BeanieAvatar` and the wall zone would inherit a finance store; inverted the dependency to make `memberColors.ts` a zero-import leaf. Closed the largest remaining DRY hole by writing the card-identity rule once in a new `useActivityIdentity` composable (colour, lane-aware stack members, emoji, celebration, one `WASH_ALPHA`) instead of re-deriving five decisions across ten surfaces — the tree already carries three different wash alphas for one intent. Made the avatar bindings a setup-time composable rather than a per-face-per-render store lookup; kept `resolveMemberColor` pure by moving its telemetry dedupe into a `familyStore` roster watcher; bounded confetti and memoised the celebration predicate; raised `2xs` to 20px and forbade `fallback="initials"` below 24px to respect the 12px typography floor; split delivery into a semantics-free Phase 0+4 commit and the atomic hue-flip commit; and corrected three stale self-contradictions that would each have undone a deliberate decision.
- **Pass 4 (Fresh-eyes sweep)**: Found five implementation-time blockers — `classifyActivityChip` returns `members: []` for solo, so the wall `membersFor` swap would have deleted every solo owner's face; requirement 6's shared blend had no implementation locus and collided with a pinned "never wears one person's colour" test; `count` is **not** in `ALLOWED_CONTEXT_KEYS`, so all four telemetry events would have been stripped server-side; the bindings composable could not live in `useMemberAvatar.ts` without dragging `useAccountsStore` back in via the photo helpers; and `satisfies` on the icon registries breaks `icons.ts`'s own three string-indexed accessors. Cut three accreted items: the `2xs` size step and its sub-`xs` prohibition (one decorative consumer), the size-derived border (contradicted the byte-identical criterion), and the palette-extension open question — resolved to "stays at six" by the plan's own no-neighbouring-hues rule, which both proposed additions broke. Fixed a stale call-site count, a naming split, an out-of-order defect list, an unenforceable grep, an alpha undercount, and fourteen drifted line references. **Verdict: GO.**

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Let's look at the shading and design now. Can we review this holistically once more for the family member card style. At the moment each card gets a colored edge depending on the color of the person in the UI, however this is not clearly understood and also can be duplicated without any restriction from the UI (I believe). On top of that, the legend cards at the bottom do not show the member color, so that also doesn't help differentiate between family members.
>
> can you propose a design (or some options) for all cards that satisfies these goals:
>
> - clearly differentiates between family members
> - potentially uses the family member chip with initial (or picture if it exists) meaning that for shared events, can show multiple chips like on the today view
> - has a fun and welcoming vibe and decorative feel
> - the shared card style is also differentiated from the individual event family card style but in a subtle way - not too much. we want to share more differentiation for truly special/unique events (i.e. birthdays, celebrations, etc)
>
> As an aside (unrelated) one more change I'd like to make regarding the details drawer for activities - it seems when an event doesn't have a location, a decision was made to show the category instead in the details drawer with the name of the category written (i.e. music, trumpet, school, etc). this is confusing as the name of the category in words is not used anywhere else in the app. i would propose to remove this logic and for the purposes of having consistency in the UI keep that field fixed to only showing location. if no location exists, we can indicate that none exists. i would also propose to add icons to the details drawer to make it clearer to see the fields and also stay in line with other areas of the app (i.e. a calendar/date icon for date/time, location icon for location, etc).
>
> let me know your thoughts

### Follow-up 1

> can you put the mockup as a claude artifact pls

### Follow-up 2

> I like the concept of A, including the design for celebrations, since the chips/faces are good enough to make up for the shading changing in the case of a celebration event. for celebrations, for now we can use this style and apply it to events in the celebration category (or perhaps even scan events for somethig like birthday, bday, anniversary, baby shower, or other common celebration activities, in case a category was not applied)
>
> the only concern is that if you put the chips on the left and they continue to push the text to the right, in some cases the text woudl not be aligned, making it hard to read. we could handle this a couple ways, eithe rput the chips on the right, or always have a fixed area for the chips, or perhaps another way. waht do you suggest to keep the alignment fixed to ensure readability stays as the paramount concern

### Follow-up 3

> Looks good and let's go ahead with the right anchored chips as per your recommendation. note that for these fixes (including the the drawer fix) i was referring to the beanies wall details drawer, hwoever does it make sense to apply these design fixes universally for consistency across all calendar surfaces (including the non-wall one)?

### Follow-up 4

> and can it be done without duplicating following DRY rules

### Follow-up 5

> going to the quesiton of whether color defines member or category, and in the sprit of having consistency across the site, my inclination is that color defines MEMBER - color PLUS the face chip, which can also replace the full name chip across all calendar surfaces (daily, weekly, monthly, agenda, etc), saving space, given that the chip + color reinforces the member ownership). wtih this approach, we can also apply the shared and celebration styles site-wide. the category can still be seen in the detail pane, and pehaps to reinforce category, we can include th category icon on all activity cards, especially given we are saving space by reducing full name chips to face/initial chips. this could apply to the beanie wall design also
>
> as an addition, i'd like to update the full name chip to the face/initials chip on todos also, for consistency across the site. not sure if this convention is used anywhere else.
>
> what are your thoghts on this approach and would yo upropose anything difference

### Follow-up 6

> yes, update the mockup then take it to /beanies-plan

### Follow-up 7

> agree to keep the todo filter compact — faces only is fine there, but let's apply the same logic for initials in case there is a conflict

### Follow-up 8

> why not consolidate all the avatar implementations to a single place, unless the different implementations add value or address different issues where they cannot be consolidated?

### Follow-up 9

> go ahead and re-run the passes with the consolidation

### Follow-up 10

> once the plan is compelte move directly to implementation. once implementation is done run a /code-review max on all code implemented to ensure it operates as designed and as expected as compared to the plan and context of this conversation and does not introduce any new bugs, side effects, or security issues

### Follow-up 11

> once the code review is compelte fix any issues found and then report back

### Follow-up 12

> go ahead

</details>
