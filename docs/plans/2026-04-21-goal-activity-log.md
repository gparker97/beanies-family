# Plan: Goal activity log + quick-contribute flow

> Date: 2026-04-21
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-04-21-goal-activity-log.md`

## User Story

As a family member tracking a savings or debt-payoff goal, I want to add money toward it in one tap (with an optional note about where it came from), see every contribution that's moved the needle — automated Transactions and my own manual contributions — and undo a mistake if I mis-tap.

## Context

Goals accumulate progress two ways:

1. **Automated contributions** — any `Transaction` with `goalId === goal.id` (plus `goalAllocApplied` when a percentage rule splits a deposit). These already exist; pure runtime derivation from `transactionsStore`.
2. **Manual contributions** — user reports "I added money toward this goal from X" (a windfall, savings from expenses, money from a friend, etc.). No cash movement through the app's tracked accounts is implied — it's the user self-reporting progress, optionally with a note.

`AccountViewModal.vue` (shipped 2026-04-21) established the drawer-with-activity-log pattern. Goals are the second surface; this justifies extracting the activity section into `<EntityActivityLog>`.

This plan also promotes "contribute to a goal" into a first-class primary action — a lightweight quick-contribute modal opened from the goal view, with success-toast undo and milestone-only celebrations (25/50/75/100%). Mirrors the medication-dose pattern (`useGiveDose` + `DoseLogConfirmModal` + `useToast` undo action).

Account balance adjustments are Transaction rows because the balance actually moved — that's cash-flow data and belongs in the ledger. Goal manual contributions are stored inline on the goal because they're just a list of things the user did to that goal. Both are pragmatic fits, not a principle.

## DRY audit (pre-plan)

- **No `GoalViewModal` exists.** `GoalsPage` card click opens `GoalModal` directly for edit. Flip to the tap-to-view pattern used by medications, activities, todos, and (now) accounts.
- **`AccountViewModal.vue:227-311`** is the reuse target. Extract to `<EntityActivityLog>` this plan; refactor `AccountViewModal` onto it in the same change.
- **`groupByDate` + `getTransactionSubtitle`** already shipped and reused as-is. `getTransactionSubtitle` returns `t('accountView.goalLabel')` when `tx.goalId` is set — no goal-name resolution needed in v1.
- **`useAuthoringMember` extraction at N=2.** `useAdjustBalance` (shipped) and `useContributeToGoal` (new) both resolve `currentMember ?? owner` and fire a no-author error toast. Centralize the resolution + toast in a shared composable with `resolveOrToast({ callerTag, toastTitleKey, toastHelpKey })`. Refactor `useAdjustBalance` to use it.
- **`goalsStore.updateGoal` uses `wrapAsync`** (`goalsStore.ts:73-98`) — the store-level contribution-append invariant gets free error-toast surfacing.
- **Automated paths** (`transactionsStore.applyGoalAllocation`, `recurringProcessor.updateGoalProgress`) write `currentAmount` without passing `contribution` context → no contribution appended. Correct.
- **`goalsStore.getGoalProgress(goal)`** (line 123) → reuse for the header percentage in `GoalViewModal`.
- **No filter chips for goals** — `<EntityActivityLog>.filters` is optional; hides chip row when absent.
- **Drawer size `wide`** matches `AccountViewModal`.
- **Footer — different from accounts**: goals get **Close + Contribute** (primary action is the new quick-contribute); edit becomes a **✏️ icon in the header ribbon**, mirroring `MedicationViewModal`.
- **`getPriorityConfig`** currently inlined in `GoalsPage.vue:123-147` — extract to `src/constants/goalDisplay.ts`. Default to low-priority + `console.warn` on unknown values.
- **`useMemberInfo().getMemberName`** graceful on missing ids.
- **`generateId()` from `src/utils/id.ts`** for UUIDs.
- **`useCelebration` registry** gains a single new key `'goal-milestone'`. Fires when a contribution crosses 25/50/75/100% of target.
- **`useToast` action-label + actionFn** already shipped for medication undo. Reuse directly.
- **No `GoalCard` component** — card markup inline in `GoalsPage.vue`.
- **`BeanieFormModal`** supports `variant="modal"` (centered) — `GoalContributionModal` uses this, stacks cleanly over the drawer.

## Requirements

1. **`Goal.manualContributions?: GoalManualContribution[]`** — new optional inline array. Zero migration.

   ```ts
   export interface GoalManualContribution {
     id: UUID; // stable render key
     amount: number; // signed; positive = progress, negative = reversal
     at: ISODateString; // full ISO timestamp
     updatedBy: UUID; // FamilyMember.id
     note?: string; // optional user-provided context
   }
   ```

2. **`goalsStore.updateGoal` gains optional 3rd `options` parameter** (options bag):

   ```ts
   interface UpdateGoalOptions {
     contribution?: { author: UUID; note?: string };
   }
   async function updateGoal(id, input, options?): Promise<Goal | null>;
   ```

   When `options.contribution` is set AND `input.currentAmount` differs from stored value, the store auto-appends a `GoalManualContribution` via the extracted `appendContributionIfChanged()` helper. Single source of truth for the invariant.

3. **`useAuthoringMember()` composable** at `src/composables/useAuthoringMember.ts`. Exposes `resolveOrToast({ callerTag, toastTitleKey, toastHelpKey }): string | null`. Returns `currentMember?.id ?? owner?.id ?? null`; if null, fires toast + `console.error`.

4. **`useAdjustBalance` refactor** — replaces inline author-resolution + toast with `useAuthoringMember.resolveOrToast`. Existing tests must continue to pass.

5. **`<EntityActivityLog>` shared component** at `src/components/common/EntityActivityLog.vue`.

   ```ts
   export interface ActivityEntry {
     id: string;
     date: string; // ISO date group key
     title?: string; // optional bold first line
     subtitle: string; // secondary line
     amount: number; // absolute
     currency: CurrencyCode;
     direction: 'income' | 'expense' | 'neutral';
     iconEmoji?: string;
     onClick?: () => void; // undefined = non-clickable
   }
   ```

   Props: `entries`, `emptyStateText`, `filters?`, `activeFilterId?`, `visibleCap?` (default 20), `viewAllText?`. Emits: `filter-select`, `view-all`.

6. **Refactor `AccountViewModal.vue`** onto `<EntityActivityLog>`. Bucket-rule + signed-amount stay in `AccountViewModal`; caller pre-filters and maps `Transaction[]` → `ActivityEntry[]`. All 6 existing AccountViewModal tests must pass.

7. **`GoalViewModal.vue`** at `src/components/goals/GoalViewModal.vue`. Read-only drawer, `size="wide"`. Header: goal name + type emoji + **✏️ edit icon** near the name, progress bar + percentage, currentAmount / targetAmount via `<CurrencyAmount>`, deadline chip (if set), priority chip (via shared `getPriorityConfig`). Body: `<EntityActivityLog>` with merged entries. Footer: **Close (`#footer-start`) + Contribute (primary save button)**.

