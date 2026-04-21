# Plan: Medication View Modal + Administration Log

> Date: 2026-04-21
> Related issues: (Pod P3 follow-up — safety feature for medication coordination)

## Context

Families need to coordinate medication administration across caregivers so nobody double-doses and everyone can see when the last dose was given. The existing medications tab only supports create/edit — no way to view details, no way to record "I gave this one."

User story: as a family member, I want to clearly view the details of a medication and its photo, and log when I've administered a dose with a single tap, so that other family members (and I) can see when the dose was given and I don't administer the medication too many times.

Pattern loosely mirrors the cookbook/cook-log precedent but is simpler: no rating, no photos on log entries, literal one-tap log flow.

## Requirements (confirmed with user)

1. **One-tap flow** — save immediately on tap, with an Undo affordance in the success toast.
2. **Auto-capture** the currently-signed-in family member as `administeredBy`.
3. **Delete past log entries** via a per-row menu (no full edit in v1).
4. **No photos** on log entries.
5. **"Nth dose today" confirmation** — when ≥1 dose is already logged today for the medication, show an `info`-variant confirm before saving; cancel = no save.
6. **Quick-log button on the MedicationCard AND in the view modal.** Card button must be clear but not trivially mis-pressable.
7. **Card tap → view modal; edit routed via ✏️ inside** the view modal to the existing `MedicationFormModal`.

## Design direction

Grounded in `.claude/skills/beanies-theme/SKILL.md` (authoritative brand system) with `frontend-design` principles applied within those constraints.

**Modal type:** `BaseModal` (Tier 1) with `fullscreenMobile` + `flushBody` so the photo bleeds edge-to-edge on mobile while the container keeps `rounded-3xl` squircle corners on desktop. Read-only-first. Edit fires the existing `MedicationFormModal` (Tier 2) — we do not re-implement edit UI.

**Layout (top to bottom):**

