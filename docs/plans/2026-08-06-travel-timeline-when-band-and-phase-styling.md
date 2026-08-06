# Plan: Travel timeline — "when"-first hero band, ongoing-stay fix, and softer past styling

> Date: 2026-08-06
> Related issues: None — direct implementation (no GitHub issue, no Notion row; fresh idea)
> Plan file: `docs/plans/2026-08-06-travel-timeline-when-band-and-phase-styling.md`
> Mockup: `docs/mockups/travel-segment-layout-and-past-styling-2026-08-06.html`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is embedded in the `## Prompt Log` section.

## User Story

As a family member viewing a trip, I want each plan to lead with its date and time and to stay readable whether it's upcoming, happening now, or done, so I can find what I need at a glance while travelling.

## Context

The Travel Plans timeline (`TravelPlansPage.vue`) renders each trip as a vertical rail of day-groups, each holding one or more expandable segment cards (`VacationSegmentCard.vue`) whose expanded body is a list of label/value detail rows built in `useVacationTimeline.ts`. Three problems, confirmed in the code:

1. **Key info is buried.** `travelDetailRows()` (and the accommodation/transportation row builders) push date/time rows **last**. A flight reads airline → flight # → from → to → terminal → **date → departs → arrives**. The thing you scan for first is at the bottom.
2. **Ongoing multi-day segments look finished (bug).** The timeline groups every item under a single day = `extractDatePart(checkInDate | embarkationDate | pickupDate | departureDate)` (its **start**), and `TravelPlansPage` mutes an entire day-group when `classifyTripDay(groupDate) === 'past'` via `opacity-55 saturate-50`. So a hotel that checked in yesterday and checks out tomorrow — where you are sleeping tonight — is greyed as past the moment its check-in passes.
3. **Genuinely-past days are unreadable.** `opacity-55 saturate-50` reads as _disabled_, but you routinely open past segments mid-trip for terminals, confirmation numbers and addresses.

An approved mockup (`docs/mockups/travel-segment-layout-and-past-styling-2026-08-06.html`) resolves all three: **Option A** (a "when" hero band at the top of the expanded card), the **ongoing-stay fix** (classify a span by its end date + a "staying now" marker), and **Option B1** for past styling (grey ✓ rail dot + "done" tag + a barely-there card tint, text at full contrast). This plan implements that mockup faithfully, sourcing every concrete style token from the beanies theme/CIG and staying inside the existing ocean-teal travel identity.

## Requirements

1. **"When" hero band.** In the **expanded** segment card body, before the detail rows, render a prominent band showing the segment's date/time:
   - Two cells (`start → arrow → end`) for two-point / spanning segments: flight/train/ferry = departs → arrives; cruise = embark → disembark; accommodation = check-in → check-out; rental-car transportation = pick-up → return.
   - A single "starts" cell for one-point segments: `car`, `activity`, non-rental transport (shuttle/taxi/bus), and any flight/train/ferry with no arrival time.
   - Each cell shows the time prominently (`formatTime12`) with a short date beneath (`formatDateShort`); when a segment has a date but no time, the cell shows the date only. The **arrival cell's date prefers `arrivalDate` when present** (falling back to `departureDate`), and shows `arrivesNextDay` as a `+1`/next-day marker. (The sub-line is date-only — no location fragment; `route`/`terminal` remain rows. Deliberate faithful-simplification vs the mockup's `· SIN T1`.)