8. **`GoalContributionModal.vue`** at `src/components/goals/GoalContributionModal.vue`. Centered modal (`BeanieFormModal variant="modal" size="narrow"`), stacks over `GoalViewModal`. Two fields: `amount` (required, >0) + `note` (optional). Primary button "Contribute" (orange gradient). Save disabled until amount > 0. On save → call `useContributeToGoal.contribute(goalId, { amount, note })`.

9. **`useContributeToGoal()` composable** with internal helper pattern:

   ```ts
   export function useContributeToGoal() {
     async function contribute(goalId, { amount, note }): Promise<ApplyResult>;
     async function saveWithContribution(goalId, input: UpdateGoalInput): Promise<ApplyResult>;
     async function undoContribution(goalId, contributionId, amount): Promise<void>;
   }
   ```

   Shared internal `_apply(goalId, newCurrentAmount, extraInput, note?)` does: resolve author via `useAuthoringMember` → call `goalsStore.updateGoal(id, { ...extraInput, currentAmount }, { contribution: { author, note } })` → check milestone crossing → fire success toast with undo action → return `{ success, goal?, contributionId?, appliedDelta? }`.

10. **Milestone celebrations**: `maybeCelebrateMilestone(before, after)` private helper inside the composable. Thresholds: 25, 50, 75, 100% of `targetAmount`. If contribution CROSSES a threshold (i.e., before < threshold AND after >= threshold), call `celebrate('goal-milestone')`. Wrap in try/catch + warn on failure — never crash.

