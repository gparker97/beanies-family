# Plan: Recurrence — month-end clamp, cadence-correct fees, and the remaining surfaces (#70)

> Date: 2026-08-23
> Related issues: Beanies tracker #70 (Notion). **No GitHub issue** — direct implementation.
> Plan file: `docs/plans/2026-08-23-recurrence-clamp-fee-parity-and-remaining-surfaces.md`
> Predecessor: `docs/plans/2026-08-23-unified-recurrence-picker.md` (Phase A — shipped to `main`, not deployed)
> Mockup: `docs/mockups/unified-recurrence-picker-2026-08-23.html` (approved; unchanged by this plan)

## User Story

As a family member with a fortnightly swimming class and a bill on the 31st, I want beanies to charge me the right amount and never silently drop a month, so the money and the plan I see match the life I actually live.

## Context

#70 unified recurrence behind one canonical `RecurrenceRule`, one engine (`src/services/recurrence/`), and one control (`RecurrencePicker.vue`). **Phase A (transactions) shipped to `main` as `d6aa480c` and is not yet deployed** — the last prod Vue deploy was `0.9.11R4` on `51010806`, so all of `0.9.12` including Phase A is unshipped.

> Note two similarly-named directories: `src/services/recurrence/` is the new canonical engine; `src/services/recurring/recurringProcessor.ts` is the legacy transaction materializer. They are one letter apart and both appear throughout this plan.

Phase B's _data_ layer also already shipped and is dormant-safe: `activityStore.expandRecurring` (`:284-295`) and `recurrenceRrule.buildRecurrenceRule` (`:115-118`) both have rule-first dual-paths, and `OVERRIDE_INVALID_KEYS` (`activityStore.ts:86`) already includes `'rule'`. `RecurrencePicker` already ships `mode="reset"` and the engine already exports `isResetDue`.

What remains is **the writers and the legacy-field readers**. Investigating that surface turned up four defects that shape the work.

**1. Monthly month-end handling is inconsistent across the app, and the legacy transaction processor is inconsistent with itself.** `recurrenceEngine.ts:112` does `if (day > daysInMonth(y, mi)) continue;` — it skips. Legacy activity expansion _clamps_ (`activityStore.ts:422`), and so does the engine's own yearly branch (`:123`). The legacy transaction processor does **both**: `getFirstDueDate` clamps (`recurringProcessor.ts:178,183,192,198`), but `getNextDueDate:226` steps with `addMonths`, which is a bare `setMonth` (`src/utils/date.ts:212-216`) and therefore **overflows** — Jan 31 → Feb 31 → Mar 3, then `:227`'s `Math.min` pulls it to Mar 31. Verified by simulation: a 31st-of-month item yields Jan 31 → **Mar 31 → May 31 → Jul 31**, silently skipping every short month.

So the engine's skip comment at `:110-111` is accurate _about `getNextDueDate`_ and wrong about `getFirstDueDate`. Under greg's decision the engine clamps uniformly, which is a **deliberate behaviour change** for rule-bearing transactions — not merely the correction of a false comment. Two live consequences today: editing an existing "31st" recurring transaction through the new picker changes its schedule (it gains the February payment it never had), and the first vs. subsequent occurrences of the same legacy item disagree.

**2. The RRULE serializer has the same defect, one layer out.** `ruleToRrule` (`recurrenceRrule.ts:99-101`) emits `BYMONTHDAY=${rule.monthlyDay}`. Per RFC 5545 `BYMONTHDAY=31` **skips** February. Clamping only in-app would create a _new_ divergence: beanies shows Feb 28, Google shows nothing. Both must ship together.

**3. `calculateMonthlyFee`'s `per_session` branch assumes a weekly cadence — live in production today.**

```ts
// src/utils/finance.ts:41
monthly = (feeAmount * Math.max(sessionsPerWeek, 1) * 52) / 12;
// src/stores/activityStore.ts:711
sessionsPerWeek: activity.daysOfWeek?.length || 1,
```

`daysOfWeek` is only populated for `recurrence: 'weekly'` (`ActivityModal.buildPayload:566-585`). For every other cadence `sessionsPerWeek` collapses to `1`:

| Activity recurrence          | True occurrences/month | Billed as | Error          |
| ---------------------------- | ---------------------- | --------- | -------------- |
| `weekly`, 2 days             | 8.67                   | 8.67      | correct        |
| `biweekly`                   | 2.17                   | 4.33      | **2× over**    |
| `monthly` / `monthly-by-day` | 1                      | 4.33      | **4.33× over** |
| `yearly`                     | 0.083                  | 4.33      | **52× over**   |
| `daily`                      | 30                     | 4.33      | 7× **under**   |

`monthlyFactor` (`recurrenceEngine.ts:258`) is the fix, and `WEEKS_PER_MONTH = 52/12` (`:250`) is the _same constant_ the legacy formula uses — so the weekly case is **byte-identical** and the change is a pure correction.

**4. `budgetStore.upcomingTransactions` ignores frequency entirely — also live.** `budgetStore.ts:174-201` computes the next occurrence from `Math.min(item.dayOfMonth, daysInMonth)` alone, reading neither `item.frequency` nor `item.rule`. Post-Phase-A, `legacyShadowFromRule` (`adapters.ts:98-102`) shadows a weekly rule as `frequency:'monthly', dayOfMonth: min(anchorDay,28)`, so the budget widget shows a wrong next date and `daysUntil` for every rule-bearing weekly/every-N item.

Four stale/incorrect comments are corrected as part of the work — they are what allowed the divergences to persist: `recurrenceEngine.ts:110-112` (the false clamp claim), `:250` (`// ≈ 4.345` on a constant equal to 4.3333), `src/types/recurrence.ts`'s `monthlyDay` JSDoc ("1..28, or 'last'"), `adapters.ts:117-118` (claims a 28/last cap while `:147` returns the verbatim day — with clamping, verbatim is now **correct**), and `adapters.ts:140-142` ("the engine skips months lacking it"), which the clamp falsifies.

Greg's decisions this session:

- **Clamp, never skip.** _"if the month doesn't happen to have that day, I agree 100% to clamp it to the LAST day of the month. NEVER skip."_ Plus: the UI should make it clear.
- **Lists get the full picker, no cadence trimming.** The only thing that makes no sense for a reset is "ends", already handled by `mode="reset"`.

## Requirements