2. **Remove promoted rows + reorder the rest.** Each per-kind band builder returns the exact set of `field` names it consumed; the row builder then drops **precisely those** fields (one source of truth — no hard-coded second "drop list" that can drift or orphan data). Remaining rows keep their current per-field affordances (inline edit, map link, copyable ref, external link) and are reordered into a natural **where → which → reference** order (date/time having moved up into the band). Flight example: from, to → airline, flight # → terminal → booking ref → link → notes. **Non-rental transport that carries a `returnDate` keeps its `returnDate`/`returnTime` rows** (it gets only a single "pick-up" band cell) — nothing is promoted that the band doesn't display, so no date is ever orphaned or duplicated.
3. **Ongoing-stay classification (bug fix).** A segment's timeline **phase** is `past` / `now` / `future`, computed from its **span** (start→end) rather than its start alone:
   - Spanning kinds use their end date: accommodation `checkOutDate`, cruise `disembarkationDate`, rental-car `returnDate`.
   - `past` iff the span's end date `< today`; `future` iff its start `> today`; otherwise `now`.
   - A spanning segment whose phase is `now` (i.e. today is within the stay) renders at **full contrast** with a "staying now" marker: the segment's rail connector dot turns Heritage Orange (reusing today's existing orange-connector treatment) and a small "staying now · until <end date>" chip sits above the card.
4. **Softer past styling (Option B1).** Replace the `opacity-55 saturate-50` whole-day fade with:
   - Day header (past day): the 32px rail circle becomes a **grey ✓** dot (grey `#9aa9b5`, instead of teal 📅), the date label uses muted colour, and a small **"done"** pill sits beside the date — the pill reuses the existing booked/success token (`--tint-success-10` + `text-green-700`, green), no new colour.
   - Past segment card: a barely-there tint background; **text stays at full contrast**.
   - Past gap entries: the same softened grey treatment (they currently share `opacity-55 saturate-50`).
5. **i18n.** All new visible strings (`done`, `staying now`, `until {date}`, and any new band captions) are added to `uiStrings.ts` with both `en` (Title/Sentence case) and `beanie` (lowercase) values and rendered via `t()` / `fillTemplate()`. No bare strings; beanie-mode casing correct.
6. **Accessibility / motion.** The "staying now" marker's live-dot pulse follows the app's existing opt-in convention — gated under `@media (prefers-reduced-motion: no-preference)` (matching `.today-date-circle` at `TravelPlansPage.vue`), so reduced-motion users get a static dot. Text contrast in every phase meets the readable bar (no sub-contrast fades).

## Important Notes & Caveats

- **The band is display-only; date/time are edited via the segment's ✏️ Edit button.** The inline date/time pickers on the timeline (`BeanieDatePicker` / `BeanieTimeInput` rows driven by `saveInlineField`) are exactly the rows being promoted into the band, and the mockup band is static. So promoting them removes inline date/time editing **from the timeline** — those fields are still fully editable through the existing edit modal (unchanged). **All other** inline-editable rows (flight #, cabin #, car label, description, duration, contact phone, notes) stay inline-editable. This is a deliberate, called-out behaviour delta — confirm at plan review.
- **Rows are reordered, not merged.** The mockup illustratively compacts "from + to" into one _Route_ row and "airline + flight #" into one _Flight_ row. This plan keeps rows **separate** (reordered only), because merging airline+flight# would remove flight #'s inline edit and merging collapses per-field i18n labels. The band is the faithful centrepiece the design is remembered by; the row list stays functional. If greg prefers the merged compaction look, it's a small follow-on toggle — surfaced as a decision at review.
- **Day header vs. card phase can legitimately differ.** A multi-day stay renders once, under its **check-in** day-group. If check-in is in the past, that day's header is correctly "done", while the stay card within it is "staying now". This is truthful (the calendar day is over; the booking is ongoing) and the chip's "until <end>" text makes it unambiguous. Per-item phase drives the **card**; `classifyTripDay(groupDate)` drives the **day header/dot**.
- **Do not touch:** the edit modals' field order (display-only change); `syncStore` / the save-status indicator (owned by the parallel #60 session); net-worth / ownership / traveller semantics; the collapsed key-value line (`buildTravelKeyValue`) beyond what removing date/time from it may imply — see Assumptions. No new palette; ocean-teal travel identity only.
- **Undated items** (`sortDate === '9999-12-31'`, the "still deciding" section) get **no band and no phase** — they render exactly as today.
- **Single-day span** (check-in == check-out, or a one-night stay) must classify sanely — `now` on that day, `past` after. The `<` / `>` boundary comparisons (not `<=`) already give this.
- **Reactive day-roll.** `todayISO` is reactive; the now→past transition at a span's end must follow it without a flicker or a stuck state. Phase is a `computed` off `todayISO`, so it re-derives on the day-roll for free.

