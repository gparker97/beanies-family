# Plan: Unified recurrence picker + week-based recurring transactions

> Date: 2026-08-23
> Related issues: Beanies tracker #70 (Notion). No GitHub issue — direct implementation.
> Plan file: `docs/plans/2026-08-23-unified-recurrence-picker.md`
> Mockup: `docs/mockups/unified-recurrence-picker-2026-08-23.html`

## User Story

As a family member logging income, I want to set a transaction to repeat every two weeks (or every N weeks on a chosen weekday) so my biweekly paycheck is documented accurately — using the same recurrence control I see everywhere else in the app.

## Context

A Discord early adopter (anna, 2026-08-21) asked for **week-based recurring transactions** ("every two weeks") to document income. Today transactions support only `daily | monthly | yearly` (`RecurringFrequency`, `models.ts:327`); there is no weekly, biweekly, or interval concept. Meanwhile three surfaces implement recurrence **independently**:

- **Transactions** — `RecurringItem` (`models.ts:329`), expanded by `recurringProcessor.ts` (`getNextDueDate` switch, daily/monthly/yearly only). Anchors on `dayOfMonth` + `monthOfYear`.
- **Activities** — `ActivityRecurrence` (`models.ts:695`: none/daily/weekly/biweekly/monthly/monthly-by-day/yearly + `daysOfWeek[]`), expanded by `activityStore.expandRecurring` (`activityStore.ts:252`) **and duplicated** by `recurrenceRrule.buildRecurrenceRule` (`utils/calendar/recurrenceRrule.ts:64`, whose own header comment flags the duplication as tracked debt). Anchors derive from `activity.date`.
- **Lists** — `ListFrequency` (`models.ts:510`: daily/weekly/monthly), consumed by `listLifecycle.ts` to **reset** a list on cadence (not materialize occurrences).

A vestigial `RecurringConfig` (`models.ts:278`, `weekly|biweekly|quarterly` + `interval`) exists but is written/expanded nowhere — the only place an interval concept lives in the type system today.

greg's guiding principle: **recurrence should have ONE look and feel everywhere it appears** — consistency is the feature. The approved direction-B mockup delivers a single control (Simple | Custom) that covers every rule the app can express today, adds "every N weeks/months" and "ends after N times", and shows only the sub-controls that apply to the current selection.

## Requirements

