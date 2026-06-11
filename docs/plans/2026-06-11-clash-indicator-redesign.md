# Plan: Calendar clash indicator — active/quiet redesign + acknowledge memory (#34)

> Date: 2026-06-11
> Related issues: #34 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-06-11-clash-indicator-redesign.md`
> Mockup: `docs/mockups/calendar-clash-indicator-2026-06-11.html`

## User Story

As a family member, when a beanies activity overlaps something on a connected external calendar, I want a clear-but-calm heads-up that names the calendar and lets me say "this is OK" (quieting it for the whole family) or reschedule — so an expected overlap stops nagging me, while a genuinely new conflict still gets my attention.

## Context

The #34 clash nudge shipped (prod-off, behind `calendarClashNudge`) as a **subtle Heritage-Orange dot** wired into all five calendar surfaces. greg wants it (a) clearer and on-brand via the approved mockup's _overlap-mark_ motif, and (b) **dismissible but recoverable** — you can quiet an overlap you expected, it's remembered for the whole family and across devices, and a quieted overlap **re-raises itself if you later reschedule the activity**. Nothing is ever deleted (a clash is derived from live data; a hard "clear" could permanently hide a real conflict).

The visuals are mostly recombinations of what already ships. The one genuinely new ingredient is **memory**: a small family-shared "we acknowledged this overlap" set in the Automerge document.

**Confirmed design decisions (greg, 2026-06-11):**