## Assumptions

> **Review these before implementation.**

1. The collapsed **key-value** summary line (`buildTravelKeyValue` and the accommodation/transportation `kvParts`) is **kept as-is** — it already leads with a compact date/time and is the _collapsed_ affordance, a different surface from the expanded band. Only the **expanded** detail rows are reordered/promoted. (If greg wants the collapsed line changed too, that's a separate tweak.)
2. Spanning kinds (for phase/band **two-cell**) are exactly: accommodation (`checkInDate→checkOutDate`), cruise travel-segment (`embarkationDate→disembarkationDate`), and rental-car transportation (`type === 'rental_car'`, `pickupDate→returnDate`). All other kinds are single-point for phase purposes. **Flights are a single-day two-_time_ band** (departs→arrives): they expose `departureDate` + `departureTime` and `arrivalTime` (+`arrivesNextDay`), **and** an optional `arrivalDate` (`models.ts:995`, read by `computeVacationDates`/`buildFlightItems`) — so the arrival cell's date must prefer `arrivalDate` when set (an overnight flight's arrival day is otherwise wrong). Non-rental transport may carry a `returnDate` (`prefillTransportationDates` fills it for shuttle/taxi too) but is **not** treated as a two-cell span — single "pick-up" cell, `returnDate`/`returnTime` stay as rows.
3. "Staying now" applies only to **spanning** segments whose phase is `now`. Single-point items that happen to be "today" are already covered by the day-level `TodayTimelineMarker` and orange connector dots — they do **not** get a "staying now" chip (that would be noise).
4. `segmentSpan(item)` is a **new, band/phase-scoped** accessor for "what are this segment's start/end dates" (start-only when single-point). It is **not** merged with the existing `dateRange()`/`DatedItem` hint builders (`buildAccommodationItems`/`buildCruiseItems`): `dateRange()` returns `null` unless _both_ ends exist and those builders also carry `id`/`title` for overlap detection — different semantics, and coupling them would add filtering complexity for a marginal win. Leave the hint builders untouched.

## Approach

Implements the approved mockup `docs/mockups/travel-segment-layout-and-past-styling-2026-08-06.html`. Design intent (band on top; when→where→which→ref order; grey-✓ "done" past; orange "staying now") is reproduced faithfully; every concrete token (Heritage Orange `#F15D22` for the now-marker, ocean-teal `#00B4D8`/`#0077B6` for the band, Outfit weights, six-level type scale, squircle radii, soft shadows, `--tint-slate-*` for the past tint) comes from the beanies theme/CIG.

### 1 — One per-kind timing descriptor + a pure phase classifier (`src/utils/vacation.ts`)

- **`SEGMENT_TIMING` descriptor** — a single small config object keyed by the segment's discriminator, declaring per kind. It separates two concepts that are NOT the same thing:
  - **`start`** date+time fields, and optional **`second`**-cell date+time fields + caption. A "second cell" is a band-display concept: flight/train/ferry have one (`arrivalDate??departureDate` + `arrivalTime`, caption `arrives`); the three true spans have one (accommodation check-out, cruise disembark, rental return). Single-point kinds (car, activity, non-rental transport) have no `second`.
  - **`spanning: boolean`** — true **only** for accommodation, cruise, and `rental_car`. This is the _phase_ concept: a flight has a second band cell but is NOT spanning (its arrival is the same day / next-morning, never a multi-day stay), so it must never be faded or chip'd as an ongoing span.
  - Transportation discriminates `rental_car` vs the rest; the non-rental **start uses a fallback chain `pickupDate → departureDate` / `pickupTime → departureTime`** so a **bus** (which carries `departureDate`, not `pickupDate`) gets a non-empty cell — matching today's `trans.pickupDate || trans.departureDate` group-date logic (line 442). The band reports the field it **actually** consumed, so the right row is dropped and any un-consumed `returnDate` survives as a row.
  - Mirrors the existing branch-free `SIDE_FIELDS: Record<SupportedTravelType, …>` pattern (`vacation.ts` ~line 1139). Single source of per-kind date knowledge for `segmentSpan`, the band builder, and the drop-set — a new kind is **one edit** here. Declarative and flat (no logic in the table).