1. **Monthly clamping is universal for rule-bearing entities** — in the shared engine _and_ in the exported RRULE. No occurrence is skipped, in-app or in Google Calendar. **Rule-less legacy items are deliberately unchanged** (R10 keeps `getNextDueDate`'s switch, which still skips), since there is no at-rest migration.
2. **The picker surfaces the clamp.** When the derived monthly day is 29/30/31 the picker states that short months use the last day. The anchor derives verbatim from the start date (1–31).
3. **Per-session fees are cadence-correct**, via `monthlyFactor`. The weekly case is byte-identical to today.
4. **Every reader that depends on a _lossy_ shadow field honours `rule`** — fee sync, session counting, recurrence labels, scope-edit guards, `budgetStore.upcomingTransactions`, `recurringStore.normalizeToMonthly`. Readers depending only on _faithful_ fields are left alone by design (see R12).
5. **No resolver returns `undefined` and none fails silently**: an unmappable stored value logs `rule-adapter-fallback` and returns `null`.
6. **Activities adopt `RecurrencePicker`** in `ActivityModal.vue`, writing `rule`. `OnboardingActivity` writes a canonical rule from its existing `DayOfWeekSelector` — it does **not** gain the full picker.
7. **An untouched legacy activity keeps emitting no `rule`.** This is a statement about _writes_; it does not forbid converging the read paths later.
8. **Lists adopt `RecurrencePicker mode="reset"`**, storing a `Cadence` plus a legacy `frequency` shadow.
9. **Legacy lists reset on exactly their current boundaries**: `daily → day/1`; `weekly → week/1, weekdays:[1]`; `monthly → month/1, monthlyDay:1`.
10. **No legacy _expansion or reset_ switch is deleted** — those are live runtime paths for rule-less data. (This does _not_ protect zero-caller code; see the end-state table.)
11. **i18n**: every new/changed string via `uiStrings.ts` with both `en` and `beanie`.
12. **The shadow fidelity contract is written down and tested** (see below), and it — not case-by-case judgement — decides which readers must become rule-aware.

## Representation End-State & Deletion Triggers

The target end-state is **adapter-at-the-edge, engine-in-the-middle, one read path** — _not_ permanent dual representation. Without named triggers, "dual-path" stops being a migration and becomes the architecture. Every artefact this plan touches or adds:

| Artefact                                                                    | Deletion trigger                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `expandRecurring` legacy switch (`activityStore.ts:298+`)                   | Testing-Plan item 4 green for all 7 kinds → a doc-load normalize writes `rule` once, then the switch goes |
| `buildRecurrenceRule` legacy switch (`recurrenceRrule.ts:120+`)             | same                                                                                                      |
| `normalizeToMonthly` legacy switch (`recurringStore.ts:47-56`)              | **immediately, in B1a** — `resolveTransactionRule` makes it redundant                                     |
| `computeRecurringReset` legacy switch                                       | Step C parity test green                                                                                  |
| `format.ts` `formatActivityRecurrence` / `buildRecurrenceOptions`           | **end of B2** — zero production callers remain; move to the test tree                                     |
| `activityShadowFromRule` / `listShadowFromCadence` / `legacyShadowFromRule` | when downgrade-compat for pre-#70 clients is dropped — name the version at that time                      |

Testing-Plan item 4 is the load-bearing evidence: record its result, because it is what authorizes the first two rows.

### The shadow fidelity contract (R12)

Shadows already make _most_ legacy readers correct by construction. The question is only which shadow fields are faithful — write it in `adapters.ts`'s header and test it, rather than rediscovering it per reader:

- **Faithful for every rule**: `recurrence !== 'none'` (recurs at all); `recurrenceEndDate` (written iff `end.kind === 'onDate'`, `adapters.ts:169`); `RecurringItem.frequency === 'yearly'` iff `unit === 'year'`; `FamilyList.frequency` _presence_.
- **Lossy**: the `recurrence` _kind_ (`week/3` → `'weekly'`, `adapters.ts:173-180`); `daysOfWeek`; the specific `ListFrequency`; `RecurringItem.dayOfMonth` for non-monthly rules.

**The rule: a reader must become rule-aware iff it depends on a lossy field.** That justification is durable and applies to readers not yet written.

Also record the cross-client tie-break in the same header: **rule/cadence wins; the shadow is write-only from #70 clients and is never read back on a rule-bearing entity.** An old client editing a rule-bearing entity writes only the shadow, which a new client then ignores — already true post-Phase-A, currently undocumented.

## Important Notes & Caveats

- **The fee fix changes existing users' numbers.** Any **recurring** legacy biweekly/monthly/yearly/daily activity with `feeSchedule: 'per_session'` will see its linked payment change (mostly downward). One-off paid activities are unaffected — they already take the one-time path (`activityStore.ts:705`). **Needs a release note.** `syncLinkedRecurringPayment` re-syncs on save, so amounts correct as activities are touched — do **not** add a bulk migration that rewrites every family's payments unprompted.
- **`'last'` is a label variant of `monthlyDay: 31`, not a separate behaviour.** After Step 0 they are provably equivalent (engine clamps; both serialize to `BYMONTHDAY=-1`). State the invariant in `src/types/recurrence.ts`: _label and serialization sites may branch on `'last'` (`RecurrencePicker.monthlyDateLabel:219`, `recurrenceRrule.ts:100`, `describe.ts`); no occurrence-generating path may._ This replaces "maintain `'last'` in five places forever" with one enforced rule. The picker can no longer produce `'last'`, and that is fine.
- **Editing a legacy 29–31 monthly transaction changes its schedule.** `TransactionModal.vue:181-183` loads `resolveRecurringItemRule(item).rule` into the picker and saves it back, so an edit silently upgrades a rule-less item to a rule — and under the clamp it starts materializing a February payment it never had. Same class of user-visible money change as the fee fix; **both belong in the release note.**
- **Do not "fix" `isRuleComplete`'s 1..31 range.** It correctly accepts 29–31; only its comment needs updating.
- **`assertNever` is wrong for a resolver's `default:` branch.** It throws (`src/utils/assertNever.ts`), unacceptable from a render path. Use an exhaustiveness-typed `default:` that **logs and returns a safe fallback** instead. (`format.ts:136-144` is the nearest existing shape, but note it returns `String(_exhaustive)` and does _not_ log — don't copy it verbatim.)
- **`reconcilePlan.ts` stays sealed.** It imports four local modules and nothing else (`:8-12`). Do **not** import `adapters.ts` or the engine into it — see B1.4.
- **The 2026-08-15 lessons apply in full to B2.** Reuse `useActivityScopeEdit.ts`, `recurringItemFields.ts`, `linkedRecurringItem.ts`. Never reuse a create payload as an update payload; `ActivityModal`'s minimal-diff via `diffPayload.ts` is what keeps R7 true.
- **`OVERRIDE_INVALID_KEYS` already contains `'rule'`** (`activityStore.ts:86`). Do not remove it.
- **Biweekly deliberately ignores `daysOfWeek`** in legacy expansion (`expandPeriodic:205-245`). Preserve that.
- **`expandYearly` has a documented invariant** (`activityStore.ts:449-467`). Do not disturb it.
- **`FrequencyChips` is a general-purpose chip control** used by 15+ components. Removing it from recurrence must not touch its other consumers.
- **`HARD_CAP = 20000` is at `recurrenceEngine.ts:38`.** `generate()` iterates from the anchor on every call; this work raises the call count (`linkableActivities` already calls `expandRecurring` 13× per activity, `activityStore.ts:622-635`). Not a blocker — **file a tracker** for engine warm-start rather than leaving the note orphaned in a source comment.
- **No feature gate** — ship ungated.

