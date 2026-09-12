# Plan: Target the Google reconnect prompt at the person who can act on it

> Date: 2026-09-12
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-12-targeted-google-reconnect-prompt.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family member who did not set up the Google Calendar integration, I want to be told
that the calendar has disconnected and who can fix it — and then to be able to dismiss that
message — so that a problem I cannot solve does not permanently occupy my screen and block
the app's navigation.

## Context

greg observed this on a family member's phone while the Google grant was revoked: a
**non-dismissable** prompt about the calendar being disconnected, which covered the mobile
bottom navigation and stopped her tapping anything in the menu. She had not set up the
integration and does not have the Google account's password, so its one button — which opens
Google's consent screen — was useless to her.

The mechanism:

- `UnifiedReconnectToast.vue` is mounted app-wide in `App.vue:1939`, for every signed-in
  member, on every route except the two external landing routes.
- It renders `ReconnectToast` **without** passing `dismissible`, which defaults to `false` —
  so no ✕ is rendered at all.
- It is state-driven off `useReconnectCoordinator`, whose `calendarDown` is
  `connections.filter(c => c.status === 'needs_reconnect')`. That status lives in the
  family-wide CRDT, so it is true on **every** member's device simultaneously.
- The toast stack sits in the region the mobile tab bar occupies: the stack is
  `fixed right-4 bottom-4 z-[200]` (`App.vue:1933`), the nav is
  `fixed right-0 bottom-0 left-0 z-40` (`MobileBottomNav.vue:176`).
- **That overlap is an independent layout bug.** `App.vue:2250` already pads main content
  with `'pb-24': isMobile` to clear the nav; the toast stack never got the same treatment.
  So on mobile EVERY toast in that stack — `InstallPrompt` included — sits on top of the
  navigation, for every member including the owner. Targeting the prompt fixes _who is
  asked_; it does not, on its own, give the owner their tab bar back.

So one revoked grant produces a permanent, unclosable, un-actionable obstruction for every
member of the family except the one who owns the Google account.

### What is deliberately NOT changing