1. **Transactions gain week-based recurrence.** Weekly and every-2-weeks are reachable as standard options; "every N weeks/months/days/years" is reachable via Custom.
2. **One shared recurrence control** (`RecurrencePicker.vue`) used by transactions, activities, and lists — same layout, tokens, and interactions (mockup direction B).
3. **One canonical recurrence rule type** (`RecurrenceRule`) + **one expansion/next-date engine** (`recurrenceEngine.ts`) that all three surfaces (and the Google Calendar RRULE exporter) use — replacing the parallel implementations.
4. **Context-sensitive sub-controls**: weekly/every-N-weeks → weekday selection; biweekly → single weekday; monthly/every-N-months → "on the [date]" vs "on the [nth] [weekday]"; daily/yearly/every-N-days|years → no sub-controls, and the zone is hidden entirely (no empty box).
5. **Monthly anchoring**: "on the [date]" limited to 1–28 plus a "last day of month" option; "on the [nth] [weekday]" with the 5th→"last" coercion (matches today's `monthly-by-day`).
6. **Ends**: never / on a date / after N times (the last is new to the app).
7. **Derived anchors**: monthly/yearly labels derive from the entity's start date and relabel live; an explicit "based on your start date" hint is shown.
8. **Lists** adopt the same control, labelled "Resets" (not "Repeats"), preserving list **reset** semantics.
9. **Full backward compatibility**: every existing recurring transaction, activity, and list keeps working and reads/round-trips through the new model with no user-visible change and no data migration required at rest.
10. **i18n**: all new/_changed_ strings via `uiStrings.ts` (`en` + `beanie`), through a single recurrence label resolver — no bare strings, no Title Case carried into beanie mode.

## Important Notes & Caveats

- **The activity recurrence engine is delicate.** `docs/lessons.md` (2026-08-15) records eight failure modes — two data-loss, one financial — that flowed from reusing a create-payload as an update-payload and from `expandRecurring` edge cases (override children, `recurrenceEndDate` applied before the switch, `splitActivity` orphans). **Any migration of activities MUST preserve `expandRecurring`'s occurrence set exactly**, including override/split/"this and all future" semantics and the `parentActivityId`/`originalOccurrenceDate` override machinery. This is the single biggest risk and the reason for phasing (below).
- **Two consumers of the activity rule must stay in lockstep**: `expandRecurring` (in-app occurrences) and `recurrenceRrule.buildRecurrenceRule` (Google Calendar RRULE). Unifying the engine **collapses the RRULE builder to a thin `RecurrenceRule → RRULE` serializer** (map `unit → FREQ/BYDAY/BYMONTHDAY/INTERVAL`); the switch shrinks, it is not deleted. Reuse its existing fail-loud posture (`parseYmd` throws on bad dates; the `never` exhaustiveness guard at `recurrenceRrule.ts:104`) — do **not** wrap it in a new try/catch that would swallow the intentional throw.
- **Weekday cardinality decision (resolves a mockup/scope conflict):** the prompt puts "multi-day biweekly (every other Mon+Wed)" **out of scope**, but the mockup's Custom→weeks block showed a multi-weekday selector. Resolution: **`unit:'week'` + `interval === 1` (plain weekly) allows multiple weekdays; `interval ≥ 2` (biweekly and every-N-weeks) is a single weekday.** This honors today's biweekly behavior and the out-of-scope line. The mockup's Custom-weeks selector is constrained to single-select when interval ≥ 2. (Data model stays multi-capable so multi-day intervals can be enabled later without a type change.)
- **Lists are reset-cadence, not occurrence-generating.** Lists only ever need `unit` + `interval` (+ weekday for weekly). The shared picker is used with a `mode="reset"` prop that (a) relabels "Repeats"→"Resets", and (b) hides options lists can't honor if any (lists don't need monthly-by-weekday nor "ends" — a reset has no end). Do **not** force list semantics onto the occurrence engine.
- **`RecurringConfig` (`models.ts:278`) is a half-wired second interval concept — remove it _with_ `Transaction.recurring`.** It is the declared type of `Transaction.recurring` (`models.ts:318`) and is **read** at `TransactionModal.vue:231` (`recurrenceMode.value = transaction.recurring ? 'recurring' : 'one-time'`) — there is no writer, so it is latent, but deleting the type is not zero-touch. Remove `RecurringConfig` AND the `Transaction.recurring` field together, and replace the `:231` recurrence-mode read with the `RecurringItem`-based check the rest of the flow already uses. This is a rival `interval` + `weekly|biweekly|quarterly` concept living on `Transaction` (not `RecurringItem`) — delete it rather than extend it, so it can't be mistaken for the canonical rule.
- **No new feature gate** (greg: ship ungated). **No GitHub issue.**
- **Do not pre-warn users** or disable controls speculatively (per CLAUDE.md) — surface friction only on real failure.
- **Validation reuses the existing form path.** An incomplete rule (`isRuleComplete` false — e.g. weekly with zero weekdays, `afterCount` < 1) surfaces through the modal's existing `BeanieFormModal` disabled-save / validation mechanism, not a bespoke error channel — the picker must not introduce a parallel validation UX. The engine's `occurrencesInRange` throw (a bad rule that somehow reached expansion) routes to the already-planned `reportError({ surface:'recurrence', severity:'error' })` (non-critical: console + firehose, no page).

## Assumptions

> Review before implementation — valid at planning time.

1. The canonical `RecurrenceRule` can fully represent every current `ActivityRecurrence`, `RecurringFrequency`, and `ListFrequency` value (verified against the code map; the mapping table is in Approach).
2. Transactions' existing `RecurringItem.frequency`/`dayOfMonth`/`monthOfYear` can be **read** into a `RecurrenceRule` on the fly (a pure adapter) without rewriting stored `.beanpod` data — i.e. we can keep the stored `RecurringItem` shape and derive the rule, OR add an optional `rule` field that supersedes the legacy fields when present. Approach picks the latter (additive, safest).
3. Automerge tolerates adding an optional `rule` object to `RecurringItem`/`FamilyActivity`/`List` without migration (additive CRDT change — consistent with prior additive fields).
4. `FrequencyChips.vue` and `DayOfWeekSelector.vue` can be reused inside `RecurrencePicker.vue` (they already exist; the picker composes them rather than re-implementing chips/day-grids).
5. The Google Calendar exporter only needs the canonical rule (no per-surface special-casing) to produce correct RRULEs — confirmed feasible from `recurrenceRrule.ts`'s current switch.

