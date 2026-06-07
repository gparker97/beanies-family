# Plan: "beanies can do magic" — AI entry-point integration

> Date: 2026-06-07
> Related issues: None — direct implementation
> Mockup: `docs/mockups/ai-entry-points-final-2026-06-07.html`
> **No GitHub issue.** Approved for direct implementation; full prompt history in `## Prompt Log`.

## Context

The two AI extraction features (read an invitation photo → prefilled activity; read a travel
itinerary → prefilled trip) already work end-to-end but are flag-gated (`aiPhotoExtract`,
`aiTravelExtract`, both prod-off) and reached only through two bland, inconsistent doors: a bare
`📸` circle on the calendar command bar and a teal "Add from Document 📄" pill on the Travel page.
Neither expresses value, and they disagree visually.

This work re-skins and **relocates the entry points** into the creation paths families already use —
the FAB quick-add sheet, the new-activity drawer, and the new-trip wizard — under one playful,
on-brand "magic" language (Heritage Orange → Terracotta shimmer + one ✨, no purple, no robots). The
underlying extraction flows (`useDocumentToActivity`, `useDocumentToTravel`, consent, review) are
**untouched**; only the doors change. Direction was cultivated across three mockup rounds; the final
is `docs/mockups/ai-entry-points-final-2026-06-07.html`.

**CIG-wins resolutions** (where the mockup and the brand system disagree, the brand system wins):

- Mockup hint text ~10px → use `text-xs` (12px) minimum, standard Tailwind only (no `text-[Xrem]`).
- The bold "magic" gradient = the existing primary→terracotta gradient already used for save
  buttons/celebrations (`from-primary-500 to-terracotta-400`) — not a new gradient.