## Assumptions

> **Review before implementation.** Valid at planning time (2026-08-23).

1. **Verified (Pass 2).** `monthlyFactor({unit:'week', interval:1, weekdays:[n]})` returns exactly `n × 52/12` (`recurrenceEngine.ts:250,265`; `finance.ts:41`).
2. No **shipped** user has a `monthlyDay: 29|30|31` rule persisted, because Phase A is undeployed. Note the reasoning is _only_ that — `adapters.ts:48` writes `monthlyDay: item.dayOfMonth` verbatim (1–31) and `TransactionModal.vue:182` persists it, so `deriveMonthlyDay`'s cap does not prevent it. A dogfood `.beanpod` built from `main` can already hold a February-skipping rule.
3. **Verified (Pass 2).** `listStore.reconcileRecurringLists` (`:429-447`) is the only _reset_ write path and `computeRecurringReset` the only decision point. Note `setLifecycle` (`listStore.ts:394`) is a separate `frequency` **write** path — see Step C.
4. Adding `cadence?: Cadence` to `FamilyList` and `rule?` writes on `FamilyActivity` are additive Automerge changes needing no at-rest migration.
5. **Verified (Pass 2).** `ActivityViewEditModal` has no recurrence _editor_; its only recurrence writes go through `useActivityScopeEdit`.

## Approach

### Step 0 — Month-end clamp (engine + RRULE) and the picker hint

Lands first. **The engine and RRULE halves must ship in the same commit** — either alone creates a beanies↔Google divergence.

**Engine** (`recurrenceEngine.ts`) — in `generate()`'s `case 'month'`, replace the skip with a clamp:

```ts
// A numeric day a month lacks (e.g. the 31st in Feb/Apr) CLAMPS to that month's
// last day — never skipped. Matches legacy activity expansion
// (activityStore.expandMonthlyByDate), this engine's own yearly branch, and the
// RRULE serializer's BYSETPOS clamp. NOTE the legacy transaction processor is
// inconsistent: getFirstDueDate clamps, but getNextDueDate steps with addMonths
// (a bare setMonth, so Jan 31 -> Mar 3) and therefore SKIPS short months. That
// legacy path is deliberately left alone (no at-rest migration); rule-bearing
// items clamp uniformly. This is an intentional behaviour change, not parity.
occ = new Date(y, mi, Math.min(day, daysInMonth(y, mi)));
```

Fold `'last' → 31` into the `day` ternary at `:99` and drop the separate `isLast` branch (`:98,107`) — they are now provably equivalent, and one branch fewer is one drift risk fewer. Also correct the `WEEKS_PER_MONTH` comment (`:250`) to `// 52/12 ≈ 4.3333`; correct `isRuleComplete`'s range comment (`:283-285`); and fix the latent bug at `:264` where `monthlyFactor` tests raw `cadence.interval === 1` instead of the normalized `interval` from `:259` (a weekly cadence with `interval` absent/0 silently collapses to one weekday). This is **defensive**, not a live bug — `isRuleComplete:278` rejects `interval < 1`, so it is only reachable for a synthesized cadence.

**RRULE** (`recurrenceRrule.ts`) — `ruleToRrule`'s monthly-on-date branch:

- `monthlyDay === 31` (and `'last'`) → `BYMONTHDAY=-1` — exact, since clamp(31) is the last day of every month
- `monthlyDay === 29 | 30` → `BYMONTHDAY=28,…,N;BYSETPOS=-1` — selects the last of the days that exist
- `monthlyDay <= 28` → unchanged

**Picker — weekday re-anchoring (a live Phase-A bug, and a prerequisite for B2).** `watch(anchorYmd, …)` (`:193-195`) re-derives **only** `s.monthlyDay`. `s.weekdays` is assigned solely by `syncFromModel` (`:154`, `:159`) and by user interaction (`:241-245`), so changing a transaction's start date from a Monday to a Tuesday leaves the rule saying Mondays. This is exactly what `ActivityModal.vue:373-386` exists to prevent — so B2's deletion of that watcher is only safe once the picker does the job. Extend the watcher to `watch(anchorYmd, (newYmd, oldYmd) => …)` and, when `s.weekdays` is exactly `[parseLocalDate(oldYmd).getDay()]` (the same "untouched" heuristic as `ActivityModal.vue:380-382`), re-derive to the new anchor's weekday.

**Picker — monthly hint.** `deriveMonthlyDay()` returns `anchorDate.value.getDate()` verbatim, and its return type narrows to `: number` (`:72-74`); `'last'` then enters `s.monthlyDay` only via the load path (`:161-164`), which is the intent. **Do not add a second hint node** — rename the existing `startHint` computed (`:229-231`, rendered at `:391` inside the `v-else-if="ctx === 'monthly'"` block opened at `:347`) to `monthlyHint` and extend it:

```ts
const monthlyHint = computed(() => {
  const base = fillTemplate(t('recurrence.startHint'), { date: formatDayLong(anchorYmd.value) });
  return s.monthlyMode === 'date' && typeof s.monthlyDay === 'number' && s.monthlyDay > 28
    ? `${base} ${fillTemplate(t('recurrence.monthly.clampHint'), { date: getOrdinalSuffix(s.monthlyDay) })}`
    : base;
});
```

(`InfoHintBadge.vue` is a click-to-open popover — wrong affordance; greg asked for it to be visible.) New key:

```
recurrence.monthly.clampHint  en: "Months without a {date} use the last day."
                              beanie: "months without a {date} use the last day."
```

**Normalize `'last'` in the transaction shadow.** `legacyShadowFromRule` gates on `typeof rule.monthlyDay === 'number'` (`adapters.ts:88`), so a `monthlyDay: 'last'` monthly rule falls through to the inert placeholder at `:102` and shadows as `dayOfMonth: min(anchorDay, 28)` — a _wrong_ shadow for a monthly rule, contradicting R12's claim that `dayOfMonth` is faithful for monthly. Normalize `'last' → 31` at the top of the function.

Correct the now-false comments at `RecurrencePicker.vue:62-64`, `:71`, `adapters.ts:140-142`, the `monthlyDay` JSDoc in `src/types/recurrence.ts` (adding the `'last' ≡ 31` invariant), and `activityRuleAdapter`'s header (`adapters.ts:117-118`).

### Step B1a — Adapter convergence + fee correctness

Split from B1b so the user-visible financial correction can be reverted without losing the hardening.

**B1a.1 — Converge the three adapters on one signature.** They are drifting, not converging: `resolveRecurringItemRule` returns `{rule, anchor}` and is _never_ null; `activityRuleAdapter` returns `RecurrenceRule | null` where null means one-time; the proposed list resolver would have been a third shape. Adopt one:

```ts
// Reuse the interface that already exists at adapters.ts:19 — do NOT mint a
// second name for the same shape.
resolveTransactionRule(item): ResolvedRule | null   // renamed; now nullable
resolveActivityRule(activity): ResolvedRule | null  // renamed from activityRuleAdapter
resolveListRule(list): ResolvedRule | null          // Step C
```