## Approach

### Guiding shape — one rule, one engine, one picker

**Canonical type** (`src/types/recurrence.ts`, re-exported from `models.ts`):

```ts
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type MonthlyAnchor = 'date' | 'weekday'; // "on the 23rd" | "on the 4th Sunday"
export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'onDate'; date: ISODateString }
  | { kind: 'afterCount'; count: number }; // count >= 1

// Cadence = the shape of the repetition. Lists (reset-only) store/consume ONLY this.
export interface Cadence {
  unit: RecurrenceUnit;
  interval: number; // >= 1 (biweekly = week/2)
  weekdays?: number[]; // week unit: 0=Sun..6=Sat; multi iff interval===1, else length 1
  monthlyAnchor?: MonthlyAnchor; // month unit only
  monthlyDay?: number | 'last'; // monthlyAnchor==='date': 1..28 | 'last'
}

// A full occurrence-generating rule adds an end. Transactions + activities use this.
export type RecurrenceRule = Cadence & { end: RecurrenceEnd };
```

**Why split `Cadence` from `RecurrenceRule`:** lists _reset_ on a cadence and have no end — a flat rule would force lists to carry a meaningless `end:{kind:'never'}` and would let the type express the nonsense "a reset that ends after N times." Splitting makes the three-surface semantic difference **structural**, not a convention the picker's `mode="reset"` prop has to enforce. The engine's reset-due helper takes a `Cadence`; `occurrencesInRange`/`nextDue` take a `RecurrenceRule`.

The **anchor start date is the entity's own field** (`transaction.date` / `activity.date` / list creation) — never duplicated into the rule. Monthly/yearly derived labels ("the 23rd", "the 4th Sunday", "23 Aug") are computed from that start date at render + expansion time. `weekday`-anchored monthly derives nth-weekday via the existing `getWeekdayOrdinalInMonth` (with 5th→`-1`/"last"), reusing `utils/date.ts`.

**One engine** (`src/services/recurrence/recurrenceEngine.ts`): pure functions, **clock injected** (callers pass `today`/`now` — the engine never reads `Date.now()`, so DST/timezone golden tests are deterministic and resume-safe) —

- `firstDueOnOrAfter(rule, start, from)`, `nextDue(rule, start, prev)`, `occurrencesInRange(rule, start, range)`, `previewNext(rule, start, n)`, `isRuleComplete(rule)`, `isResetDue(cadence, start, lastReset, today)` (list path — takes a `Cadence`), and `describeRule(rule, start, t)` — **the single, canonical plain-language summary** (pure, takes `t`); `useRecurrenceLabel` calls `describeRule`, it never grows a second summary generator.
- **`afterCount` is stateless-derived**: computed by counting occurrences from `start` on every evaluation, never a mutable "remaining" counter (a decrementing counter drifts under Automerge merges when two devices each decrement it).
- **Engine boundary is fixed here in Phase A and stays pure `rule + start + range → dates` (+ cursor `nextDue`).** Override/split/"this-and-future" logic (`parentActivityId`/`originalOccurrenceDate` subtraction) is activity-only and **stays in the activity layer** — it must NOT leak into the shared engine, or transactions and lists inherit activity-only coupling and the "stable core at Phase A" premise fails. Design the Phase A signatures against _both_ the transaction cursor model (`lastProcessedDate`) and the activity range-expansion model on paper before building.
- Superset of today's `recurringProcessor` (daily/monthly/yearly) **and** `activityStore.expandRecurring` (weekly multi-day, biweekly, monthly, monthly-by-day, yearly) occurrence semantics. Existing helpers (`addDays/addMonths/addYears`, `getWeekdayOrdinalInMonth`, `parseLocalDate`) are reused, not reinvented.
- **RRULE**: `recurrenceRrule.buildRecurrenceRule` is refactored to take a `RecurrenceRule` and collapse to a thin `RecurrenceRule → RRULE` serializer (the switch shrinks, not deleted; keep its fail-loud throws). Activity export calls it with the canonical rule.