11. **Undo flow**: toast shown via `showToast('success', t('goalContribute.successToast'), undefined, { actionLabel: t('goalContribute.undoLabel'), actionFn: () => undoContribution(id, contributionId, amount), durationMs: 6000 })`. Undo handler: look up current goal live state → subtract amount from `currentAmount` → splice contribution by id from `manualContributions` → single atomic `updateGoal` call → success toast. Graceful guard: if goal no longer exists, warn + error toast, no crash.

12. **`GoalsPage.handleGoalSave`** routes the update path through `useContributeToGoal().saveWithContribution(data.id, data.data)`. Create path unchanged (`goalsStore.createGoal`).

13. **`transactionsStore.transactionsForGoal(goalId: string)`** — new derived getter. Returns `transactions.filter(t => t.goalId === goalId)` sorted desc by `(date, createdAt)`.

14. **`GoalsPage.vue` card click** routed from `openEditModal(goal)` to `openViewModal(goal)`. ✏️ button on the card still opens `GoalModal`. `GoalViewModal` `@open-edit="openEditModal"`. `GoalViewModal` `@contribute="openContributionModal"`. Mount `GoalContributionModal`. Import `getPriorityConfig` from shared constants.

15. **`TransactionsPage.vue` `?goal=<id>` filter.** Parallel to `?account=<id>`: read on mount, set `goalFilter` ref, AND-combine after `filteredByAccount`, render dismissible `Filtered: {goalName} ✕` pill. Invalid id → toast `txn.filter.goalNotFound` + `console.warn` + clear param.

16. **Row click in `GoalViewModal`:**
    - Automated (Transaction): `router.push({ path: '/transactions', query: { view: tx.id } })` + `emit('close')`.
    - Manual (contribution history): non-clickable (no `onClick`).

17. **"View all →"** shown when total entries > 20. Routes to `/transactions?goal=<id>` + closes modal. Known limitation: only automated contributions are reachable there; manual contributions beyond the cap aren't. Documented follow-up.

18. **`<EntityActivityLog>` manual row `buildEntries` warns on malformed entries** (missing `updatedBy`) — renders 'Unknown' but `console.warn` surfaces the data health issue.

19. **i18n keys** (flat, en + beanie variants):
    - `goalView.title`, `goalView.activity`, `goalView.noActivity`, `goalView.viewAll`, `goalView.notFound`
    - `goalView.progressLabel`, `goalView.deadlineLabel`, `goalView.priorityLabel`
    - `goalView.adjustedBy`, `goalView.adjustedByYou`
    - `goalContribute.title`, `goalContribute.amountLabel`, `goalContribute.amountPlaceholder`
    - `goalContribute.noteLabel`, `goalContribute.notePlaceholder`
    - `goalContribute.button`, `goalContribute.successToast`, `goalContribute.undoLabel`
    - `goalContribute.revertedToast`, `goalContribute.undoFailed`
    - `goalContribute.error.noAuthor`, `goalContribute.error.noAuthorHelp`
    - `goalContribute.milestoneReached`
    - `txn.filteredByGoal`, `txn.filter.goalNotFound`
    - Generic `authoring.noAuthor`, `authoring.noAuthorHelp` for shared composable (or leave per-caller and just pass different keys)

20. **Permission gating** stays at page level (`GoalsPage` on `canViewFinances`). Modals trust the parent.

## Error handling — explicit guarantees

Every identified failure mode has a toast + console + explicit return shape:

| Path                                                     | Failure mode                                            | Handled by                                                     |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| Contribute with no author                                | `useAuthoringMember.resolveOrToast`                     | toast + console.error; composable returns `{ success: false }` |
| Contribute on deleted goal                               | `goal not found` guard in `_apply` / `undoContribution` | toast + early return                                           |
| `updateGoal` CRDT write fails                            | `wrapAsync` in `goalsStore.updateGoal`                  | auto error toast; composable returns `{ success: false }`      |
| Undo on concurrently-deleted goal                        | `undoContribution` guard                                | console.warn + error toast, no-op                              |
| Malformed `manualContribution` (missing `updatedBy`)     | `buildEntries` check                                    | renders 'Unknown' + console.warn                               |
| Milestone celebration throws                             | try/catch around `maybeCelebrateMilestone`              | console.warn, no crash                                         |
| Non-positive contribution amount                         | `contribute()` guard + modal disabled-submit            | warn + return false                                            |
| Invalid `?goal=<id>` URL param                           | `TransactionsPage.handleTransactionQueryParam`          | toast + console.warn + clear param                             |
| `GoalViewModal` prop becomes null mid-open (CRDT delete) | reactive watch guard                                    | toast `goalView.notFound` + emit close + console.warn          |
| `getPriorityConfig` unknown priority                     | fallback default + console.warn                         | low-priority styling returned                                  |
| `getTransactionSubtitle` unknown shape                   | existing safe fallback                                  | description returned, console.warn                             |