- **`segmentSpan(item)` → `{ start?: string; end?: string }`** (dates only, via `extractDatePart`) — returns `end` **only when the descriptor marks the kind `spanning`** (so flights stay start-only for phase); otherwise start-only. **Band/phase-scoped only**; deliberately NOT merged with the `dateRange()`/`DatedItem` hint builders (see Assumption 4).
- **`classifySegmentPhase(span, today) → 'past' | 'now' | 'future'`** — pure, `today`-injected (no clock read), date-only lexicographic compare consistent with `classifyTripDay`/`tripPhase`:
  ```
  end = span.end ?? span.start
  if (end && end < today) return 'past'
  if (span.start && span.start > today) return 'future'
  return 'now'   // today within [start,end], or bounds indeterminate → treat as current, never faded
  ```
  Guards missing/blank dates by falling through to `now` (a segment is never _hidden_ by a bad date). Unit-tested exhaustively. **Vocabulary note:** this `'past' | 'now' | 'future'` is a **third** phase word alongside `classifyTripDay` (`past|today|future`, a single calendar day vs today) and `tripPhase` (`upcoming|today|ongoing|past`, a whole trip). `'now'` here means specifically **this segment's span contains today** (distinct from `classifyTripDay`'s `'today'` = day == today) — documented on the type so a reader isn't left guessing why a third dialect exists.

### 2 — Band model + phase, derived in the composable (`src/composables/useVacationTimeline.ts`)