**One component** (`src/components/ui/RecurrencePicker.vue`): implements mockup direction B. Props: `modelValue: RecurrenceRule | null`, `startDate: ISODateString`, `mode?: 'repeat' | 'reset'` (default `repeat`; `reset` relabels + trims list-irrelevant options), `accent?: 'orange' | 'purple'` (to-do surfaces use purple per CIG). Emits `update:modelValue`. Internally composes the existing `FrequencyChips.vue` (Simple cadences) and `DayOfWeekSelector.vue` (weekday multi), plus small local subcomponents for the Simple|Custom segmented control, the interval stepper, the monthly-anchor radio, and the ends control. **The `accent` prop is not free today**: `FrequencyChips.vue`'s selected state hardcodes orange (`border-primary-500 text-primary-500`) and `DayOfWeekSelector.vue`'s hardcodes purple (`bg-secondary-500`) with no override. **Decision: add a small `accent` prop to both child components** (the honest DRY move, since to-do surfaces genuinely need purple) rather than forking them — Phase A adds it to `FrequencyChips.vue`/`DayOfWeekSelector.vue` and threads it from the picker. All tokens from the beanies theme/CIG (Heritage Orange, squircles, Outfit/Inter, Sky Silk focus, rem-based text); a Caveat one-line contextual hint per the theme's allowed form-modal-hint use. The picker renders **no sub-control zone at all** when the selection needs none.

**One label resolver** (`src/composables/useRecurrenceLabel.ts`): the id→`t()` resolver pattern (like `useCategoryLabel`), so every cadence/anchor/ends label routes through `uiStrings.ts` (`en` + `beanie`). The canonical full-rule summary is `describeRule` (in the engine, pure, takes `t`); this composable **calls** it rather than growing a second summary generator. It **absorbs all three** current formatters — `format.ts` `formatActivityRecurrence`/`buildRecurrenceOptions`, `recurringProcessor.ts:355` `formatFrequency`, **and the local re-implementation `formatFrequency` in `OnboardingRecurring.vue:159`** — collapsing the two divergent namespaces (`form.frequency.*`, `planner.recurrence.*`) into one (old keys kept as aliases only if still referenced).

### Backward compatibility (additive, no at-rest migration)

- Add optional `rule?: RecurrenceRule` to `RecurringItem` and `FamilyActivity`, and `cadence?: Cadence` to `List`. **When present it is the SOLE authority; when absent, one `resolveRule(entity)` / `resolveCadence(list)` function (wrapping the adapters) derives it from the legacy fields.** The legacy fields (`frequency`/`dayOfMonth`/`monthOfYear`, `recurrence`/`daysOfWeek`, list `frequency`) become a **frozen, read-only fallback** for pre-existing docs, marked `@deprecated` in `models.ts`.
- **No dual-write, ever.** New saves write ONLY the canonical field — the earlier "keep legacy fields in sync for one release" idea is dropped: `RecurringFrequency` is literally `'daily'|'monthly'|'yearly'`, so a biweekly/weekly/every-N/`afterCount` rule has _nothing_ to sync into and a downgraded client is already broken for any new-capability rule. Dual-write would buy no real downgrade safety while creating a divergence window and a forgotten cleanup.
- **One choke point + a defined death for the legacy path.** Every read goes through `resolveRule`/`resolveCadence`; direct reads of the deprecated fields are forbidden outside `adapters.ts` (documented invariant, ideally an ESLint `no-restricted-syntax` guard). The adapters get a hard removal milestone paired with a **one-time opportunistic backfill-on-edit** (any entity re-saved writes its canonical field), so the dual representation is contained and eventually deleted, not permanent residency.
- **The transaction adapter MUST preserve `lastProcessedDate`** — `recurringProcessor.getNextDueDate`/`generateDueTransactions` (`recurringProcessor.ts:93,325`) use it as the materialization cursor; the rule describes _shape_, `lastProcessedDate` describes _progress_. The engine takes both (rule + start + cursor); losing the cursor would re-fire or skip the first post-migration run.
- Adapters and any scoped write follow the **keep-list discipline of `src/utils/recurringItemFields.ts`** (the OMIT-vs-keep doctrine written for the 2026-08-15 data-loss modes) — never a blanket create-payload-as-update.
- This makes each surface's migration a **read-through-adapter, write-canonical** swap — the safest possible path and the reason phasing works.