- Radii use standard squircle tokens (`rounded-3xl`/`rounded-2xl`), not arbitrary px.
- Dark-mode variants added throughout (the mockup is light-only).
- Copy uses commas, not em-dashes (matches greg's approved wording and the no-em-dash rule).

## User Story

As a family organiser, I want the "let beanies read my invite/booking" shortcut to greet me right
where I already create activities and trips — looking magical but on-brand — so I discover it
naturally and skip manual data entry, without the AI overpowering the rest of the app.

## Requirements

1. **One shared "magic" visual signal.** A single `.magic-shimmer` surface (orange→terracotta
   gradient + a slow white sheen sweep + one ✨), reduced-motion-safe, reused by every magic
   affordance. No purple, no robot/AI iconography.
2. **FAB quick-add sheet card.** Above the "Everyday beans" kraft card, a compact bold magic card:
   title `beanies can do magic ✨`, subline `snap an invite or travel booking, beanies will fill it
in`, and two single-line reader chips — `📸 Invite` and `✈️ Travel booking` — that never wrap.
   "Invite" launches the activity photo reader; "Travel booking" the travel document reader.
3. **New-activity drawer "Quick start" row.** Replace today's standalone 🏖️ "Planning a trip?" card
   with a unified two-up row under a `✨ Quick start` kicker: a bold "Perform magic" card (left) +
   the existing trip-wizard shortcut (right). "Perform magic" runs the photo reader and reopens the
   modal pre-filled.
4. **New-trip wizard banner.** At the top of step 1 (new trip only), a bold magic banner: `beanies
can do magic` / `snap your travel booking, I'll build the trip`, above an "or add it yourself"
   divider. Launches the travel document reader.
5. **Restyle the two original standalone buttons** into the unified magic language (a compact
   `✨ Perform magic` pill) — the `📸` circle on `CalendarCommandBar` and the teal pill on
   `TravelPlansPage` — preserving their existing triggers and permission/flag gating.
6. **Gating & graceful degradation.** Every magic affordance is gated by `canEditActivities` AND its
   feature flag (`aiPhotoExtract` for photo/Invite, `aiTravelExtract` for travel/booking). When a
   flag is off the affordance is hidden; the FAB card shows only enabled chips (one chip spans full
   width; card hidden if neither flag on); the activity Quick-start row degrades to just the trip
   card (exactly today's behavior) when the photo flag is off.
7. **No new extraction logic.** Every door converges on the two existing per-page handlers
   (`handleAddFromPhoto` / `handleAddFromDocument`) via the locally-simplest seam (direct call /
   1-hop emit / the `useMagicReader` dispatch singleton). No duplicate consent/picker/extract/review
   code, and no new `?action=` vocabulary.
8. **Full i18n + dark mode + rem-based sizing** (Large text-size mode must rescale cleanly).

## Approach

> **Verified-reuse corrections (Pass 2 + Pass 3), confirmed against the code:** `navigateToIntent`
> is **private** to `useQuickAdd.ts`; `useQuickAddIntent` already wraps handlers in `try/catch` +
> `console.error` + `showToast` (error handling is inherited); `showToast` (`@/composables/useToast`)
> is the canonical toast; there is no existing gradient-sheen utility (a new `.magic-shimmer` is
> justified); `VacationStep1.vue` has no edit signal (`isEditing` lives in `VacationWizard.vue`).
> **Pass 3 rejected the quick-add-action route entirely:** `QuickAddGroup` is an exhaustive rendering
> taxonomy consumed by three `Record<QuickAddGroup,…>` maps **and** a config test that hard-codes the
> four groups and asserts "union = full config (6+5+4+4=19)". Adding a phantom `'magic'` group would
> break those invariants and leave a member every maintainer trips over. The magic buttons are **not**
> quick-add tiles — they call an already-local handler on the page the user is already on. So
> `quickAddItems.ts`, its test, the sheet group-maps, the `useQuickAddIntent` action vocabulary, and
> `VacationWizard.vue` are all **left untouched**.

### A. The shared primitives (DRY core)

1. **`.magic-shimmer` global utility** in `src/style.css` — the **motion layer only**:
   `position: relative; overflow: hidden;` + an `::after` animated white sheen (new
   `@keyframes magic-sheen`). The **gradient is NOT baked into the class** — each consuming element
   keeps `bg-gradient-to-br from-primary-500 to-terracotta-400` as inline Tailwind utilities, so the
   look is co-located with the markup and reuses existing tokens. **Reduced-motion needs no new
   selector:** the existing `@media (prefers-reduced-motion: reduce)` block in `style.css` already
   carries a universal animation kill-switch (`*, *::before, *::after { animation-duration: …; … }`)
   that neutralises `magic-sheen` too. (Optionally add `.magic-shimmer::after` to the named
   `animation: none` list for explicit intent — functionally redundant; call it out in the PR.)

2. **`useMagicReader()` composable** (`src/composables/useMagicReader.ts`) — the single source of
   truth for both gating and the cross-boundary dispatch. Structure it as **(a) module-scope
   singleton state + dispatchers** (`pendingMagic`, `openPhotoReader`, `openDocumentReader`,
   `consumePendingMagic`) and **(b) the `useMagicReader()` composable** that calls `usePermissions()`
   and returns the gating computeds plus re-exports the dispatchers. Keeping the consume helper at
   module scope means the page side doesn't depend on a permissions instance.
   - **Gating computeds** (pure functions of permission + flag, replacing the duplicated page
     locals `canAddFromPhoto` / `canAddTravelFromDoc`):
     ```ts
     const { canEditActivities } = usePermissions();
     const canReadPhoto = computed(
       () => canEditActivities.value && isFlagEnabled('aiPhotoExtract')
     );
     const canReadDocument = computed(
       () => canEditActivities.value && isFlagEnabled('aiTravelExtract')
     );
     const canReadAny = computed(() => canReadPhoto.value || canReadDocument.value);
     ```
     One definition, four consumers (both pages + both new components) — no drift, unit-testable
     without mounting.
   - **A typed dispatch singleton** (mirrors the established `useQuickAdd` / `useConfirm` /
     `useToast` module-singleton idiom): a module-level `pendingMagic` ref
     (`'photo' | 'document' | null`) plus `openPhotoReader()` / `openDocumentReader()` which set the
     ref, call `closeQuickAdd()`, and `router.push('/activities' | '/travel')` using the **imported
     `router` singleton** (not `useRouter()`, since dispatchers run from click handlers outside
     setup — the same constraint `useQuickAdd` documents). This lets the **global** FAB card cross
     into a page handler **without** inventing a second `?action=` vocabulary.

3. **Page consumption of the dispatch singleton** — both pages call a single shared, idempotent
   `consumePendingMagic(surface, handler, gateOpen)` helper from **both** a non-immediate
   `watch(pendingMagic)` **and** `onMounted`. When `pendingMagic` matches the surface: if the gate is
   open call the handler, then **always clear the ref** (even when the gate is closed) so it can't
   get stuck or re-fire; whichever trigger fires first wins, the other no-ops.
   - **Race resolution** (`pendingMagic` is module-scoped → survives the route change):
     navigating from a _different_ page → the destination's `onMounted` reads the still-set ref;
     already _on_ the target page (push to the current path is a no-op, no remount) → the
     `watch` fires on the `null → value` transition. No `setTimeout`/`nextTick`.

4. **`handleAddFromPhoto` hardening** (FamilyPlannerPage): a **1-line** `showModal.value = false` at
   the top (confirmed: the handler is async and does not currently touch `showModal`) so the flow is
   robust when triggered while the new-activity modal is already open (close → reopen pre-filled;
   `onPhotoActivityReady` sets `showModal = true` last, re-firing `onNew` → `applyPrefill`). No new
   watcher. Harmless from the command bar (modal already closed).

### B. The surfaces

All four surfaces gate off the same `useMagicReader` computeds and converge on the same two existing
handlers. Each uses the **locally-simplest seam** — direct call / 1-hop emit on the same page, the
dispatch singleton only where a component boundary must be crossed.

- **`MagicReaderPill.vue`** (`src/components/ai/`) — compact restyled standalone pill (label + ✨,
  `.magic-shimmer` + inline gradient utilities, emits `@click`). Pure presentational; the parent's
  `v-if` owns visibility (as today). Two consumers: the `📸` circle in `CalendarCommandBar.vue`
  (the bar stays a dumb prop-driven child — keep its `canAddFromPhoto?: boolean` prop +
  `add-from-photo` emit + `ai.addFromPhoto` aria-label unchanged; `FamilyPlannerPage` feeds it
  `:can-add-from-photo="canReadPhoto"`) and the teal pill in `TravelPlansPage.vue`
  (`v-if="canReadDocument"`, `@click="handleAddFromDocument"`).
- **`MagicReaderCard.vue`** (`src/components/ai/`) — the FAB card, mounted in `QuickAddSheet.vue`
  between `<header>` and the Everyday `<section>`. The **only** surface outside a page, so it
  dispatches via the singleton: `canReadAny` gates the card's root `v-if` (both flags off → renders
  **nothing**, not an empty shell); `canReadPhoto` / `canReadDocument` gate each chip
  (`whitespace-nowrap min-w-0 flex-1`; one enabled chip spans full width); chips call
  `openPhotoReader()` / `openDocumentReader()`.
- **Activity Quick-start row** — in `ActivityModal.vue`, replace the `v-if="!isEditing"` 🏖️ vacation
  bar with a `✨ Quick start` kicker + two-up grid when `canReadPhoto` is true (read via
  `useMagicReader()` in the modal's setup — **gating only, no dispatch**) (left = "Perform magic"
  card `.magic-shimmer`; right = the existing trip card emitting `start-vacation-wizard` + `close`,
  unchanged). Photo flag off → only the trip card, full-width (today's exact behavior). The modal
  already emits `start-vacation-wizard` to the page (~line 700); the left card **emits a parallel
  `start-photo-reader`** the same way, and `FamilyPlannerPage` maps it to `handleAddFromPhoto`. This
  1-hop emit is the established pattern in this exact file — no singleton dependency in the modal.
- **Travel wizard banner** — in `VacationStep1.vue`, a `.magic-shimmer` banner above the first field,
  shown only for a **new** trip, gated by `canReadDocument` (via `useMagicReader()` read locally).
  Tapping it calls `useMagicReader().openDocumentReader()` **directly** (valid: the user is already
  on `/travel` and the handler needs no wizard state), then an "or add it yourself" divider. The
  new-trip signal lives in the parent: `VacationStep1` gains an `isNewTrip?: boolean` prop (default
  false) and `VacationWizard.vue` adds **one template attribute** — `:is-new-trip="!isEditing"` on
  its `<VacationStep1>` instance (`isEditing` already exists there). So `VacationWizard.vue` IS
  touched (one line) — still far simpler than the Pass-2 two-hop event relay (no new emit/handler),
  just not zero-touch.

### C. Copy / i18n

New keys under an `ai.magic.*` namespace in `src/services/translation/uiStrings.ts` (every key gets
`en` + `beanie`; run `npm run translate` to regenerate `zh`, then hand-verify):
`title` ("beanies can do magic"), `subtitle` (FAB subline), `invite` ("Invite"),
`travelBooking` ("Travel booking"), `perform` ("Perform magic"), `performHint`
("snap an invite, beanies fills it in"), `quickStart` ("Quick start"), `travelSubtitle`
("snap your travel booking, I'll build the trip"), `orAddYourself` ("or add it yourself").
`beanie` values all lowercase per the casing standard. Reuse the existing `vacation.planningATrip` /
`vacation.planningSubtitle` for the trip half (no churn). Keep existing aria-label keys
(`ai.addFromPhoto`) on the restyled pill for accessibility.

## Important Notes & Caveats

- **Do not duplicate the extraction flow.** Every door converges on the two existing handlers
  (`handleAddFromPhoto` / `handleAddFromDocument`). The only new logic is gating + presentation +
  the tiny `pendingMagic` dispatch.
- **The `pendingMagic` ref must always be cleared after a page reads it** — even when the gate is
  closed — so it can never get stuck or re-fire on the next navigation. (It's ephemeral by design;
  lost on reload, which is correct for a transient button action.)
- **Close→reopen is intentional** (greg's choice). The new-activity modal opens with Quick-start at
  the very top, so nothing typed is lost. If a user somehow typed a title then scrolled up to tap
  magic, the prefill replaces it — acceptable.
- **Gating lives in one place** (`useMagicReader`'s `canReadPhoto` / `canReadDocument`). The pages'
  old `canAddFromPhoto` / `canAddTravelFromDoc` locals are replaced — each has exactly **one**
  consumer (`canAddFromPhoto` → the `:can-add-from-photo` prop at `FamilyPlannerPage` ~line 545;
  `canAddTravelFromDoc` → the pill `v-if` at `TravelPlansPage` ~line 777), so just rename the
  binding to `canReadPhoto` / `canReadDocument` (clearer than aliasing). Do not re-derive
  `canEditActivities && isFlagEnabled(...)` anywhere else.
- **Two orange surfaces stack in the FAB** (bold magic card over the light kraft card) — this is the
  approved look; keep the kraft card's existing tint so the bold card reads as distinct.
- **The standalone pills keep their existing triggers** (command bar emits `add-from-photo`, travel
  page calls `handleAddFromDocument`) — only the visual is unified. Don't re-route them.
- **`quickAddItems.ts` (and its test) and the `useQuickAddIntent` action vocabulary are explicitly
  NOT touched** — Pass 3 removed every reason to. `VacationWizard.vue` gets exactly **one** template
  attribute (`:is-new-trip`), nothing more. If implementation finds itself editing more than that,
  stop and reconsider.

## Assumptions

> Review before implementation — valid at planning time.

1. The two feature flags remain the gate; both stay prod-off until a separate flag-flip. This work
   ships invisibly to prod users (consistent with the established #133/#30 posture).
2. `FamilyPlannerPage` is at `/activities` and `TravelPlansPage` at `/travel` (confirmed via the
   existing `QUICK_ADD_ITEMS` routes). `ActivityModal` is hosted on `FamilyPlannerPage`.
3. `VacationWizard.vue` exposes `isEditing` (`computed(() => !!props.vacation)`) and renders
   `<VacationStep1>`, so a one-line `:is-new-trip="!isEditing"` prop reaches the step (confirmed).
4. No Help Center article is owed: this changes discoverability, not capability, and the features
   stay flag-off in prod (no live user-facing gap).

## Files Affected

**New**

- `src/composables/useMagicReader.ts` (gating computeds + module-scope `pendingMagic` singleton +
  `openPhotoReader` / `openDocumentReader` + idempotent `consumePendingMagic` helper)
- `src/components/ai/MagicReaderCard.vue`
- `src/components/ai/MagicReaderPill.vue`
- Tests: `src/composables/__tests__/useMagicReader.test.ts`,
  `src/components/ai/__tests__/MagicReaderCard.test.ts` (+ small additions to existing page tests for
  the `consumePendingMagic` wiring / `start-photo-reader`)

**Modified**

- `src/style.css` (add `.magic-shimmer` + `@keyframes magic-sheen`; motion-only — gradient stays
  inline; reduced-motion already covered by the existing universal kill-switch)
- `src/components/common/QuickAddSheet.vue` (mount `MagicReaderCard` between header and Everyday)
- `src/components/planner/ActivityModal.vue` (Quick-start row + `start-photo-reader` emit +
  `useMagicReader` gating)
- `src/pages/FamilyPlannerPage.vue` (consume `useMagicReader`; `handleAddFromPhoto` close-first;
  map `start-photo-reader` → `handleAddFromPhoto`; `consumePendingMagic('photo', …)` from watch +
  onMounted; feed `:can-add-from-photo="canReadPhoto"`)
- `src/pages/TravelPlansPage.vue` (consume `useMagicReader`; `MagicReaderPill`;
  `consumePendingMagic('document', …)`)
- `src/components/planner/CalendarCommandBar.vue` (restyle `📸` → `MagicReaderPill`; prop/emit/aria
  unchanged)
- `src/components/vacation/VacationStep1.vue` (travel banner + `isNewTrip?: boolean` prop +
  `openDocumentReader()`)
- `src/components/vacation/VacationWizard.vue` (**one line**: `:is-new-trip="!isEditing"` on
  `<VacationStep1>`)
- `src/services/translation/uiStrings.ts` (`ai.magic.*`; + `zh` via `npm run translate`)

> **Explicitly NOT modified:** `src/constants/quickAddItems.ts` + its test, and the
> `useQuickAddIntent` action vocabulary.

## Acceptance Criteria

- [ ] One `.magic-shimmer` utility drives every magic surface; reduced-motion disables the sheen.
- [ ] FAB sheet shows the bold magic card above the kraft jar; chips are single-line and never wrap
      (verified at Normal and Large text-size); each routes to the correct reader.
- [ ] New-activity drawer shows the unified Quick-start row (magic + trip) when `aiPhotoExtract` on;
      degrades to the trip card only when off; "Perform magic" closes & reopens the modal pre-filled.
- [ ] New-trip wizard step 1 shows the magic banner (new trip only, `aiTravelExtract` on) above an
      "or add it yourself" divider; launches the travel reader.
- [ ] The `📸` circle and the teal pill are replaced by the unified `✨ Perform magic` pill, keeping
      their triggers, permissions, and flags.
- [ ] All magic affordances respect `canEditActivities` + the relevant flag; the FAB card renders
      nothing when both flags are off; `consumePendingMagic` re-checks the gate before acting and
      always clears the ref.
- [ ] No duplication of the consent/picker/extract/review flow or the gating predicate; every door
      converges on the two existing handlers and `useMagicReader`'s computeds.
- [ ] Light + dark mode both correct; all text ≥ `text-xs`, standard Tailwind classes only.
- [ ] New i18n keys present in `en` + `beanie`; `zh` regenerated and hand-checked; `npm run validate`
      green.

## Testing Plan

1. **Unit** — `useMagicReader`: `canReadPhoto`/`canReadDocument`/`canReadAny` reflect permission ×
   flag; `openPhotoReader`/`openDocumentReader` set `pendingMagic` to the right value, call
   `closeQuickAdd`, and `router.push` the right route. `MagicReaderCard` renders the correct chip set
   per flag combination (both / photo-only / travel-only / none) and calls the right opener. A page
   reading `pendingMagic` calls its handler then clears the ref (and clears without acting when its
   gate is closed). `handleAddFromPhoto` sets `showModal=false` before opening the picker.
2. **Manual (flags on via localStorage override + reload)** — FAB card → Invite → consent → camera →
   prefilled activity; FAB card → Travel booking → review modal → trip. New-activity → Quick start →
   Perform magic → modal closes & reopens filled. New-trip wizard → banner → review modal. Restyled
   pills on the command bar + travel page still work. Toggle each flag off → affordance hidden,
   activity row degrades to trip-only. Dark mode + Large text-size sweep.
3. `npm run validate` (type-check, lint, format, unit, build) green.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — shared `.magic-shimmer` + `useMagicReader` +
  two intent actions reusing `useQuickAddIntent`; four surfaces + restyled pills; gating, i18n, dark
  mode, CIG-wins resolutions, close→reopen for in-modal magic.
- **Pass 2 (DRY + error handling)**: Removed the `useMagicReader` navigation layer (verified
  `navigateToIntent` is private) — magic actions now ride the existing `triggerQuickAddAction` seam
  via a non-rendered `'magic'` group; reused `useQuickAddIntent`'s built-in try/catch + `showToast`
  (no bespoke error path); in-page surfaces emit to host pages instead of router round-trips; fixed
  `VacationStep1` gating to a parent-passed `isNewTrip` prop.
- **Pass 3 (Sustainability)**: Removed the phantom `'magic'` `QuickAddGroup` (it broke 3 config-test
  invariants and polluted an exhaustive taxonomy) — `quickAddItems.ts`/its test/the intent vocabulary
  are now untouched; extracted one `useMagicReader` composable as the single source of gating +
  dispatch (a typed `pendingMagic` singleton) replacing triply-duplicated predicates; collapsed the
  2-hop wizard relay so `VacationWizard.vue` is touched only by one attribute and `VacationStep1`
  calls the reader directly.
- **Pass 4 (Fresh-eyes sweep)**: Pressure-tested 5 bug/side-effect risks — 4 held up (race resolved
  via an idempotent `consumePendingMagic` from both `watch` + `onMounted`; singleton confirmed over
  provide/inject + intent-query; `closeQuickAdd` is a safe no-op when the sheet's closed; the two
  page locals have exactly one consumer each, so renaming is clean; `useMagicReader` in the FAB sheet
  is negligible cost and renders nothing when both flags are off). Caught one self-contradiction:
  `VacationWizard.vue` **must** take a one-line `:is-new-trip` attribute (corrected from "untouched").
  Also clarified `.magic-shimmer` is motion-only (gradient stays inline; reduced-motion already
  covered by the existing universal kill-switch) and the `router` singleton (not `useRouter()`) for
  dispatchers.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (/frontend-design)

Mockup exploration request: make the AI camera/document entry points fun, magical, prominent but
not overpowering; integrate into add button / FAB / navbar / create modals; "AI is not beanies — AI
is something beanies does."

### Follow-up 1 (direction)

Copy more fun/mysterious ("perform magic"); FAB = woven-in footprint + front-door bold orange
shimmer + chips "Invite"/"Travel booking" (no "a/an"); activity modal liked woven-in form but
worried about crowding vs the existing trip button; liked the trip banner + copy "snap your travel
booking, I'll build the trip".

### Follow-up 2 (final mockup approval)

Go v2 FAB (ensure chip titles don't wrap), Solution A for the activity modal, the trip proposal +
its copy. Build a final mockup within the beanies theme/skeleton.

### Follow-up 3 (this plan)

Make a plan to implement the final mockup. Simplicity, elegance, DRY. Faithfully reproduce the
mockup's design/tone while strictly following the beanies theme/UI skill (colors, styles, layouts,
font sizes); CIG wins on any discrepancy. Ask clarifying questions first.

### Clarifying answers

- Original standalone buttons → **restyle to match** the magic language.
- In-modal "Perform magic" → **close & reopen filled** (reuse existing flow, no new watcher).

</details>