No silent failures. Every guard has a developer-facing signal (console) plus a user-facing signal (toast) unless it's a purely technical soft-fail (e.g., milestone celebration failing — user doesn't need to see that; console.warn is enough).

## Assumptions

> **Review before implementation.**

1. `GoalModal` + `GoalContributionModal` are the two user-facing `currentAmount` edit entries. Automated paths (`transactionsStore.applyGoalAllocation`, recurring processor) bypass the composable and don't record manual contributions. Correct.
2. `Goal.manualContributions` growth is low-frequency. Drawer shows 20 most-recent mixed; overflow goes to `/transactions?goal=<id>` (automated only — known gap).
3. `generateId()` in `src/utils/id.ts` exists with fallback.
4. `BeanieFormModal variant="modal"` + stacking behavior works when one is open atop an open drawer. Confirmed by existing DoseLogConfirmModal stacking on top of MedicationViewModal drawer.
5. `useCelebration` accepts arbitrary string keys; registering a new one is additive.
6. `canViewFinances` gates `GoalsPage` at the page level already.

## Approach

### 1. Data model (`src/types/models.ts`)

```diff
  export interface Goal {
    id: UUID;
    memberId?: UUID;
    name: string;
    type: 'savings' | 'debt_payoff' | 'investment' | 'purchase';
    targetAmount: number;
    currentAmount: number;
    currency: CurrencyCode;
    deadline?: ISODateString;
    priority: 'low' | 'medium' | 'high' | 'critical';
    isCompleted: boolean;
+   manualContributions?: GoalManualContribution[];
    createdAt: ISODateString;
    updatedAt: ISODateString;
  }

+ export interface GoalManualContribution {
+   id: UUID;
+   amount: number;
+   at: ISODateString;
+   updatedBy: UUID;
+   note?: string;
+ }
```

### 2. `useAuthoringMember` composable

```ts
// src/composables/useAuthoringMember.ts
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import type { UIStringKey } from '@/services/translation/uiStrings';

export function useAuthoringMember() {
  const familyStore = useFamilyStore();
  const { t } = useTranslation();

  function resolveOrToast(opts: {
    callerTag: string;
    toastTitleKey: UIStringKey;
    toastHelpKey: UIStringKey;
  }): string | null {
    const author = familyStore.currentMember?.id ?? familyStore.owner?.id ?? null;
    if (!author) {
      console.error(`[${opts.callerTag}] no authorable member`);
      showToast('error', t(opts.toastTitleKey), t(opts.toastHelpKey));
    }
    return author;
  }

  return { resolveOrToast };
}
```

### 3. `goalsStore.updateGoal` — options bag + helper

```ts
interface UpdateGoalOptions {
  contribution?: { author: UUID; note?: string };
}

function appendContributionIfChanged(
  existing: Goal,
  input: UpdateGoalInput,
  contribution: { author: UUID; note?: string }
): UpdateGoalInput {
  if (input.currentAmount === undefined) return input;
  const delta = input.currentAmount - existing.currentAmount;
  if (delta === 0) return input;
  const entry: GoalManualContribution = {
    id: generateId(),
    amount: delta,
    at: new Date().toISOString(),
    updatedBy: contribution.author,
    ...(contribution.note && { note: contribution.note }),
  };
  return {
    ...input,
    manualContributions: [...(existing.manualContributions ?? []), entry],
  };
}

async function updateGoal(
  id: string,
  input: UpdateGoalInput,
  options?: UpdateGoalOptions
): Promise<Goal | null> {
  const result = await wrapAsync(isLoading, error, async () => {
    const existing = goals.value.find((g) => g.id === id);
    // Auto-complete (existing)
    if (existing && input.currentAmount !== undefined && !input.isCompleted) {
      if (input.currentAmount >= existing.targetAmount) {
        input = { ...input, isCompleted: true };
      }
    }
    // Contribution audit (new)
    if (options?.contribution && existing) {
      input = appendContributionIfChanged(existing, input, options.contribution);
    }
    const updated = await goalRepo.updateGoal(id, input);
    if (updated) {
      goals.value = goals.value.map((g) => (g.id === id ? updated : g));
    }
    return updated;
  });
  return result ?? null;
}
```