### Phasing (each phase independently shippable)

- **Phase A — Shared core + transactions.** Build `recurrence.ts` type, `recurrenceEngine.ts`, `RecurrencePicker.vue`, `useRecurrenceLabel.ts`, and the transaction adapter. Wire `RecurrencePicker` into `TransactionModal.vue` + `TransactionViewEditModal.vue` + `OnboardingRecurring.vue`; `recurringStore`/`recurringProcessor` read/write via the engine + adapter. Delivers anna's biweekly/every-N ask and the unified control on transactions. Delete dead `RecurringConfig`.
- **Phase B — Activities.** Replace `ActivityModal`/`ActivityViewEditModal` recurrence UI with `RecurrencePicker`; route `expandRecurring` + the RRULE serializer through `recurrenceEngine`. **Reuse — do not reinvent — the lessons-hardened scoped-edit machinery**: `useRecurringEditScope.ts` (this-only / all / this-and-future resolver), `recurringItemFields.ts` (keep-list doctrine), and `linkedRecurringItem.ts` (the fee-sync link the 2026-08-15 saga corrupted). **Exhaustive parity + override/split regression suite first** (see Testing). Highest risk; ships only when green.
- **Phase C — Lists.** `ListDetailModal.vue` uses `RecurrencePicker mode="reset"`; `listLifecycle.ts` reads the rule (unit+interval+weekday) via the engine's "is a reset due?" helper.

Phase A satisfies the user request; B and C complete the "one control everywhere" principle. The picker + type are shared from Phase A so no surface ever diverges.

### Mockup fidelity

Implements `docs/mockups/unified-recurrence-picker-2026-08-23.html` faithfully (Simple|Custom up top, custom first-class; context-sensitive zone that disappears when empty; monthly radio; ends never/on-date/after-N; live summary; "based on your start date" hint; lists say "Resets"). Every concrete token comes from the CIG, not the mockup's raw values. The one reconciliation: Custom→weeks weekday selector is single-select when interval ≥ 2 (see Caveats).

## Files Affected

**New**

- `src/types/recurrence.ts` — canonical `RecurrenceRule` + unit/anchor/end types
- `src/services/recurrence/recurrenceEngine.ts` — pure expansion/next-date/describe engine
- `src/services/recurrence/adapters.ts` — legacy→rule adapters (transaction, activity, list)
- `src/components/ui/RecurrencePicker.vue` — the shared control
- `src/composables/useRecurrenceLabel.ts` — id→`t()` recurrence label resolver
- `src/services/recurrence/__tests__/recurrenceEngine.test.ts`, `adapters.test.ts`, `__fixtures__/legacy-parity.json` (captured Phase-A oracle snapshots)
- `docs/mockups/unified-recurrence-picker-2026-08-23.html` (already committed — the approved design)

**Modified — Phase A**

- `src/types/models.ts` — add optional `rule?` to `RecurringItem`; **remove `RecurringConfig` AND `Transaction.recurring` (`:278`,`:318`)**; re-export recurrence types
- `src/services/recurring/recurringProcessor.ts` (expand via engine + adapter; its `formatFrequency:355` folds into the resolver), `src/stores/recurringStore.ts`
- `src/pages/TransactionsPage.vue` — re-point its two `formatFrequency` call sites (`:442` recurring-row label, `:737` created-confirmation `recurring:` field) to the resolver when `formatFrequency` is removed
- `src/components/transactions/TransactionModal.vue` (`:325` frequencyOptions removed; `:231` recurrence-mode read re-based off `RecurringItem`, not `Transaction.recurring`), `TransactionViewEditModal.vue`, `src/components/onboarding/OnboardingRecurring.vue` (remove local `formatFrequency:159`)
- `src/components/ui/FrequencyChips.vue` + `DayOfWeekSelector.vue` — add an `accent` prop (orange/purple)
- `src/services/translation/uiStrings.ts` (+ `scripts/updateTranslations.mjs` if structure changes; run `npm run translate`)

