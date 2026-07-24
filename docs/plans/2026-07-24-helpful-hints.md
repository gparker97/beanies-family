# Plan: Helpful Hints — auto-generated to-do reminders for upcoming events

> Date: 2026-07-24
> Related issues: Notion tracker #40 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-07-24-helpful-hints.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the Prompt Log below.

## User Story

As a busy family member, I want the app to gently remind me of the obvious things to do before upcoming birthdays, parties, and trips — by dropping clearly-marked suggested to-dos into our list AND nudging me with a notification — so nothing important gets forgotten, while still being able to dismiss them, adjust or silence the notification, and tell them apart from tasks we added ourselves.

## Context

Families forget the obvious prep tied to upcoming events (buying a present, packing, sorting passports/visas). "Helpful Hints" proactively drops gentle, clearly-marked to-do items into the family to-do list ahead of these events, each carrying a notification nudge delivered through the #55 local-notifications framework we just shipped, so nothing slips even when the app is closed. Hints are easy to dismiss, always visually distinct from manual tasks, and governed from Settings → Reminders.

This builds directly on top of the #55 substrate. The critical architectural insight from codebase research: the OS-notification path (`useLocalNotifications` + `useScheduledReminders`) is **pull-based** — `reminderInput` (`useScheduledReminders.ts:397`) is a computed that pulls `todoStore.activeTodos`, and `buildTodoReminders` (`useScheduledReminders.ts:254`) schedules an OS notification for every active **dated** to-do, gated by `classifyAudience(...)` against the signed-in member. **Therefore a hint that is a dated to-do automatically gets a notification with zero new scheduling code.** We reuse the timed-to-do reminder path wholesale rather than build a parallel scheduler.

## Requirements

1. A helpful hint is a **family to-do item** (shared, in the family to-do list) that carries a notification, delivered via the existing #55 timed-to-do reminder path. No parallel scheduler.
2. **Settings → Reminders** gains two governance layers:
   - (a) A **master "Helpful Hints" on/off** — family-synced via the CRDT `Settings` doc, default **ON** — governing whether hint to-dos are generated for the family at all.
   - (b) **Per-hint-type toggles** — **per-device** (device-local `GlobalSettings`) — that **suppress only this device's owner's notification** for that hint type. The shared hint to-do still appears in the family list for everyone; other members' notifications are unaffected.
3. Hint to-dos are **visually differentiated** from manual to-dos (a hint tint + badge + "what's this?" explainer), consistent with the existing someday-lane treatment. Hints are **gentle** — never rendered in the alarming overdue-red state, and excluded from overdue/due-today nav badges.
4. **Hybrid lifecycle**:
   - **Ignored** hint → auto-expires (is removed) once its triggering **event** has passed.
   - **Acknowledged** hint → becomes a permanent normal to-do (editable/assignable/completable) but keeps a subtle, always-present "from a hint" marker so it stays distinguishable from a manual task; it is exempt from auto-expiry and from master-off cleanup.
5. Every hint carries an inline **"what's this?" explainer** (`InfoHintBadge` "?" pattern) describing what Helpful Hints are and why it appeared, linking to the Help Center article. One-tap **dismiss** (deletes the hint).
6. **The birthday person never sees their own present hint** — surprise-sensitive hints respect audience-based visibility (a hint is hidden from a viewer whom `classifyAudience` classifies as `hidden`).
7. **v1 triggers** (rule-based, no AI):
   1. **Member birthday −14d** → "buy a present / plan the party" — assigned to **adults only, EXCLUDING the birthday person**.
   2. **Birthday-party activity** (`category === 'birthday'`) **−2d** → "buy a present" — assigned to attendees.
   3. **Other 'Party'-group celebration** (`baby_shower/bar_mitzvah/graduation/wedding/other_celebration`) **−2d** → "buy a gift or card" — attendees.
   4. **Anniversary** (`category === 'anniversary'`) **−14d** → "plan something".
   5. **Trip −2d** (start date) → "start packing" — assigned to the travellers.
   6. **Trip −7d** (start date) → "check passports / visas / travel insurance" — travellers.
8. Gated behind a `helpfulHints` **dev feature flag** (registered in `flagRegistry.ts`, committed `false` in `featureFlags.committed.ts`); flag off → the app behaves exactly as today.
9. All user-visible copy through the i18n system (`uiStrings.ts`, `en` + `beanie`); a Help Center article ships in the same change.

## Important Notes & Caveats