### 4. `transactionsStore.transactionsForGoal`

```ts
function transactionsForGoal(goalId: string): Transaction[] {
  return transactions.value
    .filter((t) => t.goalId === goalId)
    .sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
    });
}
```

### 5. `useContributeToGoal` composable

```ts
export function useContributeToGoal() {
  const goalsStore = useGoalsStore();
  const { resolveOrToast } = useAuthoringMember();
  const { t } = useTranslation();

  async function _apply(
    goalId: string,
    newCurrentAmount: number,
    extraInput: Partial<UpdateGoalInput>,
    note: string | undefined,
    fireUndoToast: boolean
  ): Promise<ApplyResult> {
    const goal = goalsStore.goals.find((g) => g.id === goalId);
    if (!goal) {
      showToast('error', t('goalView.notFound'));
      return { success: false };
    }
    const author = resolveOrToast({
      callerTag: 'useContributeToGoal',
      toastTitleKey: 'goalContribute.error.noAuthor',
      toastHelpKey: 'goalContribute.error.noAuthorHelp',
    });
    if (!author) return { success: false };

    const updated = await goalsStore.updateGoal(
      goalId,
      { ...extraInput, currentAmount: newCurrentAmount },
      { contribution: { author, note } }
    );
    if (!updated) return { success: false };

    const appliedDelta = updated.currentAmount - goal.currentAmount;
    const contributionId = updated.manualContributions?.at(-1)?.id;

    safeCelebrateMilestone(goal, updated);

    if (fireUndoToast && contributionId && appliedDelta !== 0) {
      showToast('success', t('goalContribute.successToast'), undefined, {
        actionLabel: t('goalContribute.undoLabel'),
        actionFn: () => undoContribution(goalId, contributionId, appliedDelta),
        durationMs: 6000,
      });
    }

    return { success: true, goal: updated, contributionId, appliedDelta };
  }

  async function contribute(goalId, { amount, note }): Promise<ApplyResult> {
    if (amount <= 0) {
      console.warn('[useContributeToGoal] non-positive amount rejected:', amount);
      return { success: false };
    }
    const goal = goalsStore.goals.find((g) => g.id === goalId);
    if (!goal) {
      showToast('error', t('goalView.notFound'));
      return { success: false };
    }
    return _apply(goalId, goal.currentAmount + amount, {}, note, true);
  }

  async function saveWithContribution(goalId, input): Promise<ApplyResult> {
    if (input.currentAmount === undefined) {
      const updated = await goalsStore.updateGoal(goalId, input);
      return { success: !!updated, goal: updated ?? undefined };
    }
    return _apply(goalId, input.currentAmount, input, undefined, false);
  }

  async function undoContribution(goalId, contributionId, amount): Promise<void> {
    const goal = goalsStore.goals.find((g) => g.id === goalId);
    if (!goal) {
      console.warn('[useContributeToGoal] undo failed — goal not found:', goalId);
      showToast('error', t('goalContribute.undoFailed'));
      return;
    }
    const filteredHistory = (goal.manualContributions ?? []).filter((c) => c.id !== contributionId);
    const updated = await goalsStore.updateGoal(goalId, {
      currentAmount: goal.currentAmount - amount,
      manualContributions: filteredHistory,
    });
    if (updated) showToast('success', t('goalContribute.revertedToast'));
  }

  function safeCelebrateMilestone(before, after) {
    try {
      const thresholds = [25, 50, 75, 100];
      const beforePct = (before.currentAmount / before.targetAmount) * 100;
      const afterPct = (after.currentAmount / after.targetAmount) * 100;
      for (const threshold of thresholds) {
        if (beforePct < threshold && afterPct >= threshold) {
          celebrate('goal-milestone');
          return;
        }
      }
    } catch (e) {
      console.warn('[useContributeToGoal] milestone celebration failed:', e);
    }
  }

  return { contribute, saveWithContribution, undoContribution };
}
```

### 6. `<EntityActivityLog>` component

Template is a direct extraction of `AccountViewModal.vue:227-311` generalized over `ActivityEntry[]`. Groups via `groupByDate(entries, e => e.date, dateLabel)`. Hides chip row when `filters` empty. Row renders as `<button>` (clickable) when `onClick` present, `<div>` otherwise. Title (bold) + subtitle (muted) text stack; amount via `<CurrencyAmount>` on the right.