1. **Photo hero.** If `photoIds` present: the first photo at full card width (4:3 on desktop), tap opens `PhotoViewer` full-screen. Fallback: the existing Rx capsule SVG scaled up with a Sky Silk 20% tinted background.
2. **Identity ribbon.** `BeanieAvatar` (small) + "For {Name}" caption, with a 40×40 ✏️ icon-button (squircle, Heritage Orange tint) right-aligned for edit.
3. **Title block.** Medication name in Outfit `text-2xl` bold. One meta line: `500mg · 3× daily · started Apr 15` — dose in Heritage Orange, rest in `var(--color-text-muted)`. `notes` rendered below as Inter `text-sm` if present.
4. **Primary CTA.** `💊 I gave this dose` — full-width Heritage Orange → Terracotta gradient button (same styling as BeanieFormModal's save button). Below it, Caption-style line: `last dose: 3h ago · 1 today` OR `no doses logged yet`.
5. **Recent doses section.** Outfit uppercase `text-xs` header "RECENT DOSES". Per-entry `MedicationLogRow` (extracted component): member avatar 28px + name + relative time + delete-menu `…`. Show 5, "View all →" expands to full list (scrollable within modal body).

**Motion:** New log entry slides in at the top of the recent-doses list, with `useAttentionPulse().pulse()` applied to draw the eye. Consistent with existing patterns.

**Voice (from theme skill, brand principle "Comforting"):** "I gave this dose" (not "Log dose" / "Record administration"). Confirm repeat message: "Greg · 1 dose of Paracetamol already logged today. Add another?" (friendly, factual, not alarming).

**MedicationCard quick-action button.** 40×40 squircle (`rounded-[14px]`), Heritage Orange 8% tint, 💊 emoji centered. Positioned absolute top-right with 12px inset. `@click.stop` to isolate from card-body tap. Hidden on ended meds (`v-if="isMedicationActive(med)"`). The card itself becomes a `<div>` wrapping two sibling `<button>`s (body → emit `view`; corner → emit `give-dose`) — valid HTML, two distinct tap targets, keyboard-reachable.

## Reuse matrix — what I'm NOT building

| Need                                           | Existing solution                                     | Location                               |
| ---------------------------------------------- | ----------------------------------------------------- | -------------------------------------- | ------------------------------- |
| Relative time ("3h ago", "today", "yesterday") | `timeAgo()`                                           | `src/utils/date.ts:173`                |
| Short dates / times                            | `formatNookDate()`, `formatTime12()`                  | `src/utils/date.ts`                    |
| Local today (timezone-safe)                    | `toDateInputValue()`                                  | `src/utils/date.ts`                    |
| Confirm dialogs                                | `useConfirm({ variant: 'info'                         | 'danger' })`                           | `src/composables/useConfirm.ts` |
| Store-action error handling + auto-toast       | `wrapAsync()`                                         | `src/composables/useStoreActions.ts`   |
| Photo lightbox                                 | `PhotoViewer.vue` (flushBody, readOnly)               | existing                               |
| Member avatars with photos                     | `BeanieAvatar` + `useMemberInfo.getMemberAvatarUrl()` | existing                               |
| Current signed-in member                       | `familyStore.currentMember`                           | `src/stores/familyStore.ts`            |
| Automerge doc init + older-file migration      | `initDoc()` + `ALL_COLLECTIONS` auto-migrate          | `src/services/automerge/docService.ts` |
| Attention pulse                                | `useAttentionPulse()`                                 | `src/composables/useAttentionPulse.ts` |
| Medication-active check                        | `isMedicationActive()`                                | existing helper                        |

## Reliability additions — from sustainability review

- **Cascade delete**: `deleteMedication` must also remove all logs for the medication. Sequential `remove()` calls inside the same `wrapAsync`.
- **Reactive self-close**: view modal watcher on `selectedMedication` — if it becomes undefined (remote delete), auto-close + info toast.
- **Explicit state machine** in `BeanMedicationsTab` for modal coordination (`{ kind: 'none' | 'viewing' | 'editing', medicationId }`) — not two booleans.
- **Timezone unit tests**: dose-at-23:59 + check-at-00:01, DST day, same-second dose.
- **No-currentMember guard** in `useGiveDose` — explicit error toast + `[useGiveDose]` console.error. Never silently drop.
- **Pluralization helper** (`utils/format.ts → pluralize(n, singular, plural)`) — avoid inline `? 's' : ''` that won't localize.
- **Import-cycle check**: `medicationsStore` must not import `syncStore` or `photoStore` at module scope (see Pod P3 lesson). Logs are photo-less by design — documented in file header.

## Error handling guarantees — explicit

| Failure mode                                | Handling                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| CRDT write fails (create/delete log)        | `wrapAsync` → error toast + `[medicationsStore]` console.error + error ref           |
| `currentMember` null                        | `useGiveDose` guard → error toast "Pick a bean to continue" + console.error          |
| Undo deletes log → delete fails             | `wrapAsync` in `deleteMedicationLog` surfaces error toast                            |
| Med deleted while view modal open           | Reactive watcher → close modal + info toast                                          |
| Log entry `administeredBy` member deleted   | `useMemberInfo.resolveMember(id)` returns undefined → row shows "someone · time ago" |
| `administeredOn` corrupt ISO                | `timeAgo`/`formatNookDate` have existing graceful fallbacks; unit test added         |
| Two concurrent log creations (multi-device) | Automerge CRDT — both persist as distinct entries                                    |
| Timezone boundary at midnight               | `dosesToday` uses `toDateInputValue(new Date())` for LOCAL today                     |
| "Dose already today" confirm cancelled      | Early return in `useGiveDose` — no log created                                       |

## Data model

```ts
// src/types/models.ts
export interface MedicationLogEntry {
  id: string;
  medicationId: string;
  administeredOn: ISODateTimeString; // full timestamp — timeAgo() needs hour precision
  administeredBy: UUID;
  createdBy: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
export type CreateMedicationLogEntryInput = Omit<
  MedicationLogEntry,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateMedicationLogEntryInput = Partial<CreateMedicationLogEntryInput>;
```

New Automerge collection `medicationLogs`. Auto-migrates on older `.beanpod` load via existing mechanism.

## Store surface (extend `medicationsStore`, do not split)

State:

- `medicationLogs: Ref<MedicationLogEntry[]>`

Computed:

- `logsForMedication(id)` → `MedicationLogEntry[]` descending by `administeredOn` (mirror `cookLogsByRecipe`)
- `dosesToday(id)` → `number` (local-today comparison via `toDateInputValue`)
- `lastDoseAt(id)` → `ISODateTimeString | null`

Actions (all via `wrapAsync`):

- `loadMedicationLogs()`
- `createMedicationLog(input)`
- `deleteMedicationLog(id)`
- `deleteMedication(id)` — **updated** to cascade-delete logs

## Composable: `useGiveDose()`

Single orchestration primitive. Returns a `giveDose(med) → Promise<string | undefined>` — the new log's id on success, undefined on any failure path (guard / cancel / CRDT error).

Flow:

1. Guard: no `currentMember` → error toast + console.error + return undefined
2. `dosesToday(med.id) >= 1` → `useConfirm({ variant: 'info' })` with member name + count; cancelled → return undefined
3. `medicationsStore.createMedicationLog(...)` — wrapAsync handles errors; if it returns null, just return undefined (toast already shown)
4. `showToast('success', …, { actionLabel: 'Undo', actionFn: () => medicationsStore.deleteMedicationLog(log.id), durationMs: 6000 })`
5. Return `log.id` for caller-side pulse

Two call sites:

- `MedicationViewModal` CTA handler — uses the return id to `pulse()` the new row
- `BeanMedicationsTab` handling `give-dose` emissions from cards — ignores return id

## Toast extension

`useToast.ts` gains an optional options object:

```ts
showToast(type, title, detail?, options?: {
  actionLabel?: string;
  actionFn?: () => void | Promise<void>;
  durationMs?: number;
})
```

`ToastContainer.vue` renders the action button when present; click dismisses toast and `await`s `actionFn`. Caller handles errors inside `actionFn` (standard `wrapAsync` path).

First-class reusable pattern — any future undoable action (activity delete, task delete, cook-log delete) benefits.

## Files affected

**New (6):**

- `src/types/models.ts` — add `MedicationLogEntry` + inputs _(modification, listed under types)_
- `src/services/automerge/repositories/medicationLogRepository.ts`
- `src/composables/useGiveDose.ts`
- `src/composables/__tests__/useGiveDose.test.ts`
- `src/components/pod/MedicationViewModal.vue`
- `src/components/pod/MedicationLogRow.vue`

**Modified (8):**

- `src/types/models.ts` — new log types
- `src/services/automerge/docService.ts` — register `medicationLogs` collection
- `src/stores/medicationsStore.ts` — log state/computed/actions + cascade delete
- `src/stores/__tests__/medicationsStore.test.ts` — cascade delete + log CRUD + timezone + `dosesToday` / `lastDoseAt`
- `src/composables/useToast.ts` — action-button support
- `src/components/ui/ToastContainer.vue` — render action button
- `src/components/pod/MedicationCard.vue` — restructure div+two-buttons, emit `view` / `give-dose`
- `src/components/pod/BeanMedicationsTab.vue` — state machine, mount view modal, orchestrate give-dose
- `src/utils/format.ts` (new file or add to existing util file) — `pluralize(n, singular, plural)` + unit test
- `src/services/translation/uiStrings.ts` — `medicationLog.*` keys (both `en` + `beanie`)

## Translation keys (new)

```
medicationLog.giveDose                  — "I gave this dose" / "i gave this dose"
medicationLog.doseLogged                — "Dose logged" / "dose logged"
medicationLog.undo                      — "Undo" / "undo"
medicationLog.confirmRepeat.title       — "Already given today" / "already given today"
medicationLog.confirmRepeat.message     — "{name} · {count} {doseWord} of {medName} already logged today. Add another?"
medicationLog.confirmRepeat.confirm     — "Add another" / "add another"
medicationLog.recentHeader              — "Recent Doses" / "recent doses"
medicationLog.empty                     — "No doses logged yet." / "no doses logged yet."
medicationLog.lastDose.prefix           — "last dose:" / "last dose:"
medicationLog.dosesToday                — "{count} today" / "{count} today"
medicationLog.viewAll                   — "View all {count} →" / "view all {count} →"
medicationLog.deleteConfirm.title       — "Remove this entry?" / "remove this entry?"
medicationLog.deleteConfirm.message     — "This dose will be removed from the log. This can't be undone."
medicationLog.medDeleted                — "This medication was removed." / "this medication was removed."
medicationLog.errors.noCurrentMember    — "Pick a bean to continue" / "pick a bean to continue"
medicationLog.dose                      — "dose" (singular)
medicationLog.doses                     — "doses" (plural)
medicationLog.someone                   — "someone" — fallback for deleted members
```

## Tests

**Unit tests:**

- `medicationsStore.test.ts`:
  - `createMedicationLog`, `deleteMedicationLog` happy + error paths
  - `dosesToday` at 23:59 local, 00:01 next local day, same second
  - `lastDoseAt` for no logs, one log, many logs
  - `logsForMedication` sort order (descending by administeredOn)
  - `deleteMedication` cascade-removes logs
- `useGiveDose.test.ts`: no-currentMember guard, repeat-dose confirm, cancelled confirm, success path returns id, store error path returns undefined
- `format.test.ts`: `pluralize(0, …)`, `pluralize(1, …)`, `pluralize(2, …)`, `pluralize(-1, …)`
- Toast extension: action button click calls actionFn and dismisses

Skipping E2E (ADR-007 budget at 33/25 — consolidate existing before adding).

## Phased implementation

1. **Foundation** — types, docService collection add, repo, `pluralize()` helper, store extension (logs + cascade delete) + unit tests. Backend-only; no UI change.
2. **Toast action extension** — `useToast` + `ToastContainer` + test.
3. **`useGiveDose` composable** + tests (returns log id).
4. **`MedicationViewModal` + `MedicationLogRow`** — view modal with state machine in `BeanMedicationsTab` + med-deleted watcher + edit routed to existing `MedicationFormModal`.
5. **`MedicationCard` restructure** — div+two-buttons pattern, emits `view` / `give-dose`; tab orchestrates.
6. **Delete log entry + polish** — row-level delete-confirm, attention pulse on new entry, dark mode QA, beanie-mode strings via `npm run translate`, accidental-tap QA.

Each phase ships its own green commit. Phases 1-2 are independently valuable.

## Non-goals / deferred

- Editing past log timestamps / notes (not requested)
- Log photos (not requested)
- Dosage-aware warnings beyond "Nth dose today" (needs structured dose/frequency fields — v2 follow-up filed separately)
- Push notification reminders
- Multi-med bulk log
- Dose-missed tracking
- E2E tests (budget full)
- Generic `useViewEditModalState` composable (wait for 3rd call site)

## Out-of-scope rewrites explicitly resisted

- **Splitting into `medicationLogsStore`** — cascade + cross-entity queries become coordination overhead. `recipesStore` precedent holds.
- **Inlining `MedicationLogRow`** — self-contained test surface justifies extraction.
- **`useViewEditModalState` composable** — YAGNI until 3rd surface.
- **Per-row `<DoseAmountDisplay>` / `<AdminTime>` micro-components** — one-use helpers disguised as reusable.