The unified prompt exists because Drive and Calendar can be repaired in one consent when
they share an account (tracker #62). That behaviour is correct and stays. This plan changes
only **who is asked** in the calendar-only case.

### Deliberately out of scope

1. **The duplicated per-member commit helper.** `useCommunityNudge.ts:148-157` and
   `useBeanTips.ts:241-250` are the same ten lines under two names (commit, roll back on
   throw, toast), and both pass a hardcoded English `errTitle` (`useCommunityNudge.ts:191`,
   `:199`, `:208`) in violation of CLAUDE.md's script-level-strings rule. Both are real and
   both should be fixed — **in their own commit**. This plan's dismissal does not use that
   pattern at all (§5), so extracting a shared helper here would ship a refactor of two
   unrelated composables inside a change to an app-wide always-mounted toast.
2. **The reconnect-repoint hazard** — see the security caveat below. Pre-existing, **not**
   widened by this plan (which narrows the toast's audience and therefore reduces exposure),
   and its fix changes the behaviour of an OAuth flow, which does not belong in a
   toast-targeting commit. Recorded here so it is deferred deliberately, not inherited
   silently.

## Requirements

1. **Calendar-only outage, to someone who can act**: the existing actionable prompt,
   unchanged — same title, same body, same Reconnect button, still not dismissable (it is
   their integration, and it is genuinely broken).
2. **Calendar-only outage, to everyone else**: a **dismissable** notice that says the
   calendar is disconnected and names who to ask. It carries **no Reconnect button**, because
   pressing it opens a consent screen for an account they do not have.
3. **Drive outage, or Drive + calendar together**: today's behaviour for everyone, unchanged
   — and a previously-dismissed _calendar_ notice must never suppress it. Unsaved family data
   is everyone's problem and the prompt should stay in the way.
4. **Owner resolution**, in order, so existing connections work with no migration:
   1. `connection.connectedBy` — a new field, written on connect — **and only when that id
      still resolves to a live member**; a removed member falls through rather than
      rendering "Ask Unknown";
   2. else a case-folded match of `connection.accountEmail` against members'
      **`googleAccountEmail`** — the OAuth-bound identity (`models.ts:291`), which is what a
      Google connection's `accountEmail` actually is;
   3. else a case-folded match against members' `email` — the user-editable contact address
      (`models.ts:273`), explicitly _not_ required to match any external account, so it is
      the weaker rung and comes second;
   4. else **pod managers** (`canManagePod`), so a connection made with an unmatched
      personal Gmail still reaches somebody who can act.

   An `accountEmail` of `'unknown'` (the sentinel written at `calendarSyncStore.ts:889` and
   `:908`, already special-cased at `:1022`) never matches anything and never appears in copy.

5. **Dismissal persists per device and per member**, keyed to the **connection ids** that were
   down when it was dismissed, so a newly-broken connection speaks up again.
6. No member is ever left with **no** indication: whoever dismisses still sees the status in
   Settings → Google Calendar, which is unchanged.
7. **The toast stack clears the mobile navigation** for every member and every toast it holds.

## Important Notes & Caveats

- **The Drive guarantee is one early return, and it lives in a pure function.**
  `variant !== 'calendar'` must return `{ mode: 'owner' }` unconditionally — before the roster
  gate, before the dismissal check, before owner resolution. Without it there is a live
  regression: `dismissedConnectionIds` holds _calendar_ ids, so a member who dismissed the
  calendar notice and then loses Drive gets `variant === 'both'` (`useReconnectCoordinator.ts:89`)
  with every down calendar id already dismissed — and the data-at-risk Drive warning
  disappears for them, silently and permanently. Putting the guard in the pure decider rather
  than a template expression is what makes it mutation-checkable.
- **`activeReconnectPrompt` must not be nulled** for the non-owner. `reconnectAll` reads
  `variant` at `useReconnectCoordinator.ts:140` to label the telemetry at `:218`, so nulling
  the state would silently relabel those events `'none'`. The existing `visibleReconnectPrompt`
  computed in `UnifiedReconnectToast` is the established place for a display-only suppression.
- **`createCalendarConnection` is NOT only the fresh-connect path.** `calendarSyncStore.ts:904`
  falls through to it from the _reconnect_ branch when the target connection has vanished
  (removed or remotely healed — the comment is in the source). Writing `connectedBy`
  unconditionally there hands ownership to whoever tapped Reconnect.
- **Existing connections have no `connectedBy`** and MUST fall through to the email rungs.
- **Email rungs must skip placeholder addresses.** `FamilyMember.email` is a required `string`
  (`models.ts:273`) that the app populates with generated placeholders for members without a
  real address. Use `isTemporaryEmail` (`utils/email.ts:5`) rather than a bare non-empty check
  — it covers both `@setup.local` and `@temp.beanies.family`, so it is strictly better than
  the hand-inlined `endsWith('@temp.beanies.family')` at `familyStore.ts:181`.
- **Case folding.** `useReconnectCoordinator.ts:43` has a module-private `sameAccount`. Lift
  it into `src/utils/email.ts`, which already holds this exact family of helpers
  (`isTemporaryEmail`, `isValidEmail`, `isUnshareableEmail`) and is dependency-free — **not**
  into `connectionOwner.ts`, which is named for a concern `sameAccount` does not have (the
  coordinator uses it at `:96` and `:124` for the reconnect plan, not for ownership).
- **The `dismissible` branch of `ReconnectToast` has never rendered.** The component has
  exactly one call site (`UnifiedReconnectToast.vue:59`), which never passes it. Its markup
  must be authored and checked in both modes now, not assumed working.
- ⚠️ **SECURITY — "owner" here is INFERRED, not verified, and the reconnect path does not
  check.** `calendarSyncStore.ts:1063` passes the connection's `accountEmail` as a `loginHint`
  only; Google lets the user pick any signed-in account, and `finalizeConnected` (`:888-894`)
  then overwrites `accountEmail` + `refreshToken` with whatever they picked, with no
  positive-match guard — unlike the unified fan-out at `:920-927`, which explicitly requires a
  POSITIVE match "so one account's token can never leak into another's". Anyone who completes
  that consent silently repoints the family's calendar at their own account, and
  `revokeCalendarGrantGuarded` (`:1070`) has already killed the old grant.

  **This is pre-existing, and this plan reduces exposure to it**: the toast goes from every
  member to owner-or-managers, while `CalendarSyncSettings.vue:332-339` remains open to
  everyone with no permission gate at all (which is also the escape hatch Requirement 6 relies
  on). But rungs 2-4 make "point this specific person at the consent screen" a _designed_ path,
  and rung 3 matches the user-editable `email`, which is explicitly not bound to any Google
  account. **Do not let a future reader infer from `resolveConnectionOwner` that the person
  named has been verified.** The fix — a positive-match guard in `finalizeConnected` mirroring
  `:1022`'s fail-safe shape — is deferred to its own commit because it changes the behaviour of
  an OAuth flow (a family deliberately switching Google accounts via Reconnect would be
  affected) and that decision deserves its own review, not a ride-along in a toast change.

## Assumptions

> **Review these before implementation.**

1. `CalendarConnection` lives in the family-wide CRDT and adding an optional `connectedBy`
   field is backward-compatible. Verified mechanically: `CreateCalendarConnectionInput`
   (`models.ts:1117-1120`) omits only `id|createdAt|updatedAt`, so the field flows through,
   and `exactOptionalPropertyTypes` is not set, so `connectedBy: … : undefined` compiles.
2. ⚠️ **The roster is NOT reliably populated when the toast mounts.** `App.vue:1939` gates only
   on `!authStore.needsAuth`, which is true well before `familyStore.members` fills, and
   `usePermissions.ts:22-45` carries a long comment about exactly this hazard (it falls back
   to the forgeable session `role` while `members` is empty). Hence the roster gate in §3.
3. `usePermissions().canManagePod` is the right "can act on family configuration" predicate;
   it is already the gate on Settings' data-management cards (`SettingsPage.vue:1686`, `:1694`).
4. There is at most a handful of calendar connections per family, so resolving an owner per
   render is not a performance concern, and a dismissed-id array stays small.
5. ⚠️ **Rung 1 (`connectedBy`) is the least reversible decision in this diff** — a permanent
   optional field in the family-wide CRDT that applies to no existing connection. Rungs 2-4
   already cover every case today. It is kept because it is the only rung that is _known_
   rather than _inferred_, and inference gets worse as families grow — see the security caveat,
   where inference is precisely what makes the designation unverified.

## Approach

### 1. Model: record who connected it

`src/types/models.ts` — add to `CalendarConnection`, beside the other provenance fields:

```ts
/**
 * The family member who set this integration up. Absent on connections made
 * before this field existed, and absent whenever the connecting member is
 * unknown; `resolveConnectionOwner` then falls back to matching
 * `googleAccountEmail`, then `email`, then pod managers. Written ONCE, on a
 * FRESH connect — never on a reconnect, because the person repairing a
 * connection is not necessarily its owner.
 *
 * NOT a verified claim — see the security caveat in the plan: nothing in the
 * reconnect path checks which Google account actually consented.
 */
connectedBy?: UUID;
```

`src/stores/calendarSyncStore.ts` — **name the condition once**, rather than spreading a
ternary into the object literal:

```ts
// One name for the fresh-connect question, shared by the mint trigger and
// `connectedBy`. NOT "is a reconnect": `connectionId` may be present here and
// still be a fresh create, because the reconnect branch falls through when the
// connection has vanished (see the comment at :904).
const isFreshConnect = !connectionId;
```

Use it at `:882` (`trigger: isFreshConnect ? 'connect' : 'reconnect'`, replacing the second
copy of the same fact) and in the create at `:906`:

```ts
connectedBy: isFreshConnect ? (useFamilyStore().currentMemberId ?? undefined) : undefined,
```

⚠️ **The guard is load-bearing** — see the vanished-connection caveat. The named symbol also
gives the mutation check (Testing Plan item 5) something to target.

Identity comes from `useFamilyStore().currentMemberId` (`familyStore.ts:25`), not `authStore`.
The coupling this introduces is smaller than it looks: `calendarSyncStore.ts:82` already
imports `makeMemberNameResolver`, which calls `useMemberInfo()` → `useFamilyStore()`
(`src/utils/calendar/memberNames.ts:16-22`, whose docblock already records "Must be called
within a store action (Pinia active)"). This makes an existing substantive dependency direct.
Confirm the existing `calendarSyncStore` tests need no new stubs.

### 2. One pure decision, one shape end to end

New `src/utils/calendar/connectionOwner.ts` (neighbour to `linkOwnership.ts`, which answers a
different ownership question — about linked _events_, not _connections_; the two must not be
confused):

```ts
/** The coordinator's calendar descriptor, plus the new provenance field.
 *  ONE shape end to end: `useReconnectCoordinator.ts:34` exports it, the
 *  composable passes it straight through, no adapter `.map()` anywhere. */
export type CalendarDownDescriptor = {
  connectionId: string;
  /** `CalendarConnection.accountEmail` (`models.ts:1098`, required).
   *  `'unknown'` is the sentinel — never null, never undefined. */
  email: string;
  connectedBy?: UUID;
};

export type OwnerVerdict =
  | { kind: 'member'; memberId: UUID; via: 'connected-by' | 'google-email' | 'contact-email' }
  | { kind: 'managers'; accountEmail: string | null }; // null when the 'unknown' sentinel

export function resolveConnectionOwner(
  connection: CalendarDownDescriptor,
  members: readonly Pick<FamilyMember, 'id' | 'email' | 'googleAccountEmail'>[]
): OwnerVerdict;

export type OutageAudience =
  | { mode: 'owner' }
  | { mode: 'notice'; owner: OwnerVerdict } // data, NOT a rendered string
  | { mode: 'hidden' };

/** Pure. Every branch table-testable with no Pinia, no localStorage, no Vue. */
export function decideOutageAudience(input: {
  /** The coordinator's own variant. NON-'calendar' variants ALWAYS return
   *  { mode: 'owner' } — the Drive data-at-risk warning reaches everyone, and a
   *  dismissed CALENDAR notice can never suppress it. This early return is the
   *  whole Drive guarantee; it lives here, in a pure function, so it is
   *  table-testable and mutation-checkable rather than a template expression. */
  variant: 'drive' | 'calendar' | 'both';
  downConnections: readonly CalendarDownDescriptor[];
  members: readonly Pick<FamilyMember, 'id' | 'email' | 'googleAccountEmail'>[];
  viewerId: string | null;
  viewerCanManagePod: boolean;
  dismissedIds: readonly string[];
}): OutageAudience;
```

Resolver rules, all table-testable:

- `connectedBy` wins **only if it resolves to a member still in `members`** — a removed
  member falls through, because "Ask Unknown to reconnect it" is worse than naming a manager.
- Email rungs compare case-folded via `sameAccount`, skip `isTemporaryEmail` addresses on the
  member side, and skip the `'unknown'` sentinel on the connection side.
- `via` exists for telemetry: it is how a "she still can't dismiss it" report gets triaged
  from CloudWatch without a repro.

Decision rules, in order:

1. `'owner'` **unconditionally** when `variant !== 'calendar'`. No roster gate, no dismissal
   check, no owner resolution. Every rule below is reachable only under `'calendar'`.
2. `'hidden'` when the roster is empty (§3).
3. `'owner'` when the viewer can act on **at least one** down connection —
   `downConnections.some(c => ownsOrManages(c))`, where `ownsOrManages` is
   `verdict.kind === 'member' && verdict.memberId === viewerId`, or
   `verdict.kind === 'managers' && viewerCanManagePod`. Call it `viewerOwnsAny`. Deliberately
   **some**, not **all**: if two are down and the viewer owns one, the actionable prompt is
   correct, because the button already reconnects everything it can
   (`useReconnectCoordinator.ts:147`). Showing that person a notice with somebody else's name
   on it would be this plan's own failure, inverted.
4. `'hidden'` when every down connection id is already in `dismissedIds`.
5. `'notice'` otherwise, carrying the verdict for the first non-dismissed down connection.

### 3. Wiring it up

**Not in `useReconnectCoordinator`.** `UnifiedReconnectToast.vue:27-50` records the standing
decision for exactly this kind of logic: display-only concerns live in the component so the
coordinator and its 13 tests keep a zero-line diff. Putting `usePermissions()` into the
coordinator would also install its `watch` (`usePermissions.ts:68`) into a composable whose
tests mock only two stores. (While in that file, fix its stale "six existing tests" at `:46`.)

The coordinator needs **two lines**: carry `connectedBy` on `CalendarDown` (`:34`) and in the
`.map` at `:76`. The composable reads `downFeatures` (`:224`) and narrows with
`.filter((f) => f.kind === 'calendar')` — a type narrow on a discriminated union, **not** a
second `status === 'needs_reconnect'` query.

New `src/composables/useCalendarOutageAudience.ts` is ~40 lines of **wiring only**: take
`downFeatures` and the active prompt's `variant` as **parameters**, read
`familyStore.members`/`currentMemberId`, `canManagePod` and the per-member store, call
`decideOutageAudience`, expose `audience` + `dismiss()`. No `t()`, no `fillTemplate`, no
`getMemberName` — which also keeps `src/composables/**` clear of the
`beanies-i18n/no-bare-render-strings` display-key rule.

- **Parameters, not a second instance.** `useReconnectCoordinator` is a plain factory (`:47`);
  calling it again would build a second `isReconnecting`/`reconnectError` pair in the same
  component tree. `UnifiedReconnectToast.vue:24` already holds the one instance. Passing refs
  in also makes the composable's own test trivially injectable — no coordinator mock at all.
- **Roster gate**: returns `'hidden'` while `familyStore.members.length === 0` — **not**
  `isDocLoaded()`. This is the condition the decision actually depends on, it is the same test
  `usePermissions.ts:46` already names `rosterLoaded` for exactly this hazard, and unlike
  `isDocLoaded()` (`docService.ts:23`, a plain function, not a ref) it is genuinely reactive,
  so the gate cannot latch if the computed's other dependencies are later restructured.
- **The verdict carries data, not copy.** The component picks the key from `owner.kind`/`via`
  and interpolates with `useMemberInfo().getMemberName(memberId, t('family.unknownMemberInline'))`
  (`useMemberInfo.ts:74`) plus `fillTemplate`. This is the established precedent:
  `useReconnectCoordinator.ts:101-105` returns `titleKey`/`bodyKey` and
  `UnifiedReconnectToast.vue:54,61` renders them.

⚠️ `unifiedReconnectToast.test.ts:30-37` mocks the coordinator with four keys and **no**
`downFeatures`. That mock must gain it, or all six existing suppression tests break —
including the `SharedRecipe` visitor test, which is a shipped safety behaviour.

### 4. The notice for everyone else

The render gate becomes `v-if="visibleReconnectPrompt && audience.mode !== 'hidden'"`. That is
safe precisely because `'hidden'` is unreachable for non-calendar variants by construction
(§2 rule 1) — one expression, one guarantee, one place.

When the verdict is `'notice'`, render `ReconnectToast` with `dismissLabel: t('action.dismiss')`,
the owner-naming body, and **no `reconnectLabel`**.

**Both affordances become label-driven — two props deleted, zero call-site churn.**

- `reconnectLabel` becomes optional, and the button (`ReconnectToast.vue:89-97`) gets
  `v-if="reconnectLabel"`. It renders with no `v-if` today, so an empty label would render an
  empty Heritage-Orange button; an `actionable?: boolean` prop is not the answer either.
- **Delete the `dismissible` prop** (`:31`, `:40`, `:100`) and render the ✕ on
  `v-if="dismissLabel"`. Today two props describe one affordance, and `dismissLabel` defaults
  to `undefined`, so `:aria-label` binds nothing and the ✕ is an unlabelled button (`:103`).
  Making the label the switch turns "always pass the label" from a convention enforced by
  nothing into a structural guarantee. No call site passes `dismissible` today.

The absence of a label IS the absence of the affordance — one fact, one prop, both sides.

Also update `ReconnectToast.vue:2-15`'s docblock: it currently promises "Each feature binds its
own title/labels **and a reconnect handler**". After this change it is a status toast that is
_optionally_ actionable — `role="status"` (`:55`) is already correct for that. A stale docblock
on a shared presentational component is how the next consumer re-adds a required-action
assumption.

**Dark mode.** `ReconnectToast.vue:102` — `text-slate-400` / `hover:text-slate-600` are
Tailwind's raw grey ramp with **no dark partner on the resting state** (only
`dark:hover:text-ink` exists). Add `dark:text-ink-faint` and `dark:hover:text-ink`.
`vue/no-restricted-class` catches `dark:text-gray-*` but a bare light-mode `text-slate-400`
slips past it.

**Companion layout fix (`App.vue:1933`).** The reported symptom — "she couldn't tap anything in
the menu" — is only half a targeting problem. Change the stack's mobile offset to
`bottom-[calc(6rem+env(safe-area-inset-bottom))]`, leaving the existing `md:bottom-6` alone.
Not a bare `bottom-24`: `MobileBottomNav.vue:177` adds `padding-bottom: env(safe-area-inset-bottom)`
to its own height, so a flat `6rem` can leave residual overlap on a device with a home
indicator. The `pb-24` precedent (`App.vue:2250`) pads a _scroll_ container where an
under-measure is recoverable; a `fixed` stack's offset is not. The JS and CSS breakpoints do
agree here: `useBreakpoint.ts:3` defines `isMobile` as `(max-width: 767px)`, Tailwind v4's
default `md:` is `min-width: 768px`, and no `--breakpoint-*` override exists — so the offset
and `MobileBottomNav v-if="isMobile"` (`App.vue:2259`) switch on the same pixel.

### 5. Dismissal that persists and re-arms

Inside `useCalendarOutageAudience.ts`, on `createPerMemberStore` (`perMemberStore.ts:149`) —
modelled line-for-line on `useCalendarNudge.ts` (the closest existing store: 91 lines,
`schemaVersion` + `fromParsed` validation, `clearOnSignOut: true`):

- prefix `'bean-reconnect-notice'` (the existing prefixes are `bean-*`, cf.
  `useCalendarNudge.ts:33`);
- state `{ schemaVersion: 1; dismissedConnectionIds: string[] }`;
- show the notice when **any** down calendar connection id is absent from
  `dismissedConnectionIds`. On dismiss, **set** (do not union) the array to the current down id
  set, so ids that have healed are pruned rather than accumulating forever.

⚠️ **Store ids, not a joined fingerprint.** A single `dismissedKey` of sorted-and-joined ids
re-nags when the outage gets _better_: dismiss with `A` down, `B` also breaks (key `"A,B"`,
correctly re-shown), dismiss again, then `B` is **repaired** — the fingerprint is `"A"` again,
which differs from `"A,B"`, so the notice returns for an outage already dismissed twice,
triggered by something healing. A set answers the question that actually matters ("is anything
down that this member has not already dismissed?") and has no ordering contract to preserve
across schema versions.

A connection that recovers and breaks again keeps its id and stays dismissed. Accepted: a
timestamp would re-nag on every reconcile tick.

**Write failure is not surfaced** — flip the state in memory, call `store.save(next)`, ignore
the result. This is exactly `useCalendarNudge.ts:84-88`, whose docblock at `:77-83` records the
rationale: `perMemberStore.ts:85-90` already `reportError`s the failure at severity `'warning'`,
and the only consequence is the notice returning after a reload — self-correcting and
non-destructive. A toast about a failed dismissal would also occupy the very screen region this
plan exists to unblock.

### 6. i18n

New keys in `uiStrings.ts`, `en` + `beanie`, real nouns kept (this is an important surface — a
reader who acts on a euphemism leaves the family's calendar broken):

- `reconnectPrompt.calendar.noticeTitle` — "Google Calendar is disconnected"
- `reconnectPrompt.calendar.noticeBody` — "New activities are not reaching Google. Ask {name}
  to reconnect it."
- `reconnectPrompt.calendar.noticeBodyAccount` — the `managers` verdict WITH an email
- `reconnectPrompt.calendar.noticeBodyUnknown` — the `managers` verdict with **no usable
  email**. Required, not optional: `accountEmail` is the literal `'unknown'` whenever consent
  returned no address, and the account-naming body would render "Ask whoever manages unknown
  to reconnect it."

**No new dismiss-label key.** `action.dismiss` already exists (`uiStrings.ts:1378`); the file
already carries four copies of that string and this change does not add a fifth.

**Add `'reconnectPrompt.'` to `IMPORTANT_PREFIXES` in `uiStrings.test.ts:97`.** Today it is
absent (the sibling `calendarSync.reconnect.` IS listed, at `:133`), so nothing stops a later
edit turning "Google Calendar is disconnected" into bean-speak — on a surface CLAUDE.md names
explicitly ("connection loss"). Safe to apply retroactively: every existing `reconnectPrompt.*`
`beanie` value (`uiStrings.ts:7060-7095`) is already a lowercase copy of its `en` with no
`BEAN_WORD` hit, so the retro-applied check passes without touching shipped copy.

## Files Affected

- `src/types/models.ts` — `CalendarConnection.connectedBy?`
- `src/stores/calendarSyncStore.ts` — `isFreshConnect` named once, used at `:882` and `:906`
- `src/utils/email.ts` — `sameAccount` lifted out of `useReconnectCoordinator.ts:43`
- `src/utils/calendar/connectionOwner.ts` — **new**: `CalendarDownDescriptor`,
  `resolveConnectionOwner`, `decideOutageAudience`, all pure
- `src/composables/useReconnectCoordinator.ts` — **two lines**: carry `connectedBy` on
  `CalendarDown` (`:34`, `:76`); import `sameAccount` from `utils/email`
- `src/composables/useCalendarOutageAudience.ts` — **new**, ~40 lines of wiring
- `src/components/common/UnifiedReconnectToast.vue` — the owner/notice branch, the copy, and
  the stale "six existing tests" comment at `:46`
- `src/components/common/ReconnectToast.vue` — `reconnectLabel` optional + `v-if`;
  `dismissible` deleted, ✕ on `v-if="dismissLabel"`; dark partners at `:102`; docblock
- `src/App.vue:1933` — toast stack mobile offset clears `MobileBottomNav` + safe-area inset
- `src/services/translation/uiStrings.ts` — four keys, `en` + `beanie`
- `src/services/translation/uiStrings.test.ts` — add `'reconnectPrompt.'` to `IMPORTANT_PREFIXES`
- `src/utils/calendar/__tests__/connectionOwner.test.ts` — **new**, the bulk of the coverage
- `src/composables/__tests__/useCalendarOutageAudience.test.ts` — **new**, wiring only
- `src/components/common/__tests__/reconnectToast.test.ts` — **new**: the shared component's
  first test file; pins both `v-if` affordances and the ✕'s `aria-label`
- `src/components/common/__tests__/unifiedReconnectToast.test.ts` — **extend** (note the
  lowercase `u`; do not create a second file). Its coordinator mock needs `downFeatures`.

## Observability Coverage

**Surface: `'unified-reconnect'`** — the surface this feature already owns
(`useReconnectCoordinator.ts:206`, `:216`). A new `'reconnect-prompt'` surface would split one
feature across two CloudWatch filters, which CLAUDE.md observability rule 3 exists to prevent.

**Events** (mirroring the composite-action shape of the sibling event at `:218`,
`action: 'reconnect-all:${variant}:${outcome}'`):

- `logEvent({ level: 'info', surface: 'unified-reconnect', message: 'reconnect prompt shown',
context: { action: 'prompt-shown:<variant>:<audience>:<via>' } })` — `variant` ∈
  drive|calendar|both, `audience` ∈ owner|notice, `via` ∈
  connected-by|google-email|contact-email|managers|n-a (the last for non-calendar variants,
  which skip resolution entirely). Fired from a `watch` on the verdict, whenever `(mode, via)`
  **changes** to a decided value — not per render, and with **no session registry**: a genuine
  change in the outage or its resolution is exactly when a new event is wanted, and a repeat
  for an unchanged verdict cannot occur because the watch does not fire. This is the
  success-path signal (rule 6): it makes the RATIO of owner-prompts to bystander-notices
  measurable, which is the point of the change — and `via` is what makes a "she still can't
  dismiss it" report triageable from the logs alone (rule 1: log the decision, not the crash).
- `logEvent({ level: 'info', surface: 'unified-reconnect', message: 'reconnect notice
dismissed', context: { action: 'notice-dismissed:calendar' } })`
- `reportError` on a `localStorage` write failure is already provided by `createPerMemberStore`
  (`perMemberStore.ts:85-90`, severity `'warning'`) — inherited, not re-implemented.

**Failure modes covered**: an owner who never sees the prompt (a family with a down connection
and no `prompt-shown:*:owner:*`); a bystander nagged repeatedly (repeated `prompt-shown` for an
unchanged outage); a dismissal that does not stick (`notice-dismissed` immediately followed by
another `prompt-shown:*:notice:*`); a misresolved owner (a spike in `:managers`, which is also
the only "unresolved" state the verdict has — there is deliberately no separate `unresolved`
enum value, because `OwnerVerdict` has exactly two arms and a filter that can never fire reads
as "this is not happening"); **and the Drive regression** — any `prompt-shown:both:notice:*` or
`prompt-shown:drive:*` at all is a bug, because those variants must always be `owner`.

**Critical vs telemetry**: none of these is `critical`. Nothing here is a failed user action or
data at risk — the underlying outage has its own reporting (`useReconnectCoordinator.ts:204-209`).

**Privacy/store gate**: `action` is already allowlisted at `src/utils/diagnosticContext.ts:61-68`
(**not** `logEvent.ts` — that file only documents the allowlist, at `:50-54`). No new key ships,
so neither the Lambda mirror (`infrastructure/lambda/telemetry/index.mjs`, pinned by
`src/utils/__tests__/telemetryAllowlistDrift.test.ts`) nor the store-declaration table needs
updating. Member names and account emails are NEVER put in `context` — they belong only in the
rendered string. Every value above is a fixed enum.

## Acceptance Criteria

- [ ] A calendar-only outage shows the actionable prompt only to someone who can act on it
- [ ] A member who owns one of two down connections sees the actionable prompt, not the notice
- [ ] Every other member sees a dismissable notice naming who to ask, with no Reconnect button
- [ ] Dismissing it hides it for that member on that device and it does not return for the same outage
- [ ] A newly-broken connection shows the notice again; a previously-dismissed connection
      **healing** does NOT
- [ ] A Drive outage, and Drive+calendar together, behave exactly as today for every member
- [ ] **A member who dismissed the calendar notice still sees the full prompt when Drive later
      goes down** (`variant` flips to `'both'`)
- [ ] `connectedBy` is written on a fresh connect and NEVER on a reconnect — including the
      vanished-connection fall-through at `calendarSyncStore.ts:904`
- [ ] A `connectedBy` pointing at a removed member falls through the ladder, never rendering "Unknown"
- [ ] `googleAccountEmail` is matched before `email`
- [ ] An `accountEmail` of `'unknown'` matches nobody and never appears in rendered copy
- [ ] A member whose only email is a generated placeholder never matches a connection
- [ ] Nothing new renders while the roster is empty — no cold-load flash of the wrong prompt
- [ ] A failed dismissal write never crashes; the notice simply returns after a reload
- [ ] The ✕ cannot render without an `aria-label`, and is readable in BOTH light and dark
- [ ] The toast stack no longer overlaps `MobileBottomNav` on mobile — for the owner too
- [ ] `'reconnectPrompt.'` is in `IMPORTANT_PREFIXES` and the beanie-euphemism test passes
- [ ] All six existing `unifiedReconnectToast` suppression tests still pass
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified

## Testing Plan

1. Table-test `resolveConnectionOwner` + `decideOutageAudience` in one pure suite — no Pinia,
   no Vue. Cover each `via`; `connectedBy` pointing at a removed member (must fall through);
   `googleAccountEmail` preferred over a conflicting `email`; `email`-only; no match;
   placeholder emails; case-mismatched emails; the `'unknown'` sentinel; **owns one of two**
   (→ `owner`); all ids dismissed (→ `hidden`); one new id among dismissed (→ `notice`); empty
   roster (→ `hidden`); and **every** `variant !== 'calendar'` combination (→ `owner`).
2. Unit-test the dismissal store: dismiss → reload → same outage stays hidden; a new connection
   breaking shows it again; a healed connection does NOT; a `localStorage` that throws never
   crashes and leaves the notice dismissed for the session.
3. Extend `unifiedReconnectToast.test.ts`. ⚠️ Its `ReconnectToast` stub (`:42-48`) renders a
   bare `<div>` with only `title`/`subtitle`, so "assert the button is absent" would pass
   **vacuously** there. Widen the stub's `props` to
   `['title','subtitle','reconnectLabel','dismissLabel','busy']` and assert on the props handed
   down (`reconnectLabel` undefined for a bystander, defined for an owner; `dismissLabel` the
   inverse), plus: `drive` and `both` reach both roles unchanged; nothing renders while the
   roster is empty.
4. **New** `reconnectToast.test.ts`, mounting the REAL component — its first test file, and the
   first time either affordance's `v-if` is exercised. `reconnectLabel` present → action button
   rendered; absent → **no button element in the DOM**; `dismissLabel` present → ✕ rendered
   **with a non-empty `aria-label`**; absent → no ✕.
5. **Mutation check**: delete the `variant !== 'calendar'` early return in `decideOutageAudience`
   and confirm a _pure_ test fails — specifically `{ variant: 'both', dismissedIds: [every down
calendar id] }`, which must still return `'owner'`. A Drive outage silenced by a
   previously-dismissed _calendar_ notice is the worst outcome this change could produce, and
   it is reachable without touching the Drive code at all.
6. **Mutation check**: invert `isFreshConnect` and confirm a `calendarSyncStore` test fails on
   the vanished-connection reconnect path.
7. Browser, both modes: family of two, revoke the grant, confirm the non-owner can dismiss and
   the bottom navigation is reachable — **and that the owner's tab bar is reachable too**.
   Check the ✕ is legible on dark.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the targeted-prompt design from the observed defect.
- **Pass 2 (DRY + error handling)**: Corrected the owner ladder (`googleAccountEmail` before
  `email`; live-member check; `'unknown'` sentinel), gated `connectedBy` on a fresh connect only
  (`createCalendarConnection` is also the reconnect fall-through), moved the audience decision
  out of the coordinator per the documented precedent, reused `action.dismiss` / `getMemberName`
  instead of new copies, suppressed the action button with an optional `reconnectLabel` rather
  than a new prop, fixed the never-rendered ✕'s dark mode and `aria-label`, folded in the
  one-class fix that clears the mobile nav for the owner too, and pointed telemetry at the
  existing `unified-reconnect` surface with the resolver verdict in `action`.
- **Pass 3 (Sustainability)**: Split the unrelated `commitPerMemberState` / i18n refactor of
  `useCommunityNudge`+`useBeanTips` out of scope; dropped the dismissal-failure toast, rollback
  flag and telemetry arm per `useCalendarNudge.ts:77-88`'s documented precedent; moved the whole
  decision into a pure `decideOutageAudience` so the composable is ~40 lines of wiring and the
  verdict carries data rather than rendered copy; replaced the joined-fingerprint dismissal key
  with a pruned id set (the fingerprint re-nagged when a second connection _healed_); resolved
  the all-vs-some contradiction in favour of **some**; deleted the redundant `dismissible` prop
  so an unlabelled ✕ is structurally impossible; re-homed `sameAccount` to `utils/email.ts` and
  swapped the non-empty email guard for `isTemporaryEmail`; named `isFreshConnect` instead of an
  inline conditional spread; replaced the non-reactive `isDocLoaded()` gate with the roster test
  `usePermissions.ts:46` already owns; and removed the unemittable `via: 'unresolved'` enum plus
  the session registry behind `prompt-shown`.
- **Pass 4 (Fresh-eyes sweep)**: Closed a live Drive regression by moving the
  `variant !== 'calendar'` early return **into** `decideOutageAudience` (a dismissed calendar
  notice could otherwise suppress the `'both'` prompt's data-at-risk Drive warning through the
  `'hidden'` gate) and re-pointed the mutation check at that pure branch; reconciled the two
  mismatched connection type signatures onto one `CalendarDownDescriptor` so no adapter `.map()`
  is needed; caught that the planned "assert the button is absent" test would pass **vacuously**
  because `unifiedReconnectToast.test.ts:42-48` stubs `ReconnectToast` with a button-less
  `<div>`, adding a real-component test file and flagging that the coordinator mock at `:30-37`
  lacks `downFeatures`; recorded the pre-existing reconnect-repoint hazard
  (`calendarSyncStore.ts:1063`'s `loginHint` is only a hint; `:888-894` overwrites
  `accountEmail`/`refreshToken` with no positive-match guard, unlike `:920-927`) as a deliberate
  deferral rather than a silent inheritance, noting this plan _narrows_ rather than widens
  exposure; passed the composable the coordinator's refs instead of instantiating it twice;
  offset the toast stack by the safe-area inset; and corrected nine wrong `file:line` citations.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial question

> we are currently pushing events to a connected google calendar - but one question i have is
> does this work consistently across all family members? what happens if one of hte family
> members does not have access to the shared google calendar?
>
> also if the google calendar becomes disconnected (i.e. the grant is revoked) and the toast
> appears on the screen of a family member that does not know the google calendar password,
> then how do they dismiss the toast or reconnect?

### Correction 1

> I am fairly certain this framing is also incorrect. I can confirm that I was on a family
> member's phone (who did not initially setup the calendar integration) and while the grant
> was revoked, she had a non-dismissable toasat about the calendar being disconnected which
> prevented her phone from being able to tap anything in the menu or perform most actions.
>
> i think the correct behavior is to only show the google calendar disconnected toast to the
> person who initially configured the integration. for others, a dismissable toast about the
> loss of connection and a message to inform the calendar owner. does this work?

### Approval

> yes go ahead and plan and build it with /beanies-plan, once done run a code review and fix
> any issues found

</details>