### 7. `AccountViewModal` refactor

Caller-side mapping:

```ts
const entries = computed<ActivityEntry[]>(() =>
  filtered.value.map((tx) => {
    const { amount, type } = signedAmountFor(tx);
    return {
      id: tx.id,
      date: tx.date,
      title: tx.description,
      subtitle: subtitleFor(tx),
      amount,
      currency: tx.currency,
      direction: type,
      onClick: () => onRowClick(tx),
    };
  })
);
```

Template collapses to `<EntityActivityLog :entries :filters :active-filter-id ... @filter-select="..." @view-all="..." />`.

### 8. `GoalContributionModal.vue`

```vue
<BeanieFormModal
  :open="open"
  variant="modal"
  size="narrow"
  :title="t('goalContribute.title')"
  icon="💰"
  :save-label="t('goalContribute.button')"
  save-gradient="orange"
  :save-disabled="!amount || amount <= 0 || isSubmitting"
  :is-submitting="isSubmitting"
  @close="emit('close')"
  @save="onSubmit"
>
  <!-- amount (AmountInput, required) -->
  <!-- note (BaseInput, optional) -->
</BeanieFormModal>
```

`onSubmit` calls `useContributeToGoal().contribute(goal.id, { amount, note })`. On `success: true`, emits `close`.

### 9. `GoalViewModal.vue`

Header layout:

- Type emoji + goal name (large) + ✏️ icon button (emits `open-edit`)
- Progress bar (3 lines inline) + percentage from `goalsStore.getGoalProgress(goal)`
- `currentAmount` / `targetAmount` via `<CurrencyAmount>`
- Deadline chip + priority chip (from `getPriorityConfig`)

Body:

```ts
const entries = computed<ActivityEntry[]>(() => buildEntries(goal.value!));
```

Footer:

- `#footer-start`: Close button
- Primary save: **Contribute** → emits `contribute` event (parent opens `GoalContributionModal`)

Reactive watch on `goal` prop: if becomes null, toast + close.

### 10. `getPriorityConfig` extraction

`src/constants/goalDisplay.ts`:

```ts
const CONFIGS = {
  critical: {
    bgClass: 'bg-red-50',
    textClass: 'text-red-700',
    labelKey: 'goals.priority.critical',
  },
  high: { bgClass: 'bg-orange-50', textClass: 'text-orange-700', labelKey: 'goals.priority.high' },
  medium: {
    bgClass: 'bg-yellow-50',
    textClass: 'text-yellow-700',
    labelKey: 'goals.priority.medium',
  },
  low: { bgClass: 'bg-slate-50', textClass: 'text-slate-700', labelKey: 'goals.priority.low' },
} as const;

export function getPriorityConfig(priority: string) {
  if (!(priority in CONFIGS)) {
    console.warn('[goalDisplay] unknown priority, defaulting to low:', priority);
    return CONFIGS.low;
  }
  return CONFIGS[priority as keyof typeof CONFIGS];
}
```

### 11. `GoalsPage.vue` wiring

```diff
- <GoalCardMarkup @click="openEditModal(goal)" />
+ <GoalCardMarkup @click="openViewModal(goal)" />
```

New state + handlers for view modal + contribution modal. Handle `@open-edit`, `@contribute` from `GoalViewModal`. Import `getPriorityConfig` from constants. `handleGoalSave` routes update path through `useContributeToGoal().saveWithContribution`.

### 12. `TransactionsPage.vue` `?goal=<id>` filter

`goalFilter` ref; extract from `route.query.goal`; chain `filteredByGoal` after `filteredByAccount`; dismissible pill; invalid-id handling mirrors `?account=<id>`.

## Maintenance tradeoffs

- Account balance adjustments use Transaction rows because balance changes ARE cash-flow and belong in the ledger. Goal manual contributions store inline because they're just a list of what the user did to that goal. Pragmatic fits, not a principle.
- `Goal.manualContributions` growth is low-frequency. Trigger to revisit: any goal accumulating >50 entries, or user complaints about drawer scroll cost. At that point, introduce rollup (summarize contributions older than 12 months) or split into a `goalContributions` collection.
- Cross-device concurrent edits: `currentAmount` is last-writer-wins; `manualContributions` appends cleanly. The final stored value may not equal the sum of deltas if two devices edit simultaneously. Same risk accounts have.
- Automated contributions don't celebrate milestones in v1 — only user-initiated contributions do. Follow-up if it feels missing.
- `GoalManualContribution` + `BalanceAdjustmentMeta` consolidation — different field names (`amount` vs `delta`, plus `note`) and different storage strategies (inline vs Transaction row) — deferred.