**Modified — Phase B**

- `src/types/models.ts` (add `rule?` to `FamilyActivity`), `src/stores/activityStore.ts` (`expandRecurring`→engine), `src/utils/calendar/recurrenceRrule.ts` (thin `RecurrenceRule → RRULE` serializer; keep its fail-loud throws), `src/components/planner/ActivityModal.vue`, `ActivityViewEditModal.vue`, `src/utils/format.ts` (`buildRecurrenceOptions`/`formatActivityRecurrence`→resolver), `src/components/onboarding/OnboardingActivity.vue`
- **Reuse anchors (touch, don't reinvent):** `src/composables/useRecurringEditScope.ts`, `src/utils/recurringItemFields.ts`, `src/utils/linkedRecurringItem.ts`

**Modified — Phase C**

- `src/types/models.ts` (add `cadence?: Cadence` to `List`), `src/utils/listLifecycle.ts` (reset via engine `isResetDue(cadence, …)`), `src/components/lists/ListDetailModal.vue`
- **List UI has TWO distinct controls — be precise:** the picker replaces ONLY the _frequency_ control (`freqOptions`/`FrequencyChips`, `:410`) with `RecurrencePicker mode="reset"`. The **One-off/Repeats lifecycle toggle** (`lifecycleOptions`, key `lists.detail.recurring`, ~`:144`) stays unchanged — do NOT rename it (its "Repeats" label is the lifecycle on/off, not the cadence). The status-pill text (`recurrenceText` via `lists.status.repeats.*`, `:169`) is regenerated through the resolver from the `Cadence`.

## Help Center Coverage

- **Action**: update existing (+ possibly one new)
- **Category**: `features`
- **Article type** (if new): `how-to`
- **Slug**: update the transactions/recurring-money article and the planner/activities recurrence article; add `recurring-schedules` how-to if no single article covers the shared control
- **Title**: "Setting up repeating money, plans, and lists"
- **Scope**: From the user's side — how to make anything repeat (daily→yearly, every N weeks, specific weekdays, "the 4th Sunday", ends after N times), that the same control works across money, planner, and lists, and how the schedule follows your start date.
- **Notes**: Call out that monthly "on the date" tops out at the 28th (+ "last day") so it never skips short months; that lists "reset" rather than create dated entries.

Written per `.claude/skills/beanies-help-docs/SKILL.md`, shipped with Phase A (transactions) and extended in B/C.

## Observability Coverage

Surface: **`recurrence`** (one greppable prefix across engine + picker).

- **`logEvent({ level:'warn', surface:'recurrence', message:'rule-adapter-fallback', context:{ recur_surface, recur_reason } })`** — emitted when an adapter cannot map a legacy value (should be impossible; proves it). `recur_surface` ∈ transaction|activity|list; `recur_reason` names the unmapped shape. This is the blind-triage signal that a real-world stored value fell outside the model.
- **`logEvent({ level:'info', surface:'recurrence', message:'rule-materialized', context:{ recur_unit, recur_interval, recur_end } })`** — success-path counter on save so adoption/interval distribution is measurable. Enables future alerting on adapter-fallback _rate_. (`TELEMETRY_FLOOR_MS` does not apply to `logEvent` — it only gates `perfTiming` firehose escalation.)
- **`reportError({ surface:'recurrence', severity:'error', message:'expansion-failed', context:{ recur_surface, recur_unit } })`** — engine throws while generating occurrences (bad rule reaching expansion). Non-critical (no data at risk — the save is validated first) but firehose-visible with enough to reproduce.
- **`perfTiming.record('recurrence.expand', ms, { recur_surface })`** — guards the activity-migration risk: a regression that makes `occurrencesInRange` slow on a large series shows up as a timing spike correlated by `family_id`.
- No `severity:'critical'` events — no single recurrence action risks data loss (writes are validated by `isRuleComplete` before persist; a bad rule is refused with an inline form error, not a silent drop).
- **Privacy/store gate**: `ALLOWED_CONTEXT_KEYS` lives in `src/utils/diagnosticContext.ts:61` (NOT `logEvent.ts`), and a `recur_*` family already exists there (`recur_scope`, `recur_outcome`, `recur_occurrence_ymd`, `recur_resolved_ymd`, `recur_rescheduled`, `recur_stripped_fields`, `recur_children_removed`, `recur_children_expected`). **Reuse `recur_outcome` for the materialized outcome** rather than minting a near-duplicate; only genuinely new keys — `recur_surface`, `recur_unit`, `recur_interval`, `recur_end`, `recur_reason` — get added. **`recur_end` logs ONLY the discriminant (`never`/`onDate`/`afterCount`), never the end date** — logging `RecurrenceEnd.onDate`'s date would be high-cardinality and PII-adjacent. Any new allowlisted key ALSO needs the Lambda-mirror + store-declaration updates (`docs/runbooks/native-store-submission.md` + `PrivacyInfo.xcprivacy` + the store Data-Safety/App-Privacy answers + `privacy.astro`), per the `openCycle.ts:33` note. All new keys are low-cardinality enums/ints — no PII.

## Acceptance Criteria

- [ ] A transaction can be set to "every 2 weeks" on a chosen weekday and materializes on the correct dates going forward (Phase A).
- [ ] "Every N weeks/months" is reachable via Custom and materializes correctly.
- [ ] Monthly offers "on the [date]" (1–28 + "last day") and "on the [nth] [weekday]" (incl. "last"); the weekday multi-select is hidden for monthly and yearly.
- [ ] Ends supports never / on a date / after N times, and each is honored by the engine.
- [ ] The same `RecurrencePicker` renders on transactions, activities, and lists with identical look/feel; lists say "Resets".
- [ ] Sub-control zone is hidden entirely when the selection needs no options (no empty box).
- [ ] Every existing recurring transaction, activity (incl. weekly multi-day, biweekly, monthly-by-day), and list continues to behave identically (parity suite green); Google Calendar RRULE export unchanged for existing activities.
- [ ] `RecurringConfig` AND `Transaction.recurring` removed; the `TransactionModal.vue:231` recurrence-mode read re-based off `RecurringItem`; no references remain.
- [ ] All recurrence strings localized (`en`+`beanie`); `npm run translate` clean; no bare-string lint errors.
- [ ] Help Center article(s) in **Help Center Coverage** added/updated to match shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; new context keys allowlisted + store-declared.

## Testing Plan

1. **Engine unit tests** (`recurrenceEngine.test.ts`): a golden table of (rule, start) → first N occurrences covering daily; weekly single + multi-weekday; every-2/3/4-weeks; monthly on-date 1/15/28/`last`; monthly nth-weekday incl. 5th→last across a short month; yearly; each `end` kind (never/onDate boundary/afterCount exact). Assert exact dates and that the _wrong_ answers differ from the _right_ ones (per lessons.md rule 4 — never `toBeTruthy()`).
2. **Snapshot the parity oracle into fixtures FIRST (Phase A).** Before any legacy switch is deleted, capture the outputs of `expandRecurring`, `formatActivityRecurrence`/`formatFrequency`, and `buildRecurrenceRule` for the corpus into committed fixture files. All parity suites assert against the **fixtures**, not against live legacy code — because Phase B deletes the legacy implementations, which would otherwise destroy the oracle. The regression guard then keeps meaning long-term.
3. **Adapter round-trip tests**: every legacy `RecurringFrequency`, `ActivityRecurrence` (all 7), and `ListFrequency` value → rule/cadence → `describeRule`, asserting parity with the captured fixtures.
4. **Activity parity harness (Phase B gate)**: for the corpus, assert `occurrencesInRange(resolveRule(activity), …)` === the captured `expandRecurring` fixture set, **including** override children, split, "delete this and all future", and `recurrenceEndDate` applied at the right point (the exact traps in lessons.md). Phase B does not ship until identical.
   4b. **List reset parity (Phase C gate)**: capture today's `listLifecycle.isResetDue` (`:106` switch, keyed on `lastResetDate`) outcomes for legacy daily/weekly/monthly lists into fixtures; assert `resolveCadence(list)` → engine `isResetDue` reproduces the same reset boundaries exactly. **The transaction discipline of preserving the cursor applies here too — preserve `lastResetDate`.** Weekly-reset-on-a-chosen-weekday is a NEW additive list capability; its default (no weekday) MUST match current weekly-reset behavior.
5. **RRULE parity**: the thin `RecurrenceRule → RRULE` serializer byte-equals the captured `buildRecurrenceRule` fixture for every existing activity kind.
6. **DST / timezone golden tests**: with the injected clock, assert week/month interval math around a DST boundary and month-end (the `parseLocalDate` local-tz trap).
7. **E2E (Three-Gate filtered)**: extend `planner.spec.ts`-style coverage only where a real user would lose data — e.g. create a biweekly recurring income, reload, assert IndexedDB export contains the correct rule + projected dates (assert data, not DOM; use the second occurrence, not `.first()`, per lessons.md).
8. **Manual**: mockup-parity walkthrough on each surface; beanie-mode string check; keyboard/focus + reduced-motion; iOS input-zoom check on the date/stepper (≥16px focusable).
9. `npm run build` (full rollup import-graph) before pushing any phase (per repo memory) + type-check + lint + `npm run translate`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the canonical rule/engine/picker/adapter architecture, additive-`rule?` backward-compat, A/B/C phasing (transactions first, activities gated on a parity harness), observability on `surface:'recurrence'`, and the weekday-cardinality + monthly-cap reconciliations.
- **Pass 2 (DRY + error handling)**: Corrected the `ALLOWED_CONTEXT_KEYS` location (`diagnosticContext.ts`, existing `recur_*` family — reuse `recur_outcome`) and the false "`RecurringConfig` has no readers" claim (it types `Transaction.recurring`, read at `TransactionModal.vue:231` — remove both together); folded in the missed duplicate `formatFrequency` (`OnboardingRecurring.vue:159` + `recurringProcessor.ts:355`) and the scoped-edit reuse anchors (`useRecurringEditScope`/`recurringItemFields`/`linkedRecurringItem`); fixed the overstated RRULE-switch "deletion" (→ thin serializer, keep fail-loud throws), the misapplied `TELEMETRY_FLOOR_MS`, the hardcoded-accent conflict in `FrequencyChips`/`DayOfWeekSelector` (add an `accent` prop), the missing `lastProcessedDate` cursor in the adapter contract, and pinned validation to the existing `BeanieFormModal` path.
- **Pass 3 (Sustainability)**: Killed the dual-write "keep legacy fields in sync" trap (canonical field authoritative + frozen read-only `@deprecated` legacy behind one `resolveRule`/`resolveCadence` choke point with a delete milestone + backfill-on-edit); split the flat rule into `Cadence` vs `Cadence & { end }` so list-reset semantics can't express occurrence-only fields; pinned the engine boundary (override/split stays in the activity layer, clock injected, `afterCount` stateless-derived for CRDT safety); named `describeRule` the single summary; and froze parity oracles into committed fixtures before the legacy code is deleted (+ DST/timezone golden tests).
- **Pass 4 (Fresh-eyes sweep)**: Added the missed `TransactionsPage.vue` `formatFrequency` consumers (`:442`,`:737`) to Phase A; disambiguated the list "Repeats"→"Resets" relabel (the One-off/Repeats _lifecycle_ toggle stays; the picker replaces only the _frequency_ `FrequencyChips` at `:410`, plus the `lists.status.repeats.*` pill via the resolver); required a list-reset parity fixture + explicit `lastResetDate` cursor preservation (weekly-on-weekday is new, default matches today); and pinned `recur_end` telemetry to `end.kind` only (no date leak). Architecture otherwise confirmed sound.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (assembled by /beanies-pre-plan from Notion #70)

The full `=== BEANIES PRE-PLAN ===` block for #70 (recurrence unification) — captured verbatim on the tracker row's `beanies-plan prompt` property and in this session.

### Shaping decisions (greg, 2026-08-23)

- Include lists as a first-class surface ("recurrence should have a single standard look and feel everywhere; families are built on routine").
- Common options weekly/biweekly/monthly easy to reach; "every N weeks" behind Custom.
- Direction B chosen (Simple/Custom split, custom first-class up top).
- Keep the weekday picker for biweekly/every-N-weeks; monthly derives from start date.
- Monthly on-date capped 1–28 + "last day"; ends adds "after N times"; explicit start-date hint; context-sensitive controls hide entirely when nothing applies (no "nothing here" box).

</details>