**`null` carries two meanings — state both and pin each caller.** For activities and lists it means _does not recur_; for transactions (which always recur) it can only mean _unmappable_. Caller behaviour: `normalizeToMonthly` → return `item.amount` (byte-identical to today's `default:` at `recurringStore.ts:48-56`); `budgetStore` → omit the row; `recurringProcessor` → fall through to its legacy switch.

Two payoffs beyond symmetry. **The anchor rides with the rule** — every engine entry point takes `(rule, anchorYmd)` and today each caller re-derives it (`useRecurrenceLabel.ts:38`, `activityStore.ts:285`, plus every new call site), while only `resolveRecurringItemRule` knows the yearly anchor must be _rebuilt_ from `monthOfYear`/`dayOfMonth` (`adapters.ts:53-62`). Bundling makes anchor bugs structurally impossible. And **the never-null transaction default is a live hazard**: `adapters.ts:63-65` sends an unknown `frequency` to _daily_, while `recurringStore.ts:53-55`'s own default sends it to _monthly_ — same input, 30× apart.

Give every resolver the same `default:` branch (R5):

```ts
default:
  logEvent({ level: 'warn', surface: 'recurrence', message: 'rule-adapter-fallback',
    context: { recur_surface: 'activity', recur_reason: 'unknown-recurrence' } });
  return null;
```

This is the call site the Phase A plan specified for `rule-adapter-fallback` and never got.

**Export `ActivityRecurrenceFields`** (`adapters.ts:107`, currently module-private) — this is what lets B1a.3's `ActivityModal` call build a resolver input from its legacy refs before a `rule` ref exists, and it replaces the verbatim duplicate `Pick<>` at `useRecurrenceLabel.ts:31-34`.

**Rename fallout — these call sites must be updated or they will not type-check** (all absent from earlier drafts): `recurringProcessor.ts:168` and `:217` (both destructure `{ rule, anchor }`, and must now narrow), `TransactionModal.vue:181-183`, `useRecurrenceLabel.ts:25,36`, and `recurrenceRrule.rule.test.ts:40`.

**Explicit do-not-touch**: `expandRecurring`'s `if (activity.rule)` branch (`activityStore.ts:284`) must **not** be routed through `resolveActivityRule` here — that would put legacy activities on the engine and void Testing-Plan item 4's parity guarantee (and R10). Only `syncLinkedRecurringPayment` (`:701,708-711`) converts in B1a.

**B1a.2 — Retire `normalizeToMonthly`'s legacy switch.** `recurringStore.ts:47-56` becomes `const r = resolveTransactionRule(item); return r ? item.amount * monthlyFactor(r.rule) : item.amount;` — deletes the divergent default and one dual-path in the same stroke.

**B1a.3 — The fee fix.** Replace `sessionsPerWeek` with `monthlyOccurrences` in `calculateMonthlyFee` (`finance.ts`) — **one formula, not two**:

```ts
case 'per_session':
  monthly = feeAmount * monthlyOccurrences;
  break;
```

`monthlyOccurrences` is **required** — it replaces the `sessionsPerWeek = 1` default at `finance.ts:32`, otherwise "no fallback" is silently defeated by a default value. There are exactly two production callers (`activityStore.ts:708`, `ActivityModal.vue:495`); the rest are tests.

In `syncLinkedRecurringPayment`, route the one-off check through the resolver too — `activityStore.ts:701` currently does `activity.recurrence === 'none'`, a direct legacy read `adapters.ts:14-15` forbids:

```ts
const resolved = resolveActivityRule(activity);   // null ⟺ one-time
const isOneTimePayment = !resolved || isAllSchedule;
… : calculateMonthlyFee({ …, monthlyOccurrences: monthlyFactor(resolved.rule) })
```

`ActivityModal.calculatedMonthly` (`:495-501`) does the same — but **at B1a the modal has no `rule` ref** (it has `recurrence` `:113`, `daysOfWeek` `:114`, `recurrenceEndDate` `:115`), so it builds an `ActivityRecurrenceFields` input from those legacy refs and passes it to `resolveActivityRule`. That keeps preview and persisted amount in agreement without waiting for B2.

**B1a.4 — `budgetStore.upcomingTransactions`.** Replace the `Math.min(item.dayOfMonth, daysInMonth)` guess (`budgetStore.ts:174-201`) with `firstDueOnOrAfter(rule, anchor, todayYmd)` from the resolver. Two behaviour changes to decide explicitly rather than inherit: (a) today `isPast = dayOfMonth <= currentDay` (`:181`) pushes a **due-today** item to next month, whereas `firstDueOnOrAfter` includes today (`daysUntil: 0`) — adopt the inclusive behaviour, it is what the widget's name promises; (b) `activeItems` (`recurringStore.ts:26`) filters on `isActive` only, so an exhausted `onDate`/`afterCount` series resolves to no next date — **omit the row** (today it shows a bogus one).

### Step B1b — Reader and failure hardening

**B1b.1 — Session counting: DEFERRED TO B2.** `allScheduleEnabled` (`:453`) → `isRecurring && rule.end.kind !== 'never'` and `totalSessions` (`:504-526`) against the rule's own end both need a `rule` ref that does not exist until B2. Implementing them here against `recurrenceEndDate` would silently read 0 sessions for every `afterCount`-bounded series the moment B2 lands. Both edits move to B2, where the input exists. The engine primitive they need is added here so it can be unit-tested independently:

```ts
// recurrenceEngine.ts — one place that knows how BOTH end kinds terminate.
export function occurrenceCount(rule: RecurrenceRule, anchorYmd: string): number | null;
// null ⟺ end.kind === 'never'. If generation hits HARD_CAP (:38) the count is
// capped — return null rather than a truncated number, so a capped series can
// never silently under-report a session count that divides a fee.
```

**B1b.2 — Labels.** Swap `formatActivityRecurrence` consumers to `describeActivity` (the composable is already live in three transaction call sites; only its `describeActivity` _member_ is unused): `ActivityViewEditModal.vue:541-549` and `ActivityListCard.vue:84-88`. The card renders a _translated_ enum (`:87`, `t('planner.recurrence.' + activity.recurrence)`), so an every-3-weeks rule prints **"Weekly"** — wrong, not merely unhelpful. But `describeRule` emits a full sentence with a ` · Until 12 December 2026` tail (`describe.ts:43-101`) into a `px-1.5 py-px text-xs` pill: apply `truncate` + `:title` exactly as Step C does for `ListTile`, or keep the compact chip and route `describeActivity` only into the `:title`. Keep `v-if="activity.recurrence !== 'none'"` as the visibility gate — it is a _faithful_ field under R12. While there, collapse `recurrenceLabel` (`:541-544`) and `scheduleSummary` (`:546-549`) — the same expression differing only in returning `''` for `'none'` — into one computed plus a `v-if`.

**B1b.3 — Close the scope-edit silent discard.** `useActivityScopeEdit.ts:102` does `if (movedTo && template) patch.date = …`, so when the `find` at `:62` misses, the user's date move is dropped **and the save reports success**. Guard it — narrowed to the only path that dereferences `template`:

```ts
if (scope === 'all' && movedTo && !template) { showToast('error', …); logEvent({ … action:'template-missing' }); return false; }
```

placed inside/above the `scope === 'all'` branch (`:97-105`). Note `movedTo && !template` alone is **not** narrow enough — it would newly fail `'this-only'` (`:106`) and `'this-and-future'` (`:115`), neither of which touches `template`.

**Cut from scope:** making `:75`'s multi-weekday guard cadence-aware. `activityShadowFromRule` writes `daysOfWeek` for every `week/1` rule (`adapters.ts:176-179`), and after B1b.5 an `interval >= 2` rule is single-weekday by construction (`isRuleComplete:279` forbids more). The shadow is provably faithful _for this predicate_ — record that refinement in R12 instead of converting the reader.

**B1b.4 — `linkableActivities`: CUT.** `activityStore.ts:618-620`'s ended-series skip reads `recurrenceEndDate`, a _faithful_ field, so converting it is an optimisation (short-circuiting an exhausted `afterCount` series before 13 `expandRecurring` calls), not a correctness fix. Out of scope; note it on the engine warm-start tracker instead.

**B1b.5 — Shadow honesty.** `activityShadowFromRule` maps any week rule with `interval !== 2` to `'weekly'` _with_ weekdays (`adapters.ts:173-180`). Map any `interval >= 2` to `'biweekly'` and drop `daysOfWeek`. This is a symptom of the fidelity contract, not a one-off bug fix — reference R12.

**B1b.6 — The list reset loop swallows write failures.** `listStore.ts:436-446` awaits `updateList` and ignores a `null` return: the reset is skipped, `lastResetDate` is not stamped, and this runs on background wake with no user present to see a toast. Add on the `null` branch:

```ts
logEvent({
  level: 'warn',
  surface: 'recurrence',
  message: 'list-reset-failed',
  context: { recur_surface: 'list', recur_outcome: 'write-failed' },
});
```

**B1.4 (Google sync window) is deliberately NOT done.** `activityInWindow` (`reconcilePlan.ts:79-86`) depends only on _faithful_ fields (`recurrence !== 'none'`, `recurrenceEndDate`), so making it rule-aware is a strict no-op that would cost a dependency edge from a deliberately-sealed pure hot-path module. Instead: add a **test asserting the shadow invariant** (`activityShadowFromRule` emits `recurrenceEndDate` iff `end.kind === 'onDate'`) and a one-line comment at `:79` pointing at the fidelity contract.

### Step B2 — ActivityModal adopts RecurrencePicker

- Replace the `FrequencyChips` recurrence row (`:924`), `DayOfWeekSelector` (`:925`) and ends-on `BeanieDatePicker` (`:952`) with `<RecurrencePicker v-model="rule" :start-date="seriesAnchor" />`. Retire `recurrenceOptions`/`buildRecurrenceOptions` (`:215-222`) and the multi-day-weekly-only disabled-chip hint, which the picker's model makes structurally impossible.
- **Carry the lifecycle bit in one place, not two.** A `RecurrenceRule` genuinely cannot express "does not recur", so something must hold that bit — but keeping the full `recurrence = ref<ActivityRecurrence>('weekly')` (`:114`) plus `lastRecurringKind` (`:231`) and its watcher (`:232-234`) beside the new `rule` ref is two independently-mutable representations of _cadence_, of which only one bit is load-bearing — the desync class of `docs/lessons.md` #13. Instead:
  - `const mode = ref<'one-off' | 'recurring'>('recurring')` replaces the `recurrence` ref (`:113`); `isRecurring` (`:116`) becomes `mode === 'recurring'`; the mode cards (script `:236-238`, template `:845-870`) set `mode` directly.
  - **Delete `lastRecurringKind` and its watcher.** Preserving the whole `rule` ref across a recurring → one-time → recurring round-trip is strictly better than remembering only the enum kind (which loses interval, weekdays and end).
  - `buildPayload` derives the enum **only at the boundary**: `recurrence: mode === 'one-off' ? 'none' : activityShadowFromRule(rule).recurrence`.
  - Document in `src/types/models.ts` beside `FamilyActivity.recurrence`: _once `rule` is present the only trustworthy bit here is `'none'` vs not; the specific kind is an inert shadow (see the fidelity contract)._
- **⚠️ Bind `:start-date` to the SERIES anchor, not the occurrence.** `ActivityModal.vue:277-278` deliberately seeds `date.value` from `props.occurrenceDate` for recurring activities (per `docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md`). Binding `<RecurrencePicker :start-date="date">` would anchor the rule on the _occurrence_ — so opening the **February** occurrence of a clamped "31st" series re-derives `monthlyDay = 28` and permanently reschedules the series on any save that emits `rule`. Step 0's clamp makes this newly reachable. Bind to `props.activity?.date ?? date`, or hold a separate `seriesAnchor` ref.
- **One re-anchor heuristic, not two.** `ActivityModal.vue:373-386`'s `date` watcher decides "untouched" by comparing `daysOfWeek` against the old start weekday (`:380-382`). Once Step 0 teaches the picker to re-anchor weekdays, **the picker owns re-anchoring** — delete the modal's watcher rather than porting it. Note `suppressDaysOfWeekSync` (`:390`, `:422-425`) is a modal-local flag and **cannot** suppress a watcher living inside `RecurrencePicker`; resolving the anchor binding above is what makes that suppression unnecessary, so it goes too.
- **Session counting lands here** (deferred from B1b.1): `allScheduleEnabled` (`:453`) becomes `isRecurring && rule.end.kind !== 'never'`, reflected in the reset watcher at `:471-478`; `totalSessions` (`:504-526`, early return at `:505`) is replaced by `occurrenceCount(rule, anchor)`. Side benefit: the current walk is already wrong for daily/biweekly/yearly (all fall into the months count at `:523-524`).
- **Layout**: `recurrenceEndDate`'s picker at `:952` sits in the _Date + Times_ `grid grid-cols-2` (`:947-954`). Removing it leaves a half-empty grid — collapse to a single full-width start-date field.
- **Preserve the per-open baseline diff** (`:402-415`) so an untouched legacy activity emits neither `rule` nor shadow (R7).
- **`OnboardingActivity.vue` keeps `DayOfWeekSelector`.** The full picker cannot fit the narrow `ob-days-col` beside two time pickers (`:260-264`), and it adds a five-decision widget to a first-run flow built around one decision. Its payload (`:101-102`) instead writes the canonical rule directly: `activityDays.length ? { unit:'week', interval:1, weekdays:[...activityDays], end:{kind:'never'} } : undefined`.
- **End of B2**: `format.ts`'s `formatActivityRecurrence` and `buildRecurrenceOptions` now have zero production callers. Move them to the test tree (`src/utils/__tests__/legacyRecurrenceLabels.ts`) or snapshot and delete — a string formatter is the weakest possible parity oracle and `@deprecated` code with no owner rots.

### Step C — Lists adopt the picker

- **Model**: add `cadence?: Cadence` to `FamilyList` (`models.ts:541-562`); `@deprecated` on `frequency`. Storing a bare `Cadence` is correct — a reset genuinely has no end.
- **`resolveListRule(list): Resolved`** — returns `{ rule: {...cadence, end:{kind:'never'}}, anchor }`, so the shim lives in exactly one place. `describe(rule, anchor)` (`useRecurrenceLabel.ts:20`) then serves both list label sites unchanged, `monthlyFactor` works, and `isResetDue` can take a rule and **drop its own internal shim** (`recurrenceEngine.ts:245`). **No `describeCadence` member** — `useRecurrenceLabel`'s docblock (`:14`) says it never grows a second summary generator.
  Returns `null` for a recurring list with neither `cadence` nor `frequency` — it must **not** default to weekly, or a list that never resets today would suddenly start. This subsumes the `!list.frequency` guard at `listLifecycle.ts:101`.
- **`listShadowFromCadence(cadence): ListFrequency`** — written alongside `cadence` on every save, because `FamilyList.frequency` is required for recurring lists (`models.ts:536`) and a pre-#70 client seeing none would never reset. **Shadow only exactly-expressible cadences; omit `frequency` otherwise.** A list reset is _destructive_ (`listStore.ts:428-446` clears `completed`/`completedBy`/`completedAt` on every item), so a wrong shadow makes a pre-#70 client destroy ticks with no undo. "Error toward the slower cadence" is unsatisfiable at the top end — `ListFrequency` (`models.ts:521`) has nothing slower than `'monthly'`, so `year` and `month/3` would saturate at `'monthly'` and **over-reset**, the exact outcome the rule exists to prevent. Instead: write `frequency` only for the three cadences the legacy enum expresses exactly (`day/1 → 'daily'`, `week/1 → 'weekly'`, `month/1 on day 1 → 'monthly'`) and **omit it otherwise**. An old client then never resets that list (`computeRecurringReset`'s `!list.frequency` guard, `listLifecycle.ts:101`) — the safe direction. This requires relaxing `models.ts:536`'s "frequency (required)" doc to "required unless the cadence is inexpressible in the legacy enum"; the `?? 'weekly'` default at `listStore.ts:394` is unaffected (it fires on a lifecycle flip, before any cadence exists).
- **Reset**: `computeRecurringReset` (`listLifecycle.ts:99-118`) delegates to `isResetDue`. **Anchor and cursor stay separate parameters**: `anchor = extractDatePart(list.createdAt)`, `cursor = lastResetDate`. Collapsing them re-anchors the cycle on every reset, so an every-2-weeks list drifts forward whenever the family doesn't open the app on the due day. `createdAt` reproduces all three legacy boundaries identically (daily/weekly-Monday/monthly-1st are anchor-independent, and `lastReset >= createdAt` always). Keep both guards: no `lastResetDate` → never resets; `!isRecurring` → never resets.
- **`setLifecycle` is a second `frequency` write path** (`listStore.ts:394`, `frequency: list.frequency ?? 'weekly'`) and will not write `cadence`. The `recurring` direction is safe because `resolveListRule`'s legacy mapping covers it (`weekly → week/1`). **The `oneoff` direction is not**: `:401-407` clears `frequency: undefined` but would leave `cadence` set, so a `recurring → oneoff → recurring` round-trip resurrects a stale cadence in preference to the `'weekly'` just written. **Clear `cadence: undefined` alongside `frequency: undefined`.**
- **UI**: `ListDetailModal.vue` — the picker replaces **only** the `freqOptions`/`FrequencyChips` block at `:409-414`. The one-off/recurring `TogglePillGroup` (`:403-407`) and `setLifecycle` are untouched. Drop the now-redundant `lists.detail.recurringHint` `<p>` at `:416-418` — the picker carries its own summary. **Pass the same anchor the engine uses**: `:start-date="extractDatePart(list.createdAt)"`, identical to what `isResetDue` and `describe` receive, or the picker derives its weekday/`monthlyDay` from a different date than the reset engine — the precise anchor-divergence B1a.1 exists to eliminate.
- **Labels — two sites**: `ListTile.vue:37-43` (tile pill) _and_ `ListDetailModal.vue:165-171` `recurrenceText`. Both route through `describe`. The tile pill is a compact chip: apply `truncate` + `:title`; do **not** write a second short-form formatter.

### Sequencing

Step 0 → B1a → B1b → B2 → C, each independently shippable and green. Phase A + Step 0 are the natural first deploy.

## Files Affected

**Step 0** — `src/services/recurrence/recurrenceEngine.ts`, `src/utils/calendar/recurrenceRrule.ts`, `src/components/ui/RecurrencePicker.vue`, `src/types/recurrence.ts`, `src/services/recurrence/adapters.ts` (comment), `src/services/translation/uiStrings.ts`; tests `recurrenceEngine.test.ts`, `recurrenceRrule.rule.test.ts`, `RecurrencePicker.test.ts`

**Step B1a** — `src/services/recurrence/adapters.ts` (converged resolvers, `default:` branches, header contract, `'last'` shadow normalize), `src/services/recurrence/recurrenceEngine.ts` (`occurrenceCount`), `src/stores/recurringStore.ts`, `src/utils/finance.ts`, `src/stores/activityStore.ts`, `src/stores/budgetStore.ts`, `src/components/planner/ActivityModal.vue`, `src/composables/useRecurrenceLabel.ts`, **plus the rename fallout**: `src/services/recurring/recurringProcessor.ts` (`:168,:217`), `src/components/transactions/TransactionModal.vue` (`:181-183`); tests `adapters.test.ts`, `finance.test.ts`, `entityLinking.test.ts`, `recurringStore.test.ts`, `budgetStore.test.ts`, `recurrenceRrule.rule.test.ts`

**Step B1b** — `src/components/planner/ActivityViewEditModal.vue`, `src/components/planner/ActivityListCard.vue`, `src/composables/useActivityScopeEdit.ts`, `src/stores/activityStore.ts`, `src/stores/listStore.ts`, `src/services/recurrence/adapters.ts`, `src/utils/calendar/reconcilePlan.ts` (comment only); tests `activityStore.test.ts`, `useActivityScopeEdit.test.ts`, `adapters.test.ts`

**Step B2** — `src/components/planner/ActivityModal.vue`, `src/components/onboarding/OnboardingActivity.vue`, `src/types/models.ts`, `src/utils/format.ts` (moved to test tree), `src/services/translation/uiStrings.ts`; tests `recurringOccurrenceRegression.test.ts`, `useActivityScopeEdit.test.ts`

**Step C** — `src/types/models.ts`, `src/services/recurrence/adapters.ts`, `src/services/recurrence/recurrenceEngine.ts` (`isResetDue` shim removal), `src/utils/listLifecycle.ts`, `src/stores/listStore.ts`, `src/components/lists/ListDetailModal.vue`, `src/components/lists/ListTile.vue`, `src/services/translation/uiStrings.ts`; tests `listLifecycle.test.ts`, `listStore.test.ts`

**All steps**: `npm run translate` after any `uiStrings.ts` change; `docs/STATUS.md` + `CHANGELOG.md` on push.

## Help Center Coverage

- **Action**: update existing
- **Category**: `features`
- **Slug**: the transactions/recurring-money article and the planner/activities recurrence article (the `recurring-schedules` how-to from the Phase A plan, if it landed)
- **Title**: "Setting up repeating money, plans, and lists"
- **Scope**: How to make anything repeat, that the same control appears on money, planner and lists, and how the schedule follows your start date.
- **Notes**: Must state that a monthly schedule on the 29th/30th/31st **uses the last day** in shorter months — both in beanies and in a synced Google Calendar — and that lists "reset" rather than create dated entries. Note that a paid activity's monthly estimate now reflects how often it actually happens.

## Observability Coverage

Surface: **`recurrence`**.

- **`rule-adapter-fallback`** (`warn`, `context: { recur_surface, recur_reason }`) — **the key new signal.** Specified in the Phase A plan but never given a call site; B1a.1 adds it as the `default:` branch of all three resolvers. This is the one place a stored value can fall outside the model, and the branch where money can still be computed on the old assumption — invisible from the UI.
- **`list-reset-failed`** (`warn`, `context: { recur_surface:'list', recur_outcome:'write-failed' }`) — B1b.6. A reset failing on background wake has no user present to see a toast.
- **`rule-materialized`** (`info`, `context: { recur_surface, recur_unit, recur_interval, recur_end }`) — the Phase A success-path counter, extended to `activity` and `list`. **Emit on persist (save) only — never on expand or reset-check**: `expandRecurring` runs per visible month per activity and `reconcileRecurringLists` runs on every app wake, so an expand-time emit would be a firehose.
- **`perfTiming.measureSync('recurrence.expand.activity', …, { perf_entity_count: dates.length })`** — instrument `expandRecurring`'s rule branch (`activityStore.ts:284-295`), the actually-hot caller. **Not** `totalSessions`, which is a bounded user-initiated modal computed that would never clear `TELEMETRY_FLOOR_MS = 250` (`perfTiming.ts:27`). `PerfContext` (`:31-36`) permits only `perf_doc_bytes`/`perf_entity_count`, so the surface goes in the label. `recurringProcessor.ts:96` already samples this — extend, don't parallel.
- **`expansion-failed`** (`reportError`, `severity:'error'`) — already exists at `recurringProcessor.ts:81-87`; replicate for the activity path. Non-critical: writes are validated by `isRuleComplete` first.
- **No `severity:'critical'` events.** Nothing here risks data loss.
- **No silent failures**: the resolver `default:` branches (B1a.1), the scope-edit missing-template guard (B1b.3) and the list-reset write failure (B1b.6) are the three this work closes.
- **Privacy / store gate — no action needed.** All keys already ship: `recur_surface`, `recur_unit`, `recur_interval`, `recur_end`, `recur_reason` (`src/utils/diagnosticContext.ts:287-291`), `recur_outcome` (`:277`), mirrored in `infrastructure/lambda/telemetry/index.mjs:199-203`. **No new context key, therefore no Lambda-mirror or store-declaration change.** `recur_end` logs only the discriminant.

## Acceptance Criteria

- [ ] A monthly rule on the 31st produces Jan 31, Feb 28, Mar 31, Apr 30 — no month skipped; leap February handled.
- [ ] `monthlyDay: 31` and `monthlyDay: 'last'` produce identical series across a 14-month span.
- [ ] The RRULE for a 29/30/31 monthly rule produces the **same date set as the engine** — no month missing from Google Calendar.
- [ ] The picker shows the clamp hint for a start date on the 29th/30th/31st and not otherwise, in the existing (renamed) hint node.
- [ ] A `per_session` fee on a **weekly** activity is unchanged to the cent; biweekly is halved; monthly is `feeAmount × 1`.
- [ ] The "all sessions" breakdown on a daily activity counts days, not months; a count-bounded series reports its real occurrence count.
- [ ] `budgetStore.upcomingTransactions` shows the correct next date for a rule-bearing weekly item.
- [ ] All three resolvers return `null` (never `undefined`) for a non-recurring or unrecognised entity and log `rule-adapter-fallback`; an unknown transaction `frequency` no longer resolves to daily in one place and monthly in another.
- [ ] A scope-edit date move with a missing template surfaces an error; `'this-only'` and `'this-and-future'` still work unchanged.
- [ ] A rule-bearing every-3-weeks activity displays, links and bills as every-3-weeks — not weekly.
- [ ] The shadow fidelity matrix test passes, and `reconcilePlan` remains free of engine/adapter imports.
- [ ] Every existing activity, transaction and list behaves identically after B1; legacy RRULE export unchanged.
- [ ] An existing legacy activity opened and saved **without touching its schedule** persists no `rule`.
- [ ] After B2 the modal holds exactly one cadence representation; `lastRecurringKind` is gone and the one-off path still works.
- [ ] Activities and lists render the same picker as transactions; lists say "Resets" and show no "ends"; onboarding keeps its day selector but writes a canonical rule.
- [ ] A legacy daily/weekly/monthly list resets on exactly the same day it would have before; lists with no `lastResetDate`, or with neither `cadence` nor `frequency`, still never reset.
- [ ] A list set to reset every 2 weeks does so **without drift** when the app isn't opened on the due day, and shadows to the next _slower_ legacy frequency.
- [ ] No legacy expansion or reset switch deleted; `normalizeToMonthly`'s switch and `format.ts`'s zero-caller helpers removed per the end-state table.
- [ ] All strings localized (`en` + `beanie`); `npm run translate` clean; no bare-string lint errors.
- [ ] Help Center article(s) updated; diagnostic logging implemented and verified; engine warm-start tracker filed.
- [ ] Release note drafted, in passive voice, covering **both** user-visible money changes: the per-session fee correction and the schedule change on an edited legacy 29–31 monthly transaction.

## Testing Plan

1. **Engine clamp goldens** — exact dates for `monthlyDay` 29/30/31 across short months, leap Februaries, and `interval >= 2`; `31 === 'last'` equivalence. Right and wrong answers must be different values (per `docs/lessons.md`, "Write the test so the right and wrong answers are different values").
2. **RRULE↔engine cross-check** — for `monthlyDay` 29/30/31 assert the serialized rule and the engine produce the same date set; assert `BYMONTHDAY=-1` for 31 and `BYMONTHDAY=28,29,30;BYSETPOS=-1` for 30.
3. **Fee parity table** — for each legacy recurrence kind assert the `monthlyOccurrences` path against a hand-computed value, pinning the **weekly** case to the _old literal value_ as the byte-identity proof. Migrate the per-session cases at `finance.test.ts:167-180` and `entityLinking.test.ts:112-160`. Do **not** mock `monthlyFactor` (per `docs/lessons.md`, "Mocking the collaborator hides the regression the collaborator would have caught").
4. **Activity parity** — for all 7 legacy `ActivityRecurrence` kinds assert `expandRecurring` output is unchanged by B1, including override children, `splitActivity`, "delete this and all future", and `recurrenceEndDate` applied at the right point. **If green for all 7, record it — this is the deletion trigger for the `expandRecurring` and `buildRecurrenceRule` legacy switches**, to be tracked as a follow-up.
5. **Shadow fidelity matrix** — for rules covering `week/1` multi-day, `week/3`, `month` by-date and by-weekday, `year`, and each end kind, assert exactly which shadow fields round-trip faithfully. This is what makes skipping `reconcilePlan` safe.
6. **Adapter symmetry** — all three resolvers return `null` for the non-recurring case and a non-null `{rule, anchor}` otherwise. Cheap, and it stops resolver #4 inventing a fourth convention.
7. **Minimal-diff proof (B2)** — open an edit on a legacy activity, change only the title, assert the emitted payload contains neither `rule` nor `recurrence`.
8. **List reset parity (C)** — assert the engine reproduces every legacy boundary exactly, including both never-reset guards. Include the created-Thursday / last-reset-Friday / checked-Monday fixture: under R9's `weekly → weekdays:[1]` mapping both paths correctly return **due**, so it is a _regression_ guard — it fails if someone maps `weekly → weekdays:[createdAt.getDay()]` instead of Monday. Add a drift case: an every-2-weeks list left unopened past its due day must not push its next reset forward.
9. **Picker re-anchoring** — changing the start date from a Monday to a Tuesday re-derives an untouched weekday set; a user-edited weekday set is left alone. Plus `legacyShadowFromRule({ monthlyDay: 'last' })` → `dayOfMonth: 31`.
10. **DST / timezone goldens** — month-end and week-interval math across a DST boundary with the injected clock.
11. **Manual** — mockup-parity walkthrough on transactions, activities and lists; beanie-mode string check; keyboard/focus and reduced-motion; iOS input-zoom on the stepper/date controls (≥16px focusable). On-device planner verification is owed for B2 (iOS is live-only).
12. `npm run build` (full rollup import graph) + type-check + lint + `npm run translate` before pushing any step.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the four-step plan (clamp fix → rule-aware readers → activity UI swap → lists), escalating the fee defect from dormant to live-in-production after verifying `calculateMonthlyFee`'s `per_session` branch assumes a weekly cadence for every activity, and establishing that `monthlyFactor`'s `WEEKS_PER_MONTH` is the same 52/12 constant so the weekly case is byte-identical.
- **Pass 2 (DRY + error handling)**: Caught that `BYMONTHDAY=N` skips short months so the Step 0 clamp must ship an RRULE clamp too or Google silently loses occurrences; deleted the proposed `resolveActivityCadence` (a `RecurrenceRule` already _is_ a `Cadence`), collapsed the dual fee formula and its unreachable `fee-cadence-unresolved` event into a single `monthlyOccurrences` path plus a real `default:` branch on the activity resolver (which today returns `undefined` silently), dropped the dead legacy walk and the engine import into the pure hot-path planner, reused the picker's existing hint node, closed three Step C gaps (missing list shadow, reset-anchor drift, a second label site) and kept the full picker out of onboarding; confirmed all `recur_*` telemetry keys already ship.
- **Pass 3 (Sustainability)**: Added a Representation End-State section giving every shadow and dual-path a named deletion trigger; converged the three drifting adapters onto one `Resolved = {rule, anchor} | null` signature (catching a live daily-vs-monthly fallback divergence between `adapters.ts:63` and `recurringStore.ts:53`); replaced case-by-case reader conversion with an explicit shadow-fidelity contract that deletes the `reconcilePlan` change and shrinks `linkableActivities`; removed B2's dual cadence state (`recurrence` enum + `lastRecurringKind` → a one-bit `mode` ref); dropped Step C's `describeCadence` shim by resolving lists to a full `end:'never'` rule; reversed `listShadowFromCadence`'s direction of error so an old client under-resets rather than destructively over-resets; added the live `budgetStore.upcomingTransactions` defect; and split B1 into B1a (fee correctness) / B1b (hardening) for revertability.
- **Pass 4 (Fresh-eyes sweep)**: Corrected the Context's central factual claim — the legacy `getNextDueDate` _does_ skip short months via `addMonths` overflow (verified by simulation: Jan 31 → Mar 31 → May 31), so the clamp is a deliberate behaviour change and R1 needs a rule-less carve-out plus a release-note item for edited legacy 29–31 transactions; caught that `RecurrencePicker` never re-anchors `weekdays` on a start-date change (a live Phase-A bug that would have made B2's watcher deletion a regression) and moved that fix into Step 0; flagged that binding the picker's `:start-date` to the occurrence-seeded `date` ref would silently reschedule a clamped monthly series on edit; narrowed B1b.3's guard to `scope === 'all'` (as written it still broke `'this-only'`/`'this-and-future'`); deferred session counting to B2 where the `rule` ref exists and gave `occurrenceCount` a HARD_CAP contract; added the resolver-rename fallout (`recurringProcessor`, `TransactionModal`, `useRecurrenceLabel`, the rrule test) and reused the existing `ResolvedRule` name; found `legacyShadowFromRule` mis-shadowing `monthlyDay:'last'` and `setLifecycle` leaving a stale `cadence` on a oneoff round-trip; replaced Step C's unsatisfiable "slower cadence" rule with "shadow only exactly-expressible cadences, else omit"; cut two scope-creep items (the cadence-aware multi-weekday guard, `linkableActivities`); and corrected three false doc citations.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-08-23, this session)

> let's continue implementation on #70 - previoously it was held due to the complexity to implemnt for activities and the nuance of using for lists in a different way than activities / transactions. please review the notes and updates and previuos status/context and propose the best way to move forward to complete the issue

### Follow-up 1 — decisions on the two open questions

> regarding (1) - if the question is, in the case of a user choosing 29th, 30th, 31st day of the month, and the month doesn't happen to have that day, I agree 100% to clamp it to the LAST day of the month. NEVER skip - that does not seem to ever be in line with the assumed intent of the user. The UI can make it clear (if one of these potentially missable) days is selected, that for months where that day does not exist, it'll happen on the last day of the month. does that make sense?
>
> for (2) i'm a bit confused - is this only for lists, and is the question just asked if we can leave off multiple weekdays for a weekly cadence? for example, lists can reset daily, weekly, monthly, etc, but not on every mon, and wed, for example? do i have that right, and what is the reason we need that limitation for lists? or do i have this compeltely wrong?

### Follow-up 2 — go-ahead

> yes, run /beanies-plan. once done proceed direct to implementation. once implementation is complete run /code-review max to review the code implemented.

</details>