## Files affected

**New:**

- `src/composables/useAuthoringMember.ts` + test
- `src/composables/useContributeToGoal.ts` + test
- `src/components/goals/GoalContributionModal.vue` + test
- `src/components/goals/GoalViewModal.vue` + test
- `src/components/common/EntityActivityLog.vue` + test
- `src/constants/goalDisplay.ts` + test

**Modified:**

- `src/types/models.ts` — `GoalManualContribution` + `Goal.manualContributions?`
- `src/stores/goalsStore.ts` — options-bag `updateGoal` + `appendContributionIfChanged`
- `src/stores/__tests__/goalsStore.test.ts` — NEW file; invariant coverage
- `src/stores/transactionsStore.ts` — `transactionsForGoal` getter
- `src/stores/__tests__/transactionsStore.test.ts` — new cases
- `src/composables/useAdjustBalance.ts` — refactor to use `useAuthoringMember`
- `src/composables/__tests__/useAdjustBalance.test.ts` — regression
- `src/composables/useCelebration.ts` — register `'goal-milestone'`
- `src/components/accounts/AccountViewModal.vue` — refactor onto `<EntityActivityLog>`
- `src/components/accounts/__tests__/AccountViewModal.test.ts` — regression
- `src/pages/GoalsPage.vue` — tap-to-view + view/contribution modal mounts + import shared `getPriorityConfig`
- `src/pages/TransactionsPage.vue` — `?goal=<id>` filter + pill
- `src/services/translation/uiStrings.ts` — new flat keys

## Acceptance criteria

- [ ] Editing `Goal.currentAmount` via `GoalModal` appends a `GoalManualContribution` atomically via store invariant.
- [ ] Quick-contribute via `GoalContributionModal` appends with the user-provided note attached.
- [ ] Non-currentAmount edits leave `manualContributions` untouched.
- [ ] Automated paths don't append manual contributions.
- [ ] `transactionsForGoal(id)` sorted correctly.
- [ ] Tap goal card → `GoalViewModal`; ✏️ on card → `GoalModal`; ✏️ icon in view modal header → `GoalModal`; Contribute button → `GoalContributionModal`.
- [ ] `GoalViewModal` size = `wide`; footer = Close + Contribute.
- [ ] Contributing crosses a milestone (25/50/75/100) → `celebrate('goal-milestone')` fires.
- [ ] Success toast on contribute offers Undo for 6 seconds; tapping Undo reverses the delta and removes the contribution entry by id.
- [ ] Undo after goal concurrently deleted → toast + warn, no crash.
- [ ] `<EntityActivityLog>` hides chips when `filters` absent, renders empty state, "View all →" when total > cap, clickable vs non-clickable rows per `onClick` presence.
- [ ] `AccountViewModal` renders identically post-refactor; all 6 existing tests pass.
- [ ] `getPriorityConfig` extracted; unknown priority → low fallback + warn.
- [ ] `TransactionsPage` `?goal=<id>` filters + dismissible pill + invalid id warn/toast/clear.
- [ ] `useAuthoringMember.resolveOrToast` used by both `useAdjustBalance` + `useContributeToGoal`.
- [ ] Every failure path toasts + logs + returns structured shape.
- [ ] `npx vue-tsc` clean. `npm run lint` no new errors. `npm run test` all pass; new tests added.

## Testing plan

1. **Unit — `goalsStore.updateGoal` invariant**:
   - 2-arg call → no `manualContributions` write
   - 3-arg call with currentAmount delta === 0 → no append
   - 3-arg call with delta > 0 → append with passed author, ISO `at`, generated id, signed amount
   - 3-arg call with delta < 0 (reversal) → append with negative amount
   - 3-arg call with contribution.note → note included on entry
   - 3-arg call without `currentAmount` in input → no append
2. **Unit — `transactionsStore.transactionsForGoal`**: own-goal filter, sort, empty.
3. **Unit — `useAuthoringMember.resolveOrToast`**:
   - `currentMember` present → returns id
   - No `currentMember` but `owner` → returns owner id
   - Neither → null + toast + console.error