- Extend `TimelineItem` with **one optional grouped field** so the undated-has-no-timing invariant is structural (can't be half-populated), not a convention three call sites must remember:
  - `timing?: { band?: WhenBand; phase: 'past' | 'now' | 'future'; isOngoingSpan: boolean }`.
  - `WhenBand = { start: WhenCell; end?: WhenCell }`, `WhenCell = { captionKey: UIStringKey; time?: string; date?: string; nextDay?: boolean }`. Times/dates are stored raw; formatting (`formatTime12` / `formatDateShort`) happens in the presentational `SegmentWhenBand` — **unlike** `enrichRows` (which formats in the composable), the band keeps the composable data-only.
  - `isOngoingSpan` is **derived from the classifier's own output**, not a second date comparison: `phase === 'now' && !!span.end && span.end !== span.start`. This has exactly one boundary definition (in `classifySegmentPhase`), so the chip/dot can never disagree with the tint.
  - **Undated guard:** items with `sortDate === '9999-12-31'` omit `timing` entirely — no band, no phase, never tinted "past" or marked "staying now".
- **Reactive `today`:** pass `useToday().today` (the readonly `Ref`) into `useVacationTimeline` and read `today.value` **inside** the `timelineItems` computed so `timing` re-derives on the midnight day-roll — do not snapshot at call time. `TravelPlansPage` already holds `const { today: todayISO } = useToday()` (line 426); pass that ref in.
- **Extract per-kind detail-row builders first.** Accommodation and transportation rows are currently built **inline** inside the ~200-line `timelineItems` computed (lines ~386-415, ~443-502). Extract `accommodationDetailRows(acc, t)` and `transportationDetailRows(trans, t)` as pure functions parallel to the existing `travelDetailRows` — so all three kinds get the band/drop logic uniformly and each is testable in isolation, and the computed stays thin.
- **Band builder** (reads `SEGMENT_TIMING` for the kind): returns the `WhenBand` **and the set of `field` names it consumed**. Caption keys come from the descriptor, reusing existing `segmentRow.*` (`departs`/`arrives`/`checkIn`/`checkOut`/`embark`/`disembark`/`departTime`); the only new caption keys are `segmentRow.starts` (single cell) and concise `segmentRow.pickup`/`segmentRow.return` (rental cells). **Degraded two-cell → one cell:** when a kind that _has_ a `second` cell is missing its second-cell value (e.g. a flight with no arrival time), the band emits a single cell using the `segmentRow.starts` caption rather than a lone `departs` cell — so the "starts" caption is actually used for a lone-departure flight.
- **Row drop** is a single explicit filter shared by all three builders: `rows.filter(r => !r.field || !consumed.has(r.field))`, where `consumed` is the band's reported field set (both band and rows reference the **same** field-name strings via the descriptor — no stringly-typed drift). A `returnDate`/`returnTime` the band did **not** consume (non-rental transport) is retained automatically. Remaining rows are emitted in where→which→ref order.

### 3 — Presentational band component (`src/components/travel/SegmentWhenBand.vue`, new)

- Props: `{ band: WhenBand }`. Renders one cell, or two cells with a `→` between. Each cell: uppercase Outfit caption (`t(captionKey)`), a large Outfit time (or date when no time), and a muted date sub-line; `arrivesNextDay` shown as a `+1`/next-day hint on the arrival cell. Ocean-teal band per the mockup, all tokens from CIG. Text rem-based, six-level scale. Purely presentational — no store access.
- Rendered by `TravelPlansPage.vue` at the **top** of the `VacationSegmentCard` default slot (before the `divide-y` rows block), guarded by `v-if="item.timing?.band"`.

### 4 — "Staying now" marker (rail dot + chip)

- **Connector dot:** in `TravelPlansPage.vue`, the small per-segment connector dot (lines 1347-1354, with its matching connector line 1356-1362) goes `bg-[rgba(241,93,34,0.45)]` when `classifyTripDay(entry.data.date)==='today'`. Extend that exact condition to `… === 'today' || item.timing?.isOngoingSpan`, reusing the existing orange class (no new token). The **32px day circle** (lines 1304-1313, driven by `classifyTripDay` and correctly reading "done" on a past check-in day) is **untouched** by the ongoing-span logic.
- **Chip:** a small **new** `StayingNowChip.vue` (props: end date) showing "staying now · until <end>", styled from CIG tokens. `TodayTimelineMarker` is a full-width `justify-between` "Day N of N" day banner — structurally different enough that a shared-shell refactor is churn for near-zero reuse; the two share only the live-dot pulse CSS. The pulse follows the app's existing opt-in convention (`@media (prefers-reduced-motion: no-preference)`), matching `.today-date-circle`.

### 5 — Past styling B1 (`TravelPlansPage.vue` + `VacationSegmentCard.vue`)

- **Remove** `opacity-55 saturate-50` from the date-group wrapper, the gap header, and the gap card.
- **Day header (past):** swap the teal 📅 circle for a **grey ✓** circle, mute the date label colour, and add a small **"done"** pill (`t('travel.timeline.done')`) beside the date. Driven by `classifyTripDay(groupDate)==='past'` (unchanged day-level signal).
- **Card tint (past):** add an optional `past?: boolean` prop to `VacationSegmentCard`. The card's root background is currently a two-way inline ternary (`hint || status==='pending'` vs default, lines 68-72); convert it to a **`computed`** with three branches and explicit precedence — pending/hint (amber) wins, then `past` (barely-there `--tint-slate-*` wash, text untouched), then default. `TravelPlansPage` passes `:past="item.timing?.phase === 'past'"`. A spanning `now` card sitting inside a past day-group has `phase==='now'` → **no** tint → stays live.
- **Gaps (past):** replace the removed opacity with the same muted-grey dot/label treatment as past day headers (no content fade).

### Files Affected

- `src/utils/vacation.ts` — add the `SEGMENT_TIMING` descriptor, `segmentSpan()`, and pure `classifySegmentPhase()`. (Hint builders `buildAccommodationItems`/`buildCruiseItems` are left **untouched** — see Assumption 4.)
- `src/composables/useVacationTimeline.ts` — `WhenBand`/`WhenCell` types; grouped `timing?` on `TimelineItem`; extract `accommodationDetailRows`/`transportationDetailRows` (parallel to `travelDetailRows`); band builder + shared row-drop filter; reorder remaining rows; inject reactive `today`.
- `src/components/travel/SegmentWhenBand.vue` — **new** presentational band.
- `src/components/travel/StayingNowChip.vue` — **new** minimal chip (applies the shared pulse class; no shared-shell refactor with `TodayTimelineMarker`).
- `src/style.css` (or the travel-scoped stylesheet) — lift the live-dot pulse keyframes + its `@media (prefers-reduced-motion: no-preference)` guard into **one shared class** applied by both `StayingNowChip` and `TodayTimelineMarker` (so the motion + its a11y gate live in one place).
- `src/pages/TravelPlansPage.vue` — render band in the card slot; remove `opacity-55 saturate-50` (3 sites: lines 1235/1262/1295); grey-✓ + "done" past day header; orange connector dot + chip for `timing.isOngoingSpan`; soften gap entries; pass `:past` to the card; thread `today` into the composable.
- `src/components/vacation/VacationSegmentCard.vue` — optional `past?: boolean` prop → 3-branch `computed` background (pending/hint > past > default; text unchanged).
- `src/services/translation/uiStrings.ts` — new keys only: `travel.timeline.done`, `travel.timeline.stayingNow`, `travel.timeline.until` (`until {date}`), `segmentRow.starts`, and concise `segmentRow.pickup` / `segmentRow.return` for the rental band cells — each with `en` + `beanie`. Band captions otherwise **reuse** existing `segmentRow.*` keys (departs/arrives/checkIn/checkOut/embark/disembark/departTime).
- `docs/mockups/travel-segment-layout-and-past-styling-2026-08-06.html` — the approved mockup (already committed with this change).
- Tests: `src/utils/__tests__/vacation.*.test.ts` (phase classifier + span), `src/composables/__tests__/useVacationTimeline.*.test.ts` (band shape + row promotion/reorder + phase), and a component test for `SegmentWhenBand` if warranted.

## Observability Coverage

This is a **pure client-side display change** — no async, no network, no persistence, no user action that can "fail" in a way telemetry would catch. The diagnostic posture is therefore _preserve existing signal + never crash the render_:

- **No new telemetry events and no new `context` keys** — nothing to add to `ALLOWED_CONTEXT_KEYS`; no store data-collection declaration change.
- **Failure mode = a malformed/blank date.** Handled structurally, not by logging: `classifySegmentPhase` and `segmentSpan` are total functions that fall through to a safe result (`now` / start-only) for missing or non-parseable dates, so a bad date degrades to "shown, un-faded" rather than throwing and blanking the timeline. This is the no-silent-failure posture appropriate to a pure render: the safe fallback is visible (the segment still renders), not swallowed.
- **Helpers stay pure.** `vacation.ts` is a documented pure module (no reactivity, no store access, no side effects) that is widely imported and unit-tested in isolation; `segmentSpan`/`classifySegmentPhase` **must not** call `logEvent` or any telemetry (that would break the module contract). Bad dates are handled by the safe total-function fallback, which is the correct no-silent-failure posture here — the segment still renders (visible), nothing is swallowed. No breadcrumb is added; if data-entry anomalies ever warrant one, it belongs in the composable/component layer, not the pure util.
- **Success-path signal:** none required — there is no rate to measure for a synchronous layout computation, and adding a per-render counter would breach the `TELEMETRY_FLOOR_MS` intent (sub-floor, high-frequency). Existing travel-surface telemetry is untouched.

## Acceptance Criteria

- [ ] Expanding any segment kind shows its date/time in a top **band** before the other fields; the promoted date/time rows no longer appear in the row list (no duplication).
- [ ] Remaining rows appear in where → which → reference order; every surviving row keeps its current affordance (inline edit for flight #/notes/etc., map link, copyable ref, external link).
- [ ] **No date is ever orphaned or duplicated:** the rows dropped equal exactly the `field`s the band consumed. A non-rental transport (taxi/shuttle) carrying a `returnDate` still shows that return date somewhere (as a row) — never nowhere, never twice. An overnight flight with `arrivalDate` shows the correct arrival day in the band.
- [ ] A hotel with check-in in the past and check-out in the future renders at **full contrast** with a Heritage-Orange connector dot + a "staying now · until <date>" chip — not the past treatment. It flips to past only after the check-out date.
- [ ] The same holds for an ongoing cruise (`disembarkationDate`) and an ongoing rental car (`returnDate`).
- [ ] A fully-past day renders **legible** (full-contrast text) with a grey ✓ rail dot, a "done" pill on the date, and only a barely-there card tint — no `opacity-55 saturate-50`. Past gap entries are softened the same way.
- [ ] Undated ("still deciding") segments are unchanged (no band, no phase).
- [ ] Edge cases hold: date-only cell shows date only; a flight with no arrival time is a single cell; `arrivesNextDay` reads correctly; a one-night stay classifies sanely; a simulated day-roll moves an ending span from "now" to "past" without a stuck state.
- [ ] "Staying now" pulse is suppressed under `prefers-reduced-motion`.
- [ ] All new strings are in `uiStrings.ts` with `en` + `beanie`; no bare strings (ESLint clean); beanie-mode casing correct; text is rem-based / six-level scale.
- [ ] Diagnostic posture in **Observability Coverage** holds: classifier/span helpers never throw on bad dates; no new context key shipped.
- [ ] Gates green: `npm run type-check`, `npm run lint`, `npm run build`, and the full Vitest suite (incl. new unit tests).

## Testing Plan

1. **Unit — `classifySegmentPhase` / `segmentSpan`:** past/now/future for single-point and spanning inputs; boundary days (today == start, today == end); missing start, missing end, both missing, blank strings; `end < start` returns a safe phase. Injected `today`; assert day-roll by passing successive `today` values across a span's end.
2. **Unit — `useVacationTimeline` + the extracted `travelDetailRows`/`accommodationDetailRows`/`transportationDetailRows`:** for each kind, assert `timing.band` shape (single vs two cell, correct caption keys, `nextDay` flag), that band-consumed date/time rows are **absent** from the detail rows while un-consumed ones (non-rental `returnDate`) remain, that surviving rows are in the new order and keep `field`, and that `timing.phase`/`timing.isOngoingSpan` match a stubbed `today`. Undated items → `timing` absent entirely, rows unchanged.
3. **Component — `SegmentWhenBand`:** renders one vs two cells + arrow; date-only cell; `nextDay` marker; localises captions.
4. **Manual (dev server), a trip spanning today:** verify (a) band on top for a flight, stay, cruise, car, activity; (b) an ongoing hotel is live with the "staying now" chip while its check-in day header reads "done"; (c) a past day is fully readable with grey ✓ + "done"; (d) toggle beanie mode — all strings lowercase and correct; (e) `prefers-reduced-motion` kills the pulse; (f) Large text mode rescales the band; (g) dark mode contrast holds.
5. **Regression:** out-of-range banner, accommodation-gap cards, `TodayTimelineMarker`, attachment strip, inline edit of the surviving fields, and the collapsed key-value line all still work.
6. No E2E (Three-Gate: no data-loss journey; unit + manual cover it).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the band model (shared `segmentSpan` + pure `classifySegmentPhase`, `whenBand`/`phase`/`isOngoingSpan` on `TimelineItem`), a presentational `SegmentWhenBand`, the "staying now" rail-dot + chip reusing today's orange treatment, and Option B1 past styling via a `past` prop + grey-✓/"done" header; flagged the two behaviour deltas (date/time edit moves to the modal; rows reordered not merged).
- **Pass 2 (DRY + error handling)**: Caught that flights DO have `arrivalDate` (fixed the arrival-cell date + Assumption 2); made the band builder report its consumed `field`s so the row list drops exactly those (no orphaned/duplicated dates, esp. non-rental `returnDate`); removed the impure `logEvent` breadcrumb from `vacation.ts` (helpers stay pure); scoped `segmentSpan` to band/phase only (no merge with hint builders); made `phase`/`whenBand` optional with an explicit undated guard; pinned the "staying now" connector-dot to the exact lines/class and confirmed the 32px day circle is untouched; resolved the chip to a new minimal `StayingNowChip` (pulse via app's opt-in `no-preference` convention); reused `--tint-success-10` for the "done" pill; made the card `past` tint a 3-branch computed with pending/hint precedence; trimmed the new i18n keys to reuse existing `segmentRow.*`.
- **Pass 3 (Sustainability)**: Introduced a single `SEGMENT_TIMING` descriptor (mirrors existing `SIDE_FIELDS`) as the one source of per-kind date knowledge feeding `segmentSpan` + band + drop-set (new kind = one edit, not three); derived `isOngoingSpan` from the classifier output instead of a second boundary rule; grouped the three new `TimelineItem` fields into one optional `timing?` so "undated has no timing" is structural; added extraction of `accommodationDetailRows`/`transportationDetailRows` to keep the computed thin and testable; made the row-drop an explicit shared filter; lifted the pulse + reduced-motion guard into one shared CSS class; documented why `'now'` is a distinct third phase word; removed the contradictory hint-builder-refactor clause; fixed the reversed `enrichRows` precedent.
- **Pass 4 (Fresh-eyes sweep)**: Caught that the descriptor conflated "band second cell" with "phase span end" — split into a `second` band cell (flights/train/ferry have one) vs a `spanning` flag (only accommodation/cruise/rental_car), so a flight gets an arrival cell without being faded/chip'd as an ongoing span; gave non-rental transport a `pickupDate→departureDate` fallback so buses get a non-empty cell; specified the degraded two-cell→one-cell case emits the `segmentRow.starts` caption; fixed the last stale `item.whenBand` → `item.timing?.band`. Confirmed the display-only behaviour delta is clearly flagged for sign-off. Otherwise sound.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial request (this session, travel focus)

> note that i'm running a parallel claude code session related to implementing issue #60. in this session i will focus on an improvement to the travel plans view and layout

### Design brief

> I want to review the design of the overall travel plan layout. Currently, the most important, key info for a travel segment, the date and time, are sitting below less important info, such as flight number, airline, from/to, terminal, etc. I feel date and time should get special consideration and prominence and be featured at the top of the travel segment, and other fields should be listed in a natural, intuitive order. In addition, travel plan segments that are still active, such as a hotel stay, appear to get the "past" styling treatment even if the hotel stay is ongoing (I believe the past treatment is applied if the start date is in the past, rather than the end date). I would consider this a bug, as the segment is still technically active until the end date. In addition, travel segments that are legitimately in the past are given a past styling, but that styling makes them very hard to read, and it is often required to look at past plans while travelling, I think we should make the past style a more subtle style or indicator rather that fading all the past segment text, which resembles more of a disabled style to me than an indicator that the segment happened in the past. Can you propose some options to improve the layout here in a mockup with /frontend-design skill?

### Mockup approval

> Looks very good, let's go with option A with the hero band, looks very nice and please remain faithful to this for the implementation, also 2 and 3 are ok, for 3 go with option b1. move onto /beanies-pre-plan

### Pre-plan clarifications (AskUserQuestion)

> Priority = Medium; "when" hero band applies to All segment types; field-order change is Display only (edit forms untouched).

### Proceed to plan

> continue with /beanies-plan

</details>