1. **Calendar name = the account email** already held on the connection (`calendarLabel = connection.accountEmail`). No new nickname field. Consistent with what Settings shows. (Verified: `CalendarConnection.accountEmail` exists at `src/types/models.ts:619`, and `calendarClashStore.recompute` already sets `calendarLabel: connection.accountEmail`.)
2. **Drawer-only acknowledge.** Grid/agenda surfaces show the active state (mark, or a labeled chip where there's room) and a tap opens the drawer; **"This is OK" lives only in the drawer.** One write path. (No inline `×` on grid chips — that was mockup-only.)
3. **Re-raise on reschedule.** The acknowledgment stores a _fingerprint_ = the activity occurrence's own time window. Move the activity to a new time/day and the fingerprint mismatches → it re-raises. No external-event identity stored (keeps the privacy story intact).

Where the mockup and the beanies CIG/UI theme differ, the **theme wins** (Heritage Orange never Alert Red; standard Tailwind sizes, no arbitrary px; three-tier modal system already in use by the drawer).

## Requirements

1. Replace the dot in `ClashIndicator.vue` with the mockup's **overlap-mark** (two overlapping rounded shapes + filled vesica, Heritage Orange via `currentColor`), with two visual states:
   - **Active** (unacknowledged): prominent. On roomy surfaces, a labeled pill `[mark] <email>`. On the month grid (tight), the mark plus a soft Heritage-Orange ring on the chip.
   - **Quiet** (acknowledged): a small faded mark only, on every surface.
2. Keep all five existing wiring sites working (month / week / day / agenda / drawer) through the **same `useClash` / `useClashLookup` seam** — no new store coupling in components.
3. New **family-shared, persisted acknowledge memory** (Automerge CRDT): keyed by `activityId : occurrenceDate : connectionId`, valued with the time-window fingerprint + who/when. Persists across reload and syncs across devices.
4. The **activity drawer** (`ActivityViewEditModal.vue`) shows, when an overlap exists for the open occurrence:
   - **Active callout**: mark + "Overlaps your **\<email\>** calendar" + "Dismiss if you expected it." + buttons **[This is OK]** **[Reschedule…]** + a subtle **"What's this?"** help link.
   - **Quiet ack line** (after acknowledging): faded mark + "You're OK with this overlap · **\<email\>**" + **Undo**.
5. **"This is OK"** writes the acknowledgment (CRDT) → every surface reactively flips active→quiet. **"Reschedule…"** opens the drawer's existing reschedule form. **"Undo"** removes the acknowledgment → flips back to active. **"What's this?"** opens the calendar-clash help article.
6. All new user-visible text via `uiStrings.ts` (en + beanie + zh), under the existing `calendarSync.clash.*` group.
7. Everything stays behind the prod-off `calendarClashNudge` flag — no behavior change in prod.

## Important Notes & Caveats

- **Detection is unchanged.** `computeClashes` still returns the _first_ clashing connection per occurrence (single-connection v1). The mockup's "two calendars at once" pluralization is **out of scope** — the data layer surfaces one connection. (The acknowledge key includes `connectionId`, so the model already generalizes to multi later.)
- **The drawer does not fetch.** It reflects whatever the planner already computed for the visible window (`clashFor` reads the in-memory `clashes` map). Opening the drawer for an activity whose clash is shown on the grid → callout shows. No network in the modal. If a clash isn't in the current window's map, no callout (acceptable — never a false callout).
- **No silent failures on the write path.** `changeDoc` **throws synchronously** if no doc is loaded; it does **not** internally swallow/report errors. The notifications store proves the required pattern: `notificationsStore.applyReducer` (`src/stores/notificationsStore.ts:163`) wraps every `changeDoc` call in `try/catch` + `reportError`, and pre-checks `isDocLoaded()` + `currentMember`, reporting a `warning` if either is missing. **The new `overlapAckStore` MUST do the same** — a bare `changeDoc` here would surface as an uncaught throw inside a click handler.
- **Orphan acks are harmless and bounded.** The key omits the fingerprint, so there is **at most one ack entry per (activity, occurrence, connection)** — a reschedule reuses the same key (overwritten on re-ack; ignored meanwhile via fingerprint mismatch). Deleting an activity, or a recurring reschedule that materializes a new override id, leaves a tiny orphan ack that is simply ignored at read time. No pruning needed for v1; note as a future cleanup if the set ever grows.
- **Recurring reschedule** materializes an override with a **new activity id** → a new ack key entirely; the original occurrence's ack orphans harmlessly. Expected.
- **All-day activities** are still skipped by detection (`activityTimeRange` → null). Unchanged — so `fingerprint` is only ever set when a range exists.
- **No arbitrary px / no `text-[Xpx]`.** Mark sizes map to standard Tailwind height classes (`h-3` month, `h-3.5` chip, `h-4` drawer); width auto via the SVG viewBox aspect. The active ring uses `ring-1 ring-primary-500`, not an arbitrary shadow.
- **Help link opens externally, not in-app.** Help articles are marketing-site pages, opened via `openExternal(`${MARKETING_URL}/help/security/external-calendar-clash-nudge`)` (the same `openExternal` + `MARKETING_URL` pattern `WhatsNewBody.vue:66` uses). **Path-shape verified:** the in-app help link convention is `/help/<category>/<slug>` (`security.ts`, `deploys.ts`, `DocumentExtractConsentModal.vue` all use `/help/security/<slug>` e.g. `/help/security/how-your-data-is-encrypted`). `help/security/external-calendar-clash-nudge` matches (`category: 'security'`, `slug: 'external-calendar-clash-nudge'`, joined with the leading slash from the template). `openExternal` **must be called synchronously inside the click handler** (PWA popup-blocker constraint, documented in `src/utils/openExternal.ts`). The clash article is gated by `CLASH_NUDGE_HELP_LIVE` (currently `false`, flipped alongside the flag at launch); the link is wired now and goes live with the flag.

## Assumptions

> Review before implementation.

1. `ClashInfo` gains `fingerprint: string`, `activityId: string`, and `occurrenceDate: string`; the clash unit tests asserting its shape are updated accordingly. **Verified:** `computeClashes` (`src/utils/calendar/clashDetection.ts:117`) already computes `const range = activityTimeRange(occ.activity, occ.date)` immediately before setting the clash, and `occ.activity.id` / `occ.date` are in hand at the same site — so all three new fields are **zero extra computation**. **Verified — exactly two assertions break:** `clashDetection.test.ts` has two `expect(clashes.get(...)).toEqual({ connectionId, calendarLabel })` sites (lines 102–105 and 120–123) that assert the **full** two-field `ClashInfo` literal via deep-equality `toEqual`. Adding the three fields makes the emitted object a superset, so **both** must be updated (see Files Affected / Testing Plan for the exact remedy). No other test (freebusy/eventTimes/calendarMapping) constructs or asserts a `ClashInfo` literal; the only non-test consumers (`useClash`, `calendarClashStore`, `ClashIndicator`) read fields, never construct the type, so they are unaffected.
2. **Verified:** the calendar-clash help article exists — `slug: 'external-calendar-clash-nudge'`, `category: 'security'` (`src/content/help/security.ts:70`), conditionally exported into `SECURITY_ARTICLES` via `...(CLASH_NUDGE_HELP_LIVE ? [CLASH_NUDGE_ARTICLE] : [])`. "What's this?" targets this slug; we add a short "Quieting an overlap" section to its `sections` array.
3. **Verified:** `useTranslation().t(key)` takes **only** a `UIStringKey` — **no param interpolation**. The email is **concatenated** at the call site (matching the existing tooltip: `` `${t('calendarSync.clash.tooltipPrefix')} ${label}` ``). Strings are split so the email sits between two translatable fragments (prefix + suffix) — never embedded in a single key.
4. **Verified:** `overlapAckStore` is a **pure projection of the doc** (like `notificationsStore`) holding no local mutable cache → no teardown needed. `notificationsStore` is **NOT** registered in `resetStores.ts`. The doc is cleared centrally by `resetDoc()` on sign-out, which zeroes the projection. So `overlapAckStore` is likewise **not** added to `resetStores.ts`.
5. **Verified:** `familyStore.currentMember` (`src/stores/familyStore.ts:21`) is `computed(() => members.value.find((m) => m.id === currentMemberId.value))` → `currentMember.id` is the correct `acknowledgedBy` accessor, identical to how `notificationsStore.applyReducer` reads `familyStore.currentMember` and uses `member.id`.

## Approach

### 1. Data model (CRDT) — the acknowledge memory

- **`src/types/models.ts`** — new interface (reuse the existing `ISODateString` alias):
  ```ts
  export interface OverlapAck {
    activityId: string;
    occurrenceDate: string; // YYYY-MM-DD
    connectionId: string;
    fingerprint: string; // activity occurrence time window at ack time: `${startMs}-${endMs}`
    acknowledgedAt: ISODateString;
    acknowledgedBy: string; // memberId
  }
  ```
- **`src/types/automerge.ts`** — add to `FamilyDocument`: `overlapAcknowledgments: Record<string, OverlapAck>;` (key = `overlapAckKey(...)`).
- **`src/services/automerge/docService.ts`** — add `'overlapAcknowledgments'` to `ALL_COLLECTIONS` (auto-migrates loaded docs) **and** initialize `overlapAcknowledgments: {}` in `initDoc()`. Both required — `ALL_COLLECTIONS` only backfills _loaded_ docs; `initDoc` covers _new_ ones.

### 2. Pure helpers (extend the existing clash module — DRY)

- **`src/utils/calendar/clashDetection.ts`**:
  - Add `overlapAckKey(activityId, occurrenceDate, connectionId): string` next to `clashKey` (single source of truth; same `:`-join style). Keep it **positional and consistent with `clashKey`**. **Sustainability guard:** all three args are same-typed strings, so a co-located unit test asserts the exact emitted key string (e.g. `act:2026-06-11:conn`) — a silent argument transposition fails CI rather than corrupting keys at runtime.
  - Add `fingerprint: string`, `activityId: string`, `occurrenceDate: string` to `ClashInfo`. In `computeClashes`, set them in the same object literal where `connectionId`/`calendarLabel` are set (`fingerprint = `${range.startMs}-${range.endMs}``, `activityId = occ.activity.id`, `occurrenceDate = occ.date`). No new pass. (These three let the `useClash` enrichment helper in step 4 be fully self-contained — it never needs the lookup keys threaded in separately.)

### 3. The acknowledge store — `src/stores/overlapAckStore.ts` (new)

Mirror `notificationsStore`'s doc-projection + guarded-write pattern exactly:

- Read side reads `getDoc().overlapAcknowledgments` only when `isDocLoaded()`, **touching `void docVersion.value;` at the top of the read** (the exact idiom `notificationsStore` uses, `src/stores/notificationsStore.ts:78`) so the Vue dependency on `docVersion` is tracked — without that touch a `computed` consuming `isAcknowledged` would NOT re-run on a `changeDoc` bump.
- `isAcknowledged(activityId, occurrenceDate, connectionId, fingerprint): boolean` — true iff an entry exists at `overlapAckKey(...)` **and** its stored `fingerprint` equals the passed one. (Pure read; tolerant of a missing collection on an un-migrated doc → `false`; tolerant of empty-string args → non-existent key → `false`, never throws.)
- `acknowledge(...)` and `unacknowledge(...)` both go through **one shared private writer** `applyChange(label, mutator)` (in the spirit of `applyReducer`) that:
  - pre-checks `isDocLoaded()` and `familyStore.currentMember`; if either missing, `reportError({ surface: 'overlap-ack-<label>', severity: 'warning', message: '… — ack unchanged' })` and returns (no throw, no silent no-op);
  - wraps `changeDoc((doc) => { if (!doc.overlapAcknowledgments) doc.overlapAcknowledgments = {}; mutator(doc.overlapAcknowledgments); }, 'overlapAck: <label>')` in `try/catch`, reporting any throw as `severity: 'error'` with developer guidance.
  - `acknowledge`'s mutator upserts the single key (`acknowledgedAt = new Date().toISOString()`, `acknowledgedBy = currentMember.id` — Assumption 5); `unacknowledge`'s `delete`s the key. One entry per unique key → a whole-object set is the correct CRDT granularity (no per-field merge dance).
- Stateless projection → **not** added to `resetStores.ts` (Assumption 4).
- **Maintainability note:** the store's _only_ public surface is `isAcknowledged` / `acknowledge` / `unacknowledge`. It does not expose the raw map or the key format — callers go through `useClash` (reads) and the three named methods (writes). Keeps the projection shallow.

### 4. The consumer seam — `src/composables/useClash.ts` (enrich)

Join detection + memory **only here**. Return a `ResolvedClash`:

```ts
export interface ResolvedClash extends ClashInfo {
  acknowledged: boolean;
}
```

Define **one private helper** in this file and have both seams call it (the enrichment formula lives in exactly one place):

```ts
function resolve(raw: ClashInfo | undefined): ResolvedClash | undefined {
  if (!raw) return undefined;
  return {
    ...raw,
    acknowledged: overlapAckStore.isAcknowledged(
      raw.activityId,
      raw.occurrenceDate,
      raw.connectionId,
      raw.fingerprint
    ),
  };
}
```

- `useClash` → `computed(() => resolve(store.clashFor(toValue(activityId), toValue(occurrenceDate))))`.
- `useClashLookup` → returns `(id, date) => resolve(store.clashFor(id, date))` (unchanged contract — called once in `setup()`, returned fn invoked per row).

Both read both the reactive `clashes` ref (via `clashFor`) and `docVersion` (via the ack store's `docVersion.value` touch — step 3), so the result recomputes when either changes — **acknowledging in the drawer flips every surface reactively**. `resolve()` short-circuits `undefined` first, so when `clashFor` returns `undefined` (including the empty-string-arg case from the drawer's `activity.value?.id ?? ''` fallback) the ack store is never consulted. Components never import either store directly.

### 5. `ClashIndicator.vue` (rebuild, still purely presentational)

- Props: `clash?: ResolvedClash`, `variant?: 'mark' | 'chip'` (default `'mark'`).
- One `state` computed + a flat, single-level switch (no nested templates); the overlap-mark SVG is defined **once** (a small local snippet/sub-component) so the vesica markup is never copy-pasted:
  ```ts
  const state = computed<'quiet' | 'active-mark' | 'active-chip'>(() => {
    if (!props.clash || props.clash.acknowledged) return 'quiet';
    return props.variant === 'chip' ? 'active-chip' : 'active-mark';
  });
  ```
  Template: outer `v-if="clash"`, then a flat three-way switch on `state`. `quiet` and `active-mark` share one element bound to a computed size/opacity class.
- Inline SVG overlap-mark using `currentColor` + `text-primary-500`; quiet = `opacity-70`. Standard Tailwind heights `h-3`/`h-3.5`/`h-4`.
- Tooltip/aria always names the calendar (reuses `calendarSync.clash.tooltipPrefix` + concatenated label — Assumption 3); the label computed is shared by all states.

### 6. Surface wiring (small, mechanical)

- **`MonthChip.vue`**: `<ClashIndicator :clash variant="mark" />` + apply `ring-1 ring-primary-500` on the chip when `clash && !clash.acknowledged`. `useClash` already in place.
- **`WeeklyCalendarView.vue`, `DayTimeline.vue`, `ActivityListCard.vue`**: pass `variant="chip"`. Lookups already wired.

### 7. The drawer callout — `ActivityViewEditModal.vue`

- Add `const clash = useClash(() => activity.value?.id ?? '', () => props.occurrenceDate ?? activity.value?.date?.split('T')[0] ?? '')` (mirrors the fallback already used in `toggleReschedule`). The empty-string fallback is harmless — `clashFor('')` is a plain `Map.get` miss → `undefined` → no callout, never a throw (verified).
- **Keep the modal thin.** The three click handlers are one-liners delegating straight to the store / existing methods (no business logic in the modal):
  - **This is OK** → `overlapAckStore.acknowledge(id, occ, clash.value.connectionId, clash.value.fingerprint)`.
  - **Reschedule…** → existing `toggleReschedule()` (reuse the built-in form — no new form).
  - **What's this?** → `openExternal(`${MARKETING_URL}/help/security/external-calendar-clash-nudge`)` **synchronously** in the handler. Import from `@/utils/openExternal` + `@/utils/marketing`.
    If the callout markup proves bulky enough to obscure the modal's other concerns, extract a small presentational `ClashCallout.vue` taking `clash: ResolvedClash` + emitting `acknowledge` / `unacknowledge` / `reschedule` / `help` (modal keeps the four trivial handlers). **Optional — only if it improves readability; no indirection for its own sake.**
- Above the schedule-summary box, render (only when `clash.value`):
  - **Active** (`!clash.value.acknowledged`): the callout (mark + title concatenating `clash.value.calendarLabel` between `overlapsCalendarPrefix`/`calendarSuffix` + `dismissHint` + **[This is OK]** **[Reschedule…]** + **"What's this?"**).
  - **Acknowledged**: the quiet ack line (faded mark + `acknowledgedLine` + `·` + `clash.value.calendarLabel` + **Undo** → `overlapAckStore.unacknowledge(...)`).
- Styling maps mockup callout tokens to brand utilities (`bg-primary-500/8`, `ring-1 ring-primary-500/20`, Outfit headings) — three-tier modal provides the shell.

### 8. i18n — `src/services/translation/uiStrings.ts`

Add under `calendarSync.clash.*` (each `en` + lowercase `beanie`): `overlapsCalendarPrefix` ("Overlaps your"), `calendarSuffix` ("calendar"), `dismissHint` ("Dismiss if you expected it."), `thisIsOk` ("This is OK"), `whatsThis` ("What's this?"), `acknowledgedLine` ("You're OK with this overlap"), `undo` ("Undo"). **Reuse** `planner.reschedule` for the Reschedule button. Email concatenated, never interpolated. Run `npm run translate` for zh.

### 9. Help Center

Add a short **"Quieting an overlap"** `heading` + `paragraph` (optionally extend the existing private/read-only `infoBox`) to `CLASH_NUDGE_ARTICLE.sections` in `src/content/help/security.ts`: what the heads-up means, that beanies reads _when_ (never _what_), and that "This is OK" quiets it for the whole family until you reschedule (nothing deleted; Undo available). Article stays gated by `CLASH_NUDGE_HELP_LIVE`.

## Files Affected

**New**

- `src/stores/overlapAckStore.ts`
- `src/stores/__tests__/overlapAckStore.test.ts`

**Modified**

- `src/types/models.ts` — `OverlapAck` (reuse `ISODateString`)
- `src/types/automerge.ts` — `overlapAcknowledgments` collection
- `src/services/automerge/docService.ts` — `ALL_COLLECTIONS` + `initDoc()`
- `src/utils/calendar/clashDetection.ts` — `overlapAckKey`, + `fingerprint`/`activityId`/`occurrenceDate` on `ClashInfo`
- `src/composables/useClash.ts` — `ResolvedClash` enrichment via one shared `resolve()` helper (both seams)
- `src/components/planner/ClashIndicator.vue` — single-SVG overlap-mark + variants + flat `state` switch
- `src/components/planner/MonthChip.vue` — `variant="mark"` + active ring
- `src/components/planner/WeeklyCalendarView.vue` — `variant="chip"`
- `src/components/planner/DayTimeline.vue` — `variant="chip"`
- `src/components/planner/ActivityListCard.vue` — `variant="chip"`
- `src/components/planner/ActivityViewEditModal.vue` — callout + ack/undo + reschedule wire + help link (optional `ClashCallout.vue` extraction)
- `src/services/translation/uiStrings.ts` — `calendarSync.clash.*` keys (+ generated zh)
- `src/content/help/security.ts` — "Quieting an overlap" section in `CLASH_NUDGE_ARTICLE`
- `src/utils/calendar/__tests__/clashDetection.test.ts` — **two existing `.toEqual({ connectionId, calendarLabel })` assertions (lines 102–105 and 120–123) must each gain `activityId`/`occurrenceDate`/`fingerprint`** (prefer adding the explicit values so the fingerprint format stays covered, vs `expect.objectContaining`) **+ a new `overlapAckKey` exact-string test**. These are the only `ClashInfo`-literal assertions in the suite.
- `src/composables/__tests__/useClash.test.ts` (or equivalent) — acknowledged enrichment

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `security`
- **Slug**: `external-calendar-clash-nudge` (verified — `src/content/help/security.ts:71`)
- **Title**: unchanged
- **Scope**: add a short "Quieting an overlap" section — that beanies reads _when_ your external events are but never _what_ they are, and that "This is OK" quiets a given overlap for the whole family until the activity is rescheduled (nothing deleted; you can Undo).
- **Notes**: emphasize the privacy framing (times only) and that quieting is family-shared + reversible. Article remains gated by `CLASH_NUDGE_HELP_LIVE`.

## Acceptance Criteria

- [ ] `ClashIndicator` renders the overlap-mark (not a dot) in active/quiet states; mark vs labeled chip by `variant`; Heritage Orange, never Alert Red. The vesica SVG is defined once (no copy-paste across states).
- [ ] Month chip shows the active ring + mark when unacknowledged, mark only when quiet; week/day/agenda show the labeled chip (active) / faded mark (quiet).
- [ ] Drawer shows the active callout for an overlapping occurrence; **This is OK** quiets it and the callout becomes the ack line with **Undo**.
- [ ] Acknowledging in the drawer reactively flips the mark to quiet on **all** surfaces (CRDT write) — verified the ack store touches `docVersion.value` so the `useClash` computed re-runs.
- [ ] Acknowledgment persists across reload and syncs across devices.
- [ ] Rescheduling the activity re-raises the overlap (fingerprint mismatch).
- [ ] **Reschedule…** opens the existing reschedule form; **What's this?** opens the help article via `openExternal` (synchronous in handler).
- [ ] Both `useClash` seams resolve+enrich through the **same** `resolve()` helper (no duplicated enrichment formula).
- [ ] Every `overlapAckStore` write is guarded (pre-check + `try/catch` + `reportError`) — no uncaught throw in a click handler, no silent no-op.
- [ ] `overlapAckKey` has an exact-string unit test guarding argument order.
- [ ] Both pre-existing `clashDetection.test.ts` `toEqual` assertions updated for the three new `ClashInfo` fields; suite green.
- [ ] All new strings go through `uiStrings.ts` (en + beanie + zh); email concatenated, not interpolated; no hardcoded English.
- [ ] Feature remains entirely behind `calendarClashNudge` (prod-off); help article stays behind `CLASH_NUDGE_HELP_LIVE`; no prod behavior change.
- [ ] Help article section added and matches shipped copy.
- [ ] `npm run validate` green.

## Testing Plan

1. **Unit — `overlapAckStore`**: acknowledge → `isAcknowledged` true for matching fingerprint, false for a mismatched one; unacknowledge removes it; second device sees it after `mergeDoc` (round-trip); **reactivity** — a `computed` reading `isAcknowledged` recomputes after `acknowledge`/`unacknowledge` (proves the `docVersion.value` touch is in place); **error path** — `acknowledge` with no loaded doc / no current member reports a `warning` and does not throw.
2. **Unit — `clashDetection`**: `computeClashes` sets `fingerprint` + `activityId` + `occurrenceDate` from the occurrence; the two existing full-shape `toEqual` assertions updated to include the three fields (asserting the exact `${startMs}-${endMs}` fingerprint value); `overlapAckKey` asserted against an exact composite string (guards arg order).
3. **Unit — `useClash`**: `acknowledged: false` when no ack, `true` for a matching-fingerprint ack, **false again** after the fingerprint changes (reschedule); `resolve(undefined)` returns `undefined` without consulting the ack store; both `useClash` and `useClashLookup` exercise the shared `resolve()` path.
4. **Component — `ClashIndicator`**: light render assertions for the four cases (none / active-mark / active-chip / quiet). No heavy multi-store mounts.
5. **Manual (dev, flag on)**: connect a calendar, overlapping activity → active mark/chip per surface + active callout in drawer; This is OK → quiet everywhere + ack line; Undo → active; reschedule → re-raises; reload → quiet persists. Light/dark.
6. **No new E2E** (Three-Gate Filter: flag-gated, not a data-loss journey).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full active/quiet redesign + CRDT acknowledge memory; detection/memory decoupled, joined only in `useClash`; drawer-only acknowledge; fingerprint = occurrence time window; account-email label.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim. Corrected the error-handling story — `changeDoc` throws and does NOT self-report, so `overlapAckStore` mirrors `notificationsStore.applyReducer` (pre-check + try/catch + reportError) via one shared guarded writer feeding both acknowledge/unacknowledge (DRY); added an error-path test. Pinned help to `openExternal(MARKETING_URL + '/help/security/external-calendar-clash-nudge')` called synchronously. Confirmed no `t` interpolation (concatenate via prefix/suffix; reuse `planner.reschedule`), no `resetStores.ts` entry, fingerprint free from existing `range`, both `ALL_COLLECTIONS` + `initDoc()` needed, verified slug + `CLASH_NUDGE_HELP_LIVE` gate.
- **Pass 3 (Sustainability)**: Removed the duplicated `acknowledged`-enrichment across `useClash`/`useClashLookup` by routing both through one `resolve()` helper (adding `activityId`/`occurrenceDate` to `ClashInfo` so it's self-contained); flattened `ClashIndicator` to a single `state` computed + one-definition SVG (no triple-nested template); added an exact-string test guarding `overlapAckKey` argument order; constrained the store's public surface; flagged an optional `ClashCallout.vue` extraction. No Pass-2 error-handling/DRY decision weakened.
- **Pass 4 (Fresh-eyes sweep)**: Verified the five flagged correctness risks against source. (a) Found **two pre-existing `toEqual({connectionId, calendarLabel})` full-shape assertions** in `clashDetection.test.ts` (lines 102–105, 120–123) that deep-equality would break — made the test-update note concrete (was generic) across Assumption 1, Files Affected, Acceptance Criteria, Testing Plan; no freebusy/eventTimes test constructs `ClashInfo`. (b) Reactivity — made the ack store's required `void docVersion.value` touch explicit so the `useClash` computed re-runs on `changeDoc`. (c) Confirmed `clashFor('')`/`isAcknowledged('', …)` are throw-free `Map.get` misses + noted `resolve()` short-circuits `undefined`. (d) Added Assumption 5 verifying `familyStore.currentMember.id` as `acknowledgedBy`. (e) Confirmed `/help/security/<slug>` matches the established convention. No settled decision re-opened.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (/beanies-plan)

> Let's go with A and make a plan to implement this mockup. As always, strive for simplicity and elegance in both the plan and the implementation, and remember to always follow all DRY conventions. Review the mockup carefully and ensure you are faithfully representing and reproducing the carefully cultivated design, tone, and overall theme of the mockup, while at the same time strictly following the rules of the beanies theme and UI skill in terms of all relevant elements including colors, styles, layouts, font sizes, etc. If there is a discrepancy between the mockup and the beanies UI theme and CIG, the beanies UI theme / CIG always wins. Ask any clarifying questions as needed before preparing the plan. Once all requirements are clear, prepare the plan.

### Context from the prior turn

> (Going with option **A** — the lean callout: privacy explanation lives only behind the "What's this?" help link, not inline.) Earlier this session greg tightened the drawer callout copy: "Overlaps your Work calendar / Dismiss if you expected it. / [This is OK] [Reschedule…] · What's this?"

### Clarifying answers (AskUserQuestion, 2026-06-11)

> 1. Calendar name → **Use the account email**.
> 2. Dismiss scope → **Drawer-only acknowledge**.
> 3. Re-raise rule → **When you reschedule the activity** (fingerprint = activity occurrence time window).

</details>