4. **Unit — `useAdjustBalance` regression**: refactored path still passes all existing tests.
5. **Unit — `useContributeToGoal`**:
   - `contribute` positive amount → appends, fires success toast with undo
   - `contribute` amount === 0 / negative → warn + return false
   - `contribute` on missing goal → toast + return false
   - `saveWithContribution` with currentAmount undefined → plain update, no contribution
   - `saveWithContribution` with currentAmount changed → appends via \_apply
   - `undoContribution` success → subtracts + splices + success toast
   - `undoContribution` goal missing → warn + error toast
   - Milestone crossing → celebrate fires
   - Milestone not crossed → celebrate not called
6. **Unit — `getPriorityConfig`**: known values + unknown → low fallback + warn.
7. **Component — `<EntityActivityLog>`**: empty state, single entry, grouped entries, chip hide when `filters` absent, click emits filter-select, view-all emits, clickable/non-clickable per onClick.
8. **Component — `GoalViewModal`**: header renders, merged entries, manual non-clickable, automated routes, Edit ✏️ emits open-edit, Contribute emits contribute, reactive close on null goal.
9. **Component — `GoalContributionModal`**: form renders, Save disabled when amount <= 0, Save calls contribute with values, close emits close.
10. **Component — `AccountViewModal` regression**: all 6 existing tests pass.
11. **Component — `TransactionsPage` `?goal=<id>`**: filter applies, pill shows + clears, invalid id handled.
12. **Manual QA:**
    - Contribute $50 → success toast with Undo → goal progress ticks up → history row appears "Adjusted by you"
    - Tap Undo → goal progress returns, history row disappears, reverted toast
    - Contribute amount that crosses 50% → milestone celebration fires
    - Contribute with note "mom's birthday money" → note stored + visible somehow in activity log (tooltip or subtitle)
    - Edit full GoalModal → currentAmount change also appends contribution (no Undo toast though)
    - Delete goal → history gone
    - Cross-device: sim two tabs contributing, merge → both entries present

## Follow-ups (out of scope)

- Full goal-history view (`/goals/<id>/history`) if users hit the 20-entry cap and want manual contributions listed too
- Automated contribution milestone celebrations (recurring processor path)
- Goal-name-resolving `getTransactionSubtitle` variant ("Contribution toward College Fund")
- `<ProgressBar>` shared component when a 3rd surface needs progress rendering
- `GoalManualContribution` + `BalanceAdjustmentMeta` type consolidation at N=3
- Soft-cap / rollup when `manualContributions` exceeds ~50 entries per goal

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Let's apply a UI improvement to the goals modal to show history and all transactions related to the goal being viewed in the modal. ... List all transactions related to the goal, such as incoming debits from linked transactions to decrease the goal amount, or manual adjustments to the goal remaining amount. Follow the convention/patterns of accounts. If it makes sense, extract this into a shared component.

### Follow-up 1 (modeling, filters, extraction, tap-to-view)

> 1. In general, a goal is never linked to a bank account... Manual adjustment of the remaining amount for a goal can be logged with the goal, along with the user, date, and time
> 2. no need for filter chips for goals
> 3. ok (`?goal=<id>` view-all)
> 4. ok (extract shared component)
> 5. confirmed - both edit and close button

### Follow-up 2

> 1. direct (no GH issue)
> 2. ok (inline, open to alternatives)
> 3. ok (activity-entry extraction)

### Follow-up 3

> ok let's go with b, please show me the plan

### Follow-up 4 (DRY + error-handling review)

> Review the plan again to make sure you are implementing in the most optimal and efficient way... no duplication, silent failures, overly complicated flows, or code bloat where not necessary.

### Follow-up 5 (sustainability review)

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability.

### Follow-up 6 (questioning the audit-mechanism rule as potentially hacky)

> I'm a bit concerned about this comment as I don't fully understand it, and it seems like we may be implementing something a bit hacky or an unsustainable workaround

### Follow-up 7 (simplification framing)

> We are creating a view modal, so let's add a simple function to contribute money to the goal... A contribution should trigger a small celebration or happy note, and it can be reverted if it was a mistake

### Follow-up 8 (final fresh-eyes DRY audit)

> please run through this full plan with the new changes one more time for a DRY audit, make sure we're reusing and not duplicating as needed

### Follow-up 9

> approved and implement

</details>