- **Notification timing decision (load-bearing).** A hint to-do's `dueDate` is set to the **nudge date** (the −Nd trigger point), with `dueTime` defaulting to **09:00**, so the existing `buildTodoReminders` path fires the notification `todoReminderLead` (device default, 30 min) before 09:00 on the nudge day. This makes the notification fire at a genuinely useful lead time (e.g. 7 days before a trip for passports), while the actual **event date** is stored separately in `hintEventDate` for expiry and display. `dueDate = nudge date`, **not** event date, is deliberate — see Assumptions.
- **Contain the `dueDate`-overload behind the store, not scattered guards (sustainability).** Overloading `dueDate` to mean "nudge date" is the single riskiest coupling in this design: without containment, every getter that reads `activeTodos.dueDate` (overdue, due-today, scheduled, open) silently mis-treats a hint as a real dated task, and each is an independent spot a future edit can forget. The mitigation is structural, **not** a sprinkle of `&& !t.hintType`: introduce **one** `manualActiveTodos` base getter (`activeTodos` minus hints) and derive **all** non-hint lanes from it, so the hint/manual boundary is expressed exactly once (see To-do store). A single exported `isHint(todo)` predicate is the only place `!!t.hintType` is written. This keeps the clever reuse (zero new scheduler) without letting its cleverness leak across the codebase.
- **Every todo-consuming surface was audited for hint leakage — not just the todoStore's own lanes.** Fresh-eyes review found three consumers that read the _raw_ base collections and would therefore surface hints unless explicitly handled:
  - **Daily briefing / critical items** (`useCriticalItems.ts:254`) iterates raw `todoStore.activeTodos`. A hint's nudge-date `dueDate` is in the past for the whole lead window ⟹ `isTodoOverdue` true ⟹ the hint would appear in the briefing as an **overdue** critical item — directly violating "gentle, never overdue-red, excluded from attention surfaces." **Fix:** point `useCriticalItems` at `todoStore.manualActiveTodos`.
  - **Global search** (`GlobalSearch.vue:134`) iterates raw `todoStore.todos` with **no** audience filtering ⟹ an un-acknowledged hint (including a birthday person's own present hint) would be searchable, breaking surprise preservation. **Fix:** skip un-acknowledged hints in the search loop (`if (isHint(todo) && !todo.hintAcknowledged) continue;`). Acknowledged hints are real family to-dos and remain searchable exactly like any manual to-do (search has never applied audience filtering to manual to-dos — that pre-existing behaviour is left unchanged).
  - **Bean-tips heuristic** (`useBeanTips.ts:181`) uses `todoStore.todos.length` to decide "do you have any to-dos?" — auto-generated hints would falsely inflate that count and suppress an "empty list" tip. **Fix:** exclude un-acknowledged hints from the count feeding this heuristic.
  - Nook widgets (`NookTodoWidget`, `ScheduleCards`), the family-status toast (`FamilyStatusToast`), and the nav badges (`useNavBadges`) all read `filteredActiveTodos` / `overdueTodos` / `dueTodayTodos`, so they are covered automatically once those getters exclude hints (see To-do store) — **no per-surface change needed.**
  - **Data export** (`SettingsPage.vue handleExportAsJson`, the raw `projectionList('todos')` dump) deliberately **keeps** hints. It is a full-fidelity dump of the family's own data; hint markers (`hintType`/`hintKey`/`hintEventDate`/`hintAcknowledged`) are non-PII and the export applies no per-lane filtering to any collection. Special-casing hints out of the raw projection would contradict its "everything, verbatim" contract, so it is intentionally unchanged.
- **Hints are never "overdue-red."** Because `dueDate` is the nudge date, an ignored hint would otherwise render red for the whole lead window. This is prevented three ways: (a) the `isHint` branch in `TodoItemRow.containerClass` short-circuits **before** the overdue/due-today branches, so a hint always shows its gentle hint tint; (b) because overdue/due-today (and scheduled/open) derive from `manualActiveTodos`, hints are structurally absent from the nav-badge getters; (c) the daily briefing (`useCriticalItems`) reads `manualActiveTodos`, so hints never reach the briefing's own overdue/due-today classification either.
- **Persisted hint titles/descriptions go through i18n at generation time (injected translator).** The hint's `title`/`description` are stored as literal strings on the shared to-do (like any manual to-do title). To keep them out of hardcoded English, the pure engine receives an injected `translate: (key, params?) => string` in its `input` — supplied by the orchestrator from `useTranslation().t` — and builds every title/description through it (with member/event names interpolated as params). The engine stays fully pure and unit-testable (the translator is just an injected function; tests pass a fake). Consequences, all consistent with how shared to-dos already behave: the title is frozen in the **generating device's locale** at creation (a manual to-do typed by an English speaker is likewise English for everyone), and the OS notification body — built from that title — is in the generator's locale, not the recipient's. This is inherent to shared-todo + per-device-notification and is not new to hints; single-locale families never notice. Crucially, `hintKey` is **locale-independent** (`${hintType}:${scopeId}:${eventDateISO}`), so a locale change causes **no** reconcile churn and **no** duplicate hints — titles differing across devices never affect the desired/existing diff. Both `en` and `beanie` must carry the hint **title/description** keys, not only the badge/settings copy.
- **No reconcile↔reschedule loop (verified).** The reconcile watcher observes `[useToday().today, familyStore.humans, activityStore.activeActivities, vacationStore.upcomingVacations, settingsStore.helpfulHintsEnabled]` — it does **not** observe `todoStore.todos`. Creating a hint to-do mutates `todos` → `activeTodos` → `reminderInput` → the _reminder_ watcher reschedules OS notifications; that path writes no store the reconcile watcher observes, so the flow is strictly one-directional (reconcile → create todo → reschedule notification, terminating). Reconcile is additionally idempotent (creates only when no existing hint shares the `hintKey`) and debounced (1000 ms), so even a spurious re-entry is a no-op. This absence-of-loop is an explicit invariant covered by a store/orchestrator test.
- **Shared to-do, per-device notification.** Generation of the hint to-do is a family-level decision (the master switch, CRDT-synced). Whichever device runs the reconcile first creates the shared to-do; it syncs to all. Notification _delivery_ is per-device: the device-local per-type toggle suppresses only that device's owner's notification, and the todo remains visible to all.
- **Master-off cleanup converges under CRDT (verified race analysis).** When the family-synced master flips off, the reconcile's first branch removes all un-acknowledged, un-completed hints and returns before any generation. Cross-device, the master flag propagates on its own sync latency: a device that has not yet received `helpfulHintsEnabled = false` may briefly re-create a hint another device just deleted, but because generation is idempotent-by-`hintKey` and each device's guard returns early the instant the flag arrives, the system **converges** — the transient recreate is harmless and self-heals. The only genuinely lossy edge is a master-off cleanup racing a concurrent _acknowledge_ on another device within the sync window (Automerge resolves the delete-vs-field-update in favour of the delete); this requires a deliberate, rare master-off to coincide with an acknowledge to the millisecond and is accepted as negligible rather than guarded with extra machinery.
- **Surprise preservation requires new visibility filtering for hints only.** Today the to-do list applies a member _filter_ (a page lens) but no access control — everyone can see all to-dos. Hints are the first to-dos with genuine per-member visibility: the hint getter filters out hints for which `classifyAudience(assignees, viewer, resolveMember).kind === 'hidden'`. **Existing (non-hint) to-dos are untouched** — no behaviour change, full backward compat.
- **Single source of truth for "who".** A hint's `assigneeIds` = the resolved audience. `classifyAudience` then drives BOTH list visibility (the getter) AND baseline notification eligibility (`buildTodoReminders` already gates hidden-audience todos). The per-device per-type toggle is an **additional** device-local gate on top (you're an assignee, you see the todo, but you muted this hint type on this device → no notification for you).
- **De-dup must survive CRDT merge.** Two devices may both generate the same hint before syncing → two to-dos with the same `hintKey` but different UUIDs. Mirror the recurring-transaction precedent (`transactionsStore.ts:37` dedups by `recurringItemId|date`): the hint getter dedups by `hintKey` (keep earliest `createdAt`), and the reconcile checks "already present by `hintKey`" before creating (narrows the race window).
- **`hintKey` is opaque — build once, compare by equality, never parse.** The key format `${hintType}:${scopeId}:${eventDateISO}` is produced by a single `buildHintKey(...)` helper and only ever compared for equality (dedup, "already present", "still desired"). Nothing downstream splits it back apart — so the format can change without a codebase-wide grep. `scopeId`/`eventDate` that reconcile needs live as first-class fields on `DesiredHint`/`TodoItem` (`hintEventDate`), not as substrings to be re-parsed.
- **Use `useToday()`, never `new Date()`.** All date math uses the reactive `useToday()` singleton + `src/utils/date.ts` helpers. Note `getNextBirthday` (`MilestonesCard.vue:63`) and `daysUntilTrip` (`vacation.ts:360`) both read `new Date()` directly and are **not** reused — the hint engine computes birthdays/trip-deltas fresh against `useToday().today`. Also `toISODateString` (`date.ts:22`) is full **UTC** ISO — use `toDateInputValue`/`localToday` for local date-only strings/keys.
- **Party-group membership is derived, not hardcoded.** Test group membership via `ACTIVITY_GROUP_MAP[activity.category] === 'Party'` (`src/constants/activityCategories.ts:273` — note: `constants/`, not `config/`), never a hardcoded id list. Triggers 2/3/4 partition the Party group by lead: `birthday` (−2d), `anniversary` (−14d), everything else in the group (−2d).
- **Adult/child is `ageGroup`/`role`-based, not DOB-based.** Reuse `isAdultMember(member)` (`useMemberInfo.ts:46`): `!isPet && (role === 'owner' || ageGroup === 'adult')`. `dateOfBirth` is only used to detect the upcoming birthday date (month/day; year optional).
- **All-day vs timed to-dos in the reminder path.** `buildTodoReminders` treats a todo with no `dueTime` as an all-day 09:00 anchor (no lead); a todo with `dueTime` applies `todoReminderLead`. Hints set `dueTime = '09:00'` so the device default lead applies — matching greg's "default lead from settings."
- **Reuse the existing occurrence assembler for activities.** The engine does **not** introduce a new activity getter. It reuses `assembleOccurrencesByDate(activityStore.activeActivitiesForMonth, start, end)` (`occurrenceAssembly.ts:33`) over a 14-day forward window — exactly the source `reminderInput` already feeds the reminder builders — so recurring-activity expansion, one-off overrides, and invalid-date handling are shared, not re-derived.
- **`gated`, not `skipped`, for the per-type mute.** In `buildTodoReminders` a hidden-audience drop increments `gated` (an EXPECTED rule-drop) while a thrown error increments `skipped` (a data bug). The new device-local per-type suppression is a rule-drop → it increments the existing `gated` counter (surfaced as `notif_gated`), matching the hidden-audience branch it sits beside. This is the **only** hint-awareness in the generic builder: a single early guard keyed on the `hintType` marker + a device pref — no hint-domain logic leaks into the shared reminder path.
- **Do NOT conflate with existing nudge systems.** Keep distinct from `useBeanTips`, `useCommunityNudge`, `computeTimelineHints`, `useInstallNudge`, and the in-app "bell" `tip` kind. Helpful Hints are to-do items, not bell notifications.

## Assumptions

> **Review these before implementation.** Valid at planning time; confirm with greg.

1. **`dueDate` = the nudge date (−Nd), not the event date.** This is what makes the notification fire at a useful lead time through the existing todo-reminder path, and keeps hints out of overdue-red. The real event date lives in `hintEventDate` (shown in the hint's title/description, used for expiry). _If greg prefers `dueDate` = event date, the notification would fire only morning-of the event (too late for passports/packing) — so the nudge-date model is recommended._
2. **Render location: a dedicated "Helpful Hints" section at the top of the to-do list** (guarded `v-if hints exist`), rather than interleaving hints into Open Tasks. This is the open question from intake; the dedicated section is the recommended default (clear differentiation, easy to find, easy to collapse). Greg to confirm.
3. **Trip-documents hint (−7d) applies to ALL trips**, worded around passports/visas/travel insurance, since international detection isn't reliably modeled today.
4. **"Acknowledge" is an explicit one-tap "keep" action** on the hint (distinct from dismiss). Completing a hint also counts as acknowledged (it becomes a completed to-do and is never auto-expired). Ignoring = doing nothing → auto-expires after the event.
5. **The master switch, when turned OFF, removes existing un-acknowledged, un-completed hint to-dos** (satisfying "OFF → no hints generated or shown"). Acknowledged/completed hints persist (they're now the family's own to-dos).
6. **Hints are assigned but not "duty" items** — they use `assigneeIds` only (no dropoff/pickup roles).
7. **Persisted hint copy is frozen in the generating device's locale** (like any shared manual to-do title, and the notification built from it). Acceptable for single-locale families; a full render-time re-translation of shared to-do titles is out of scope and would require reworking every todo-rendering surface. Greg to confirm this is acceptable for v1.

## Approach

### Data model (`src/types/models.ts`)

Add to `TodoItem` (all optional — schemaless Automerge, no migration; mirrors the `Transaction.recurringItemId` auto-generated-marker precedent):

```ts
// Helpful Hints (#40) — present only on auto-generated hint to-dos; absent on manual to-dos.
hintType?: HelpfulHintType;        // marker + type; presence ⟹ this is a hint
hintKey?: string;                  // stable dedup key, survives CRDT merge: `${hintType}:${scopeId}:${eventDateISO}`
hintEventDate?: ISODateString;     // the real event date (birthday/party/trip start) — for expiry + display
hintAcknowledged?: boolean;        // true once the user "keeps" it → permanent, exempt from expiry/master-off cleanup
```

```ts
export type HelpfulHintType =
  | 'birthday-present' // member birthday −14d, adults excl. birthday person
  | 'birthday-party-gift' // 'birthday' activity −2d, attendees
  | 'celebration-gift' // other Party-group −2d, attendees
  | 'anniversary-plan' // 'anniversary' −14d
  | 'trip-packing' // trip −2d, travellers
  | 'trip-documents'; // trip −7d, travellers
```

Add to `Settings` (family-synced): `helpfulHintsEnabled?: boolean;` (default via reader coalescing `?? true`, mirroring `calendarClashNudgeEnabled` at `models.ts:1421`).

Add to `GlobalSettings` (device-local): `helpfulHintNotifyByType?: Partial<Record<HelpfulHintType, boolean>>;` (absent key ⟹ enabled; only stores explicit `false` overrides).

### Pure engine (`src/utils/helpfulHints.ts` — new, fully unit-tested)

Keep all trigger logic pure and side-effect-free so it is exhaustively testable and holds no store/Vue refs. The one concession to i18n is an **injected** `translate` function passed in `input` — a plain `(key, params?) => string`, not a Vue/composable reference — so titles/descriptions are localized at generation time while the engine stays fully pure and testable with a fake translator.

**Structure the engine around its three real input shapes, not a forced-uniform rule table.** The six triggers do not share one iteration shape — birthdays iterate `members`, four triggers iterate assembled activity `occurrences`, two iterate `vacations`. A single flat `HINT_RULES[type] = { leadDays, buildFor(input) }` table would make every rule reach into a different slice of `input` behind a uniform signature — a leaky abstraction that is harder to follow than explicit code and invites `input`-shaped coupling. Instead:

- **`HINT_LEAD_DAYS: Record<HelpfulHintType, number>`** — the one piece that genuinely is pure data (14/2/2/14/2/7). Lives as a table so lead tuning is a one-line data edit.
- **Three small, explicit source functions**, each `(input) => DesiredHint[]`, each owning exactly one loop and its skip rules:
  - `birthdayHints(input)` — for each human member with `dateOfBirth`, compute next birthday (month/day vs `today`, year-agnostic); if `daysBetween(today, birthday) <= HINT_LEAD_DAYS['birthday-present'] && >= 0`, emit `birthday-present` assigned to `members.filter(m => isAdultMember(m) && !m.isPet && m.id !== member.id)`. Skip if no eligible adults (degrade gracefully — no hint; emit a `no-eligible-adults`/`out-of-window` debug reason).
  - `activityHints(input)` — consume the assembled upcoming occurrences. For each occurrence within its rule's lead window and `>= today`: `birthday` → `birthday-party-gift`; `anniversary` → `anniversary-plan`; other `Party`-group (`ACTIVITY_GROUP_MAP[category] === 'Party'`) → `celebration-gift`; anything else → skip. Assign `normalizeAssignees(activity)`. Skip occurrences with no attendees. The category→type mapping is a small local `switch`/lookup — the honest shape of this decision, kept in one function.
  - `tripHints(input)` — for each `vacationStore.upcomingVacations` with a `startDate`, compute `daysBetween(today, startDate)`; at `<= 2` emit `trip-packing`, at `<= 7` emit `trip-documents`; assignees = `vacation.assigneeIds`. Skip trips with no `startDate` or no travellers.
- **`computeDesiredHints(input): { hints: DesiredHint[]; skipped: number }`** where `input = { today, members, occurrences, vacations, resolveMember, translate }` and `DesiredHint = { hintType, hintKey, title, description, assigneeIds, nudgeDate, eventDate, scopeId }`. `title`/`description` are built via `input.translate(...)` (member/event names passed as params). `occurrences` is the output of the shared `assembleOccurrencesByDate` assembler (see orchestrator) — the engine does NOT re-expand recurrences. `computeDesiredHints` is a thin composition: it concatenates the three source functions, threading one shared `skipped` tally. It:
  - **Per-item error isolation (no silent all-or-nothing).** Mirroring `buildTodoReminders`/`buildTravelReminders`, each member / occurrence / vacation is processed inside its own `try/catch` **within its source function**; a single malformed record is counted (the `skipped` tally) and skipped, never allowed to throw out of the whole computation — one bad record never suppresses every other hint.
  - `hintKey = buildHintKey(hintType, scopeId, eventDateISO)` where `scopeId` = memberId (birthday) / activityId (activity) / vacationId (trip). One occurrence ⟹ one stable, **locale-independent** key ⟹ idempotent across reloads/devices/locales. `buildHintKey` is the single producer of the format; nothing parses it back.
  - `nudgeDate = addDaysYmd(eventDate, -HINT_LEAD_DAYS[hintType])` clamped to `>= today` (if we're already inside the window, nudge date = today so it fires now).
- **`reconcileHints(desired, existingHints, today)`**: returns `{ toCreate, toRemove }` — the desired-vs-existing diff (add missing by `hintKey`; remove existing un-acknowledged, un-completed hints whose `hintEventDate < today` (expiry) OR whose `hintKey` is no longer desired (stale — source event deleted/moved)). Diffing is purely by `hintKey` + lifecycle flags, never by title, so locale differences in persisted titles cause no churn. This mirrors the notification `reconcileScheduled` desired/stale pattern.
- **`dedupeHintsByKey(hints)`**: keep earliest `createdAt` per `hintKey` (the CRDT-merge collision resolver, mirroring `transactionsStore.ts:37`).
- **`isHint(todo): todo is TodoItem & { hintType: HelpfulHintType }`**: the single exported predicate (`!!todo.hintType`) — the _only_ place that literal check is written. Consumed by the store, the row, the page, the search/briefing/bean-tips consumers, and the reminder gate so "what counts as a hint" has one definition.

### Orchestrator (`src/composables/useHelpfulHints.ts` — new; MVO orchestrator)

Initialized **once** in `App.vue` setup (alongside `useLocalNotifications()`, `App.vue:1315`). No-op unless `isFlagEnabled('helpfulHints')`.

- Reactively watches `[useToday().today, familyStore.humans, activityStore.activeActivities, vacationStore.upcomingVacations, settingsStore.helpfulHintsEnabled]`, **debounced** (reuse the 1000 ms debounce idiom from `useLocalNotifications`), and also runs once on family-doc-ready. It deliberately does **not** watch `todoStore.todos`, guaranteeing no reconcile↔reschedule loop (see Caveats).
- Obtains `translate` from `useTranslation().t` and threads it into `input`, so hint copy is localized at generation time.
- Guard: if the family doc isn't loaded (no `currentMember`) → return (mirrors the `runRescheduleFor` null-guard so we never reconcile against an empty world).
- `reconcile()` — **the entire body runs inside one `try/catch`.** A watcher whose effect throws stops re-running; a thrown reconcile would therefore silently disable all future hint generation. On any throw, `reportError({ surface: 'helpful-hints', severity: 'error', message: 'reconcile failed', error })` and return — the watcher survives and retries on the next input change. No bare `catch {}` anywhere.
  1. If flag off → return. If `settingsStore.helpfulHintsEnabled === false` → remove all un-acknowledged, un-completed hints; return.
  2. Assemble the 14-day occurrence window via `assembleOccurrencesByDate(activityStore.activeActivitiesForMonth, start, end)` (the same call `reminderInput` makes), build `input`, call `computeDesiredHints` (logging its `skipped` tally), read existing hints (`todoStore.hintTodos`), call `reconcileHints`.
  3. For each `toCreate`: `todoStore.createTodo({ title, description, assigneeIds, dueDate: nudgeDate, dueTime: '09:00', hintType, hintKey, hintEventDate, ... })` **only if** no existing hint has that `hintKey` (final race guard).
  4. For each `toRemove`: `todoStore.deleteTodo(id)`.
  - Every branch and outcome emits telemetry (see Observability Coverage). All `createTodo`/`deleteTodo` calls are already `wrapAsync`-guarded in the store (toast + telemetry on failure); the composable additionally logs the reconcile outcome counts and the engine's per-record `skipped` tally.

The orchestrator holds **no** business rules — it is purely: guard → assemble inputs (incl. injecting `translate`) → call the pure engine → apply the diff via existing store actions → emit telemetry. All "which trigger, what window, who, what wording" logic lives in the pure engine; all writes go through existing store actions. This keeps the effectful surface tiny and the testable surface large.

### To-do store (`src/stores/todoStore.ts`)

**Centralize the hint/manual split in one getter** rather than scattering `!t.hintType` across every derived lane (a naive approach would touch four predicates independently and still miss `scheduledTodos`, and would not reach the raw-`activeTodos`/`todos` consumers outside the store). Concretely:

- `manualActiveTodos` computed: `activeTodos.filter((t) => !isHint(t))` — the single boundary between auto-generated hints and the family's own tasks.
- **Re-base all existing non-hint attention lanes on `manualActiveTodos`**: `overdueTodos`, `dueTodayTodos`, `scheduledTodos`, `undatedTodos` derive from `manualActiveTodos` (not raw `activeTodos`). For the member-filtered feed, `filteredActiveTodos` derives from `filteredTodos` (not from `activeTodos`), so its hint exclusion is added at that one point — `filteredActiveTodos = filteredTodos.filter(t => !t.completed && !t.someday && !isHint(t))` — and its children `filteredScheduledTodos`/`filteredUndatedTodos` inherit the exclusion for free. Result: hints are structurally excluded from every attention/nav/open surface (and every Nook widget/status-toast that reads `filteredActiveTodos`) in exactly two source getters, and any getter added later that builds on `manualActiveTodos`/`filteredActiveTodos` inherits the exclusion. (`somedayTodos`/`completedTodos` are unaffected — hints are never someday and a completed hint is deliberately a normal completed task.)
- `hintTodos` computed: `activeTodos.filter(isHint)`, then `dedupeHintsByKey` — the _only_ getter that surfaces hints. (`activeTodos` itself is left **unchanged** so `reminderInput`/`buildTodoReminders` still sees hints and schedules their notifications.)
- `visibleHintTodos(viewer)` — a `useTranslation`-free helper consumed by the page — filters `hintTodos` by `classifyAudience(normalizeAssignees(t), viewer, resolveMember).kind !== 'hidden'` (surprise preservation), reusing the exact classifier the reminder path uses.
- `acknowledgeHint(id)` → `updateTodo(id, { hintAcknowledged: true })` (reuses `updateTodo`'s `wrapAsync` error contract — not a new write path).

This is a small refactor of existing getters (swap their source to the hint-free base), fully covered by the existing todoStore test suite plus the new hint-exclusion assertions — so the re-base is verified, not assumed.

### Off-store consumers that read raw collections (`useCriticalItems`, `GlobalSearch`, `useBeanTips`)

These three read the raw base collections directly and cannot inherit the store re-base, so each gets a single, explicit hint-aware line (all keyed on the shared `isHint` predicate — no new hint concepts):

- **`src/composables/useCriticalItems.ts`** — change the daily-briefing loop at line 254 to iterate `todoStore.manualActiveTodos` instead of `todoStore.activeTodos`. This keeps hints out of the briefing's overdue/due-today classification (they must never appear there) while preserving the composable's own audience filtering for manual to-dos.
- **`src/components/common/GlobalSearch.vue`** — in the todo loop (line 134), `if (isHint(todo) && !todo.hintAcknowledged) continue;` before matching. Un-acknowledged hints (including surprise-sensitive present hints) are excluded from search; acknowledged hints are real to-dos and remain searchable exactly like manual ones.
- **`src/composables/useBeanTips.ts`** — the `todoCount` at line 181 excludes un-acknowledged hints so auto-generated suggestions don't skew the "do you have any to-dos?" tip heuristic.

### Reminder gate (`src/composables/useScheduledReminders.ts`, `buildTodoReminders`)

Add a device-local per-type suppression gate: when a todo `isHint(todo)`, skip scheduling its notification if `prefs.helpfulHintNotifyByType?.[todo.hintType] === false`, incrementing the existing **`gated`** counter (a rule-drop, exactly like the adjacent hidden-audience branch) and surfacing a `notif_gated` reason. This is the ONLY reminder-path change — audience gating (`classifyAudience` hidden) is already there. `helpfulHintNotifyByType` is threaded through **`ReminderPrefs`** (a device pref, alongside `todoReminderLead`), sourced from `settingsStore` in the `prefs` computed — NOT through `ReminderInput`, keeping the device/family split clean. The gate is a single early `continue` keyed on the `isHint` marker; no other hint knowledge enters the shared builder.

### UI

- **`TodoItemRow.vue`**: `isHintRow = isHint(props.todo)` (the store's predicate). Add an `isHint` early-return branch in `containerClass` **before** overdue/due-today (a gentle hint tint — a Heritage-Orange-adjacent warm wash or the theme's Terracotta/warm tint per the CIG; **not** red). Add a hint badge + `<InfoHintBadge :text="t('todo.hint.whatsThis')" :link="{ text: t('todo.hint.learnMore'), href: '<help article url>' }" />` in the metadata row (using `InfoHintBadge`'s verified `{ text, link: { text, href } }` prop shape), and the "keep" (acknowledge) + one-tap dismiss affordances. Emoji prefix marker for the hint (aria-hidden).
- **`TodoSection.vue`**: reuse as-is (verified: it already takes `label`/`emoji`/`labelClass` props and a `#hint` slot).
- **`FamilyTodoPage.vue`**: add a dedicated `<TodoSection>` for hints at the top (guarded `v-if displayedHintTodos.length`), fed by `displayedHintTodos` (= `withMemberFilterAndSort` over `visibleHintTodos(currentMember)`). The Open section's feed already excludes hints automatically because it draws from `filteredActiveTodos` (no page-level filtering needed — the exclusion lives in the store).
- **`RemindersSettings.vue`**: add a "Helpful Hints" block inside the existing Reminders drawer — the family-synced master `SettingToggleRow` (bound to `settingsStore.helpfulHintsEnabled`, optimistic-revert pattern like `setCalendarClashNudgeEnabled`), an `InfoHintBadge` explainer, and, when the master is on, the per-type device-local toggles (bound to `helpfulHintNotifyByType`, one row per `HelpfulHintType`, default on). Reuse `SettingToggleRow` (verified `modelValue` + `update:modelValue` contract) for every row — no bespoke toggle markup. The per-type rows render by mapping over a single `HINT_TYPE_META` table (type → label key + emoji), so "the list of hint types" has one source of truth shared with the engine. Copy explains: master = whole family; per-type = "silence my notifications on this device."

### Settings plumbing

- **`settingsStore.ts`**: `helpfulHintsEnabled` getter (`?? true`) + `setHelpfulHintsEnabled` action via `persistAiSetting('settings.helpfulHints.label', 'helpfulHintsEnabled', () => settingsRepo.setHelpfulHintsEnabled(v))` (family-synced, report-on-failure — the `calendarClashNudgeEnabled` chain). Device-local `helpfulHintNotifyByType` getter + `setHelpfulHintNotifyType(type, enabled)` via `persistGlobalSetting('reminders.title', 'helpfulHintNotifyByType', { ...current, [type]: enabled })` (mirrors `setTravelReminderLead`'s map-merge at `settingsStore.ts:506`). Both reuse the shared report-on-failure wrappers — no new error path.
- **`settingsRepository.ts`**: `setHelpfulHintsEnabled(enabled)` → `saveSettings({ helpfulHintsEnabled: enabled })` (no `docOps` change — the singleton `setSettings` op carries any new field), matching `setCalendarClashNudgeEnabled` at `settingsRepository.ts:111` one-for-one.

### Feature flag

- `flagRegistry.ts`: add `{ id: 'helpfulHints', label: 'Helpful Hints', description: 'Auto-generated to-do reminders for upcoming events.' }` to `FLAG_REGISTRY` (verified shape: `{ id, label, description }`).
- `featureFlags.committed.ts`: add `helpfulHints: false`. Surfaces automatically in Settings → Feature Flags (`DevFeatureFlagsCard` is generic).

## Files Affected

- `src/types/models.ts` — `TodoItem` hint fields, `HelpfulHintType`, `Settings.helpfulHintsEnabled`, `GlobalSettings.helpfulHintNotifyByType`.
- `src/utils/helpfulHints.ts` — **new**, pure engine (`HINT_LEAD_DAYS` data map, `HINT_TYPE_META`, three explicit source functions, `computeDesiredHints` returning `{ hints, skipped }` and taking an injected `translate`, `reconcileHints`, `dedupeHintsByKey`, `buildHintKey`, `isHint`). Consumes the shared `assembleOccurrencesByDate` output; does not re-expand recurrences.
- `src/composables/useHelpfulHints.ts` — **new**, reactive orchestrator (init in `App.vue`; whole-body try/catch → reportError; holds no rules; reuses `assembleOccurrencesByDate` + the 1000 ms debounce idiom; injects `useTranslation().t`; does not watch `todos`).
- `src/App.vue` — init `useHelpfulHints()` once.
- `src/stores/todoStore.ts` — `manualActiveTodos` (new base), re-base overdue/due-today/scheduled/undated onto it and add `!isHint` to `filteredActiveTodos`, `hintTodos`, `visibleHintTodos`, `acknowledgeHint`.
- `src/composables/useCriticalItems.ts` — daily-briefing loop reads `manualActiveTodos` (hint-leak fix).
- `src/components/common/GlobalSearch.vue` — skip un-acknowledged hints in the todo search loop (leak + surprise fix).
- `src/composables/useBeanTips.ts` — hint-free `todoCount` heuristic.
- `src/composables/useScheduledReminders.ts` — device-local per-type notification suppression gate in `buildTodoReminders` (increments `gated`); `helpfulHintNotifyByType` added to `ReminderPrefs` + the `prefs` computed.
- `src/components/todo/TodoItemRow.vue` — hint tint/badge/explainer/keep/dismiss.
- `src/pages/FamilyTodoPage.vue` — dedicated Helpful Hints `<TodoSection>` + `displayedHintTodos` (Open feed already hint-free via the store).
- `src/components/settings/RemindersSettings.vue` — master + per-type toggles + explainer (all via `SettingToggleRow`, per-type rows mapped over `HINT_TYPE_META`).
- `src/stores/settingsStore.ts` — `helpfulHintsEnabled` (synced) + `helpfulHintNotifyByType` (device) getters/setters.
- `src/services/automerge/repositories/settingsRepository.ts` — `setHelpfulHintsEnabled`.
- `src/config/flagRegistry.ts`, `src/config/featureFlags.committed.ts` — `helpfulHints` flag.
- `src/services/translation/uiStrings.ts` — all `todo.hint.*` (incl. per-type **title/description** keys), `settings.helpfulHints.*`, and per-type meta label keys (`en` + `beanie`).
- Help Center article source (`src/content/help/features.ts` or equivalent) — new `helpful-hints` article.
- Tests: `src/utils/__tests__/helpfulHints.test.ts` (new), `src/stores/__tests__/todoStore.*` (hint getters/dedup/visibility + manual-lane exclusion + no-loop invariant), `src/composables/__tests__/useScheduledReminders.*` (per-type suppression gate), `src/composables/__tests__/useCriticalItems.*` (briefing excludes hints).

> **Deliberately unchanged:** `src/pages/SettingsPage.vue` data export (`handleExportAsJson`) — the raw `todos` projection intentionally includes hints (own data, non-PII markers, full-fidelity dump).

## Help Center Coverage

- **Action**: `new article`
- **Category**: `features`
- **Article type**: `explainer` (with a short how-to on turning hints on/off)
- **Slug**: `helpful-hints`
- **Title**: "Helpful Hints — gentle reminders before the things that matter"
- **Scope**: What Helpful Hints are (auto-suggested to-dos before birthdays, parties, anniversaries, and trips), how to tell them apart from your own to-dos, how to keep or dismiss one, and how to control them in Settings → Reminders (the family master switch vs the per-type notification toggles that only affect your device). Written from the user's point of view.
- **Notes**: Call out that (1) turning the master off removes un-kept hints family-wide; (2) the birthday person never sees their own present hint; (3) per-type toggles only silence _your_ notifications, they don't remove the shared to-do. The `InfoHintBadge` "what's this?" on each hint links here.

Written per `.claude/skills/beanies-help-docs/SKILL.md`, shipped in the same change (acceptance criterion, not a follow-up).

## Observability Coverage

Surface: **`helpful-hints`** (kebab-case, greppable).

- **Reconcile outcome (success path, every run)** — `logEvent({ level: 'info', surface: 'helpful-hints', message: 'reconcile', context: { hint_generated, hint_expired, hint_pruned_stale, hint_total, hint_skipped_records, hint_master_on, hint_flag_on } })`. Emitting counts on the success path makes _rates_ measurable for future alerting (e.g. "generation fell to zero"). `hint_skipped_records` carries the engine's per-record error tally so a data bug that silently drops one record is visible without a local repro. Below the `TELEMETRY_FLOOR_MS` concern — this is a count event, not a perf timing.
- **Per-trigger skip reasons (debug)** — `logEvent({ level: 'debug', surface: 'helpful-hints', message: 'trigger skipped', context: { hint_type, hint_reason } })` where `hint_reason ∈ no-dob | no-start-date | no-attendees | no-eligible-adults | out-of-window | malformed-record`. This is what lets us answer "why didn't I get a hint for X?" from CloudWatch alone.
- **Reconcile failure (whole-run)** — the orchestrator's outer `try/catch` calls `reportError({ surface: 'helpful-hints', severity: 'error', message: 'reconcile failed', error })` so a thrown reconcile (which would otherwise silently kill the watcher) is always surfaced. Severity is **`error`, not `critical`** — a missing/lingering hint is a degraded nudge, not user-action-failed or data-at-risk.
- **Generation/removal failure (per-op)** — a failed `createTodo`/`deleteTodo` inside reconcile is already toasted+logged by the store's `wrapAsync`; the composable additionally `reportError({ surface: 'helpful-hints', severity: 'error', context: { hint_type, hint_op } })`. No bare `catch {}`.
- **Notification suppression** — `buildTodoReminders` emits the existing reschedule telemetry; the per-type skip increments the existing `gated` counter and adds a `notif_gated` reason so a "why no notification" report is triageable.
- **Privacy/store gate** — new `context` keys ship: `hint_generated`, `hint_expired`, `hint_pruned_stale`, `hint_total`, `hint_skipped_records`, `hint_master_on`, `hint_flag_on`, `hint_type`, `hint_reason`, `hint_op`. These MUST be added to `ALLOWED_CONTEXT_KEYS` (`logEvent.ts`) and the store data-collection declarations updated (`docs/runbooks/native-store-submission.md` + `PrivacyInfo.xcprivacy`, the Data-Safety/App-Privacy answers, `privacy.astro`). All are non-PII counters/enums (no names, no member ids, no event content) — deliberately so.

## Acceptance Criteria

- [ ] With the flag on and master ON, each v1 trigger yields a correctly-timed, correctly-assigned hint to-do, visually distinct from manual to-dos, each carrying a notification via the existing todo-reminder path defaulted from Settings.
- [ ] Hint titles/descriptions render through i18n (both `en` and `beanie` carry the title/description keys); locale changes cause no duplicate or churned hints (dedup is by locale-independent `hintKey`).
- [ ] Master OFF (family-synced) → no hints generated, and existing un-acknowledged/un-completed hints are removed family-wide; the master flag converges across devices (idempotent-by-key generation + early-return guard).
- [ ] A per-type toggle OFF on a device silences ONLY that device owner's notification for that type; the shared hint to-do still appears for everyone and other members still get notified.
- [ ] The birthday person never sees their own present hint — in the to-do list (audience-hidden filtering) AND in global search (un-acknowledged hints excluded).
- [ ] Ignored hints are removed after the event date passes; acknowledged (kept) or completed hints persist as normal to-dos retaining a subtle hint marker.
- [ ] Hints never render overdue-red and never appear in overdue/due-today/scheduled/open surfaces, nav badges, the daily briefing (`useCriticalItems`), Nook widgets, or the status toast (structurally excluded via `manualActiveTodos`/`filteredActiveTodos`); un-acknowledged hints do not appear in global search or skew the bean-tips count.
- [ ] Generating a hint never re-triggers the reconcile watcher (no reconcile↔reschedule loop) — verified by test.
- [ ] Each hint exposes a "what's this?" explainer and dismisses in one action; its notification is adjustable/removable per-item like any timed to-do.
- [ ] No duplicate hints for the same trigger occurrence across reloads or devices (dedup by `hintKey`).
- [ ] A single malformed member/activity/vacation record is skipped (counted in `hint_skipped_records`) without suppressing other hints, and a thrown reconcile is reported and self-heals on the next input change (no silently-dead watcher).
- [ ] Gated behind the `helpfulHints` dev flag; flag off → app identical to today.
- [ ] Help Center `helpful-hints` article added and matches shipped behaviour.
- [ ] Diagnostic logging implemented and verified (events fire with `surface: 'helpful-hints'` + the stated context; new context keys allowlisted + store-declared; failure modes triageable from CloudWatch without a local repro).

## Testing Plan

1. **Pure engine unit tests** (`helpfulHints.test.ts`, `useToday` mocked per the singleton-capture gotcha; a fake `translate` injected; `vi.resetAllMocks()` in `beforeEach`):
   - Each of the 6 triggers fires exactly inside its window and not outside (−14d/−2d/−7d boundaries, `>= today`, no retroactive).
   - Birthday audience = adults excl. birthday person & pets; no eligible adults → no hint.
   - Party-group partition: `birthday`→−2d, `anniversary`→−14d, others→−2d; derived from `ACTIVITY_GROUP_MAP`.
   - Trip triggers use `assigneeIds`; no `startDate`/no travellers → skip.
   - `hintKey` stability (same occurrence ⟹ same key via `buildHintKey`, independent of the injected `translate`); recurring activity ⟹ one hint per upcoming occurrence.
   - Titles/descriptions are produced via the injected `translate` (assert it is called with the right key + name params; no hardcoded English in output).
   - **A malformed record (e.g. a member with a corrupt `dateOfBirth`) is caught in its source function, counted in `skipped`, and does not throw or suppress the other members' hints.**
   - `reconcileHints`: adds missing, expires past-event un-acknowledged, prunes stale (source removed/moved), never touches acknowledged/completed; diff is title-independent.
   - `dedupeHintsByKey` keeps earliest `createdAt`.
   - `isHint` narrows correctly (marker present/absent).
2. **Store tests**: `hintTodos`/`visibleHintTodos` (audience-hidden excluded); **`manualActiveTodos` excludes hints and every re-based lane (overdue/due-today/scheduled/undated) plus `filteredActiveTodos` inherit the exclusion** — assert a hint with a past-nudge `dueDate` appears in none of them; `activeTodos` still contains the hint (reminder path intact); `acknowledgeHint` sets the flag; **no-loop invariant** — mutating `todos` does not re-enter the reconcile watcher (the watcher's sources are unaffected).
3. **Off-store consumer tests**: `useCriticalItems` briefing excludes a due-today/overdue-nudge hint; `GlobalSearch` excludes an un-acknowledged hint (incl. a hidden present hint) but includes an acknowledged one; `useBeanTips` count ignores un-acknowledged hints.
4. **Reminder gate test**: `buildTodoReminders` skips a hint todo whose type is muted device-locally (increments `gated`, emits `notif_gated`); still schedules when enabled; non-hint todos unaffected.
5. **Manual/real-device** (post-deploy, per iOS live-only): seed a birthday 14 days out + a trip 7 days out; confirm the hint appears, the notification fires at the nudge time, the birthday person doesn't see their present hint (list + search), dismiss/keep behave, and a per-type toggle silences the notification on that device only.
6. **Flag-off regression**: with `helpfulHints` off, no hint code runs and the to-do list + reminders + briefing + search are byte-identical to today.
7. `npm run build` (full rollup import-analysis — new composable + store↔util edges) + `npm run type-check` + Vitest all green before push.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full feature on top of the #55 pull-based todo-reminder path — hint = dated to-do (nudge-date `dueDate`), pure engine + reactive reconcile orchestrator, family-synced master + device-local per-type suppression, audience-hidden visibility for surprise preservation, hybrid lifecycle via `hintEventDate`/`hintAcknowledged`, CRDT-merge dedup by `hintKey`.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the codebase. Corrected `ACTIVITY_GROUP_MAP` to `src/constants/activityCategories.ts`; replaced the undefined "activity store getter" with reuse of the existing `assembleOccurrencesByDate` assembler over a 14-day window; routed the per-type mute through the existing `gated` counter (not `skipped`) and put `helpfulHintNotifyByType` on `ReminderPrefs` (device) rather than `ReminderInput`; added per-record `try/catch` in the engine (returning a `skipped` tally) and a whole-body `try/catch → reportError` in the orchestrator so no malformed record or thrown reconcile can silently kill hint generation; confirmed `SettingToggleRow`/`InfoHintBadge` prop contracts and the `persistAiSetting`/`persistGlobalSetting`/`setCalendarClashNudgeEnabled` chains are reused verbatim; added observability + acceptance/test coverage for the new failure modes.
- **Pass 3 (Sustainability)**: Contained the `dueDate`-overload behind one `manualActiveTodos` store getter that re-bases overdue/due-today/scheduled/undated/open (replacing scattered `&& !t.hintType` guards — which had missed `scheduledTodos`), added a single exported `isHint` predicate + `buildHintKey` (opaque key, never parsed) + `HINT_TYPE_META` (one source of truth for the type list), and replaced the forced-uniform `HINT_RULES{leadDays,buildFor}` table with `HINT_LEAD_DAYS` data + three explicit per-source functions to avoid a leaky abstraction over the three input shapes.
- **Pass 4 (Fresh-eyes sweep)**: Audited every todo-consuming surface and fixed three confirmed hint leaks the store re-base couldn't reach — the daily briefing (`useCriticalItems` iterated raw `activeTodos`, showing hints as overdue), global search (`GlobalSearch` iterated raw `todos` with no audience filter, exposing a birthday person's own present hint), and the bean-tips count; corrected the `filteredActiveTodos` re-base mechanic (it derives from `filteredTodos`, not `activeTodos`); made persisted hint titles/descriptions go through an injected `translate` for i18n coverage with a documented locale-freeze caveat and a note that `hintKey` is locale-independent so locale changes cause no churn; and added explicit invariants ruling out a reconcile↔reschedule loop, documenting master-off CRDT convergence, and confirming the data-export surface is intentionally unchanged.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-pre-plan → assembled intake, tracker #40)

Helpful Hints — auto-generated to-do reminders for upcoming events. Build on the #55 notification/reminders framework; hints are family to-do items that carry a notification (reuse the timed-to-do reminder path, not a parallel scheduler); Settings → Reminders gains a family-synced master on/off (default ON) governing generation + per-hint-type per-device toggles that suppress only this person's notification (shared to-do still shows). Visual differentiation, hybrid lifecycle (ignore→expire / acknowledge→permanent w/ subtle marker), inline "what's this?" explainer, one-tap dismiss. 6 v1 rule-based triggers (member birthday −14d adults-excl-self, birthday party −2d, other celebration −2d, anniversary −14d, trip −2d packing, trip −7d passports). Gated behind helpfulHints DevFlag. GitHub issue: SKIP.

### Refinements (pre-plan clarifying answers, 2026-07-24)

- Delivery: a hint is a to-do item that triggers a notification (both); user can adjust/remove the notification per-item, or disable the specific hint in settings.
- Granularity: master switch + per-hint-type toggles, per-device (matching #55 reminder model).
- Toggle scope: a per-device per-type toggle suppresses that person's notification only; the shared to-do still appears for everyone.
- Mockup: none.

### /beanies-plan

proceed to build the plan

</details>
