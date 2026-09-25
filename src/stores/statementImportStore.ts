// Statement import review (#107). Owns the one review in flight: the read, the plan, the
// person's decisions, and the commit. Mirrors `calendarImportStore`: a pure planner writes
// nothing, this store holds the phases, one atomic repository batch writes the adds, and the
// drawer renders from here.
//
// ONE DECISION FIELD PER LINE. A candidate carries `decision` beside the planner's immutable
// `defaultDecision`. "Ticked" is `decision !== 'skip'`, "keep both" is `add` on a matched card,
// and "overridden" is `decision !== defaultDecision`. Every control (row tick, card pills, bulk
// bar, day tick) goes through `decide` or `decideAll`, so the totals, the confirm label, the
// commit and the telemetry all read one field and cannot disagree.
//
// COMMIT ORDER IS FIXED: resolve transfer amounts → the atomic add batch → reload the stores →
// the per-row merges. The batch is all-or-nothing, so a throw there writes nothing (`failed`,
// retry from the same list). The reload comes BEFORE the merges because `createTransaction`'s
// first-row check and `updateTransaction`'s original-row lookup both read the store's array,
// which the batch bypassed. A merge failure can therefore only ever produce `partial`. An
// unverifiable batch STOPS before the merges (see `unverified`).

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  CreateTransactionInput,
  RecurringItem,
  Transaction,
  UpdateTransactionInput,
} from '@/types/models';
import type {
  StatementExtractionResult,
  StatementReadResult,
  StatementUnitOutcome,
} from '@/services/ai/types';
import type { ResultEnvelope } from '@/types/magicPayload';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { commitStatementAdds } from '@/services/automerge/repositories/transactionRepository';
import { ImportNotVisibleError } from '@/services/automerge/repositories/importErrors';
import { projectRecurringTransactions } from '@/services/recurring/recurringProcessor';
import { extractStatementFromSource } from '@/services/ai/documentExtractionService';
import { mergeUnitResults } from '@/services/ai/statementExtraction';
import { useAiCapability } from '@/composables/useAiCapability';
import { useDocumentConsent } from '@/composables/useDocumentConsent';
import { useExtractionErrorToast } from '@/composables/useExtractionErrorToast';
import { resolveBillableFamilyId } from '@/composables/useMagicBeanScope';
import { celebrate } from '@/composables/useCelebration';
import { trackFeature } from '@/services/analytics/plausible';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import * as perfTiming from '@/utils/perfTiming';
import { signedAccountDelta } from '@/utils/finance';
import { getRate } from '@/utils/currency';
import { recurringToTransactionFields } from '@/utils/recurringItemFields';
import { generateUUID } from '@/utils/id';
import { recurringInstanceDate, recurringInstanceKey } from '@/utils/recurringInstance';
import { buildStatementContext } from '@/utils/statement/merchantMemory';
import { fingerprintLines } from '@/utils/statement/fingerprint';
import { MATCH_WEIGHTS } from '@/utils/statement/match';
import {
  planStatementImport,
  suggestAccount,
  type StatementCandidate,
  type StatementDecision,
  type StatementPlanNotices,
} from '@/utils/statement/planStatementImport';

const SURFACE = 'statement-import';

export type StatementImportPhase = 'idle' | 'reviewing' | 'committing';

export type StatementCommitResult =
  | { kind: 'ok'; added: number; merged: number }
  | { kind: 'partial'; added: number; merged: number; failed: number }
  | { kind: 'unverified' }
  | { kind: 'failed' };

/** What a bulk action applies: a decision, or each line's own planner default. */
export type BulkDecision = StatementDecision | 'default';

/** Which candidates a bulk action reaches. Already-added lines are never reachable. */
export interface BulkScope {
  /** Only lines on this `YYYY-MM-DD` (a day header's tick). */
  day?: string;
  /**
   * Only lines with a FAMILIAR match (the bulk bar's Merge/Keep/Skip all). A possible duplicate
   * is decided one card at a time: "merge all" must never sweep in a row that only looked close.
   */
  matchedOnly?: boolean;
}

/**
 * Projections that are still UNMATERIALISED: no row stands for their due date yet. Offering one
 * whose due date is accounted for would let a merge create a second instance beside the real one.
 */
function openProjections(
  items: readonly RecurringItem[],
  transactions: readonly Transaction[],
  from: string,
  to: string
) {
  // Exact per due date, through the ONE helper the recurring processor and both duplicate
  // sweeps use: a projection is offered only while no row stands for its due date.
  const materialised = new Set(
    transactions.map((t) => recurringInstanceKey(t)).filter((k): k is string => k !== null)
  );

  // The matcher pads the period; project over the same padded span so an edge line can still
  // meet its instance.
  const pad = MATCH_WEIGHTS.periodPadDays * 86_400_000;
  const start = new Date(new Date(`${from}T00:00:00`).getTime() - pad);
  const end = new Date(new Date(`${to}T00:00:00`).getTime() + pad);
  return projectRecurringTransactions(
    items.filter((i) => i.isActive),
    start,
    end
  ).filter((p) => !materialised.has(recurringInstanceKey(p) ?? ''));
}

/** The period to plan against: the statement's own, else the span of its lines. */
function planningPeriod(result: StatementExtractionResult): { from: string; to: string } {
  const dates = result.lines.map((l) => l.date).sort();
  return {
    from: result.period.from ?? dates[0] ?? '',
    to: result.period.to ?? dates[dates.length - 1] ?? '',
  };
}

export const useStatementImportStore = defineStore('statementImport', () => {
  const phase = ref<StatementImportPhase>('idle');
  const read = ref<StatementReadResult | null>(null);
  const env = ref<ResultEnvelope | null>(null);
  const accountId = ref<string | null>(null);
  const importId = ref('');
  const candidates = ref<StatementCandidate[]>([]);
  const notices = ref<StatementPlanNotices | null>(null);
  /** The dropped page being read right now, for its "read it anyway" button's busy state. */
  const readingPage = ref<number | null>(null);

  // ── Derived from `decision` alone ─────────────────────────────────────────────────────
  const actionable = computed(() => candidates.value.filter((c) => !c.alreadyImported));
  /**
   * Every line that will be ADDED, including an already-added line the person ticked on purpose
   * (allowed one at a time, never in bulk). Counted and committed from ALL candidates, not
   * `actionable`, or that deliberate tick would show selected and silently not be saved.
   */
  const adding = computed(() => candidates.value.filter((c) => c.decision === 'add'));
  const toAdd = computed(() => adding.value.length);
  const toMerge = computed(() => actionable.value.filter((c) => c.decision === 'merge').length);
  const skipped = computed(() => actionable.value.filter((c) => c.decision === 'skip').length);
  const familiar = computed(
    () => actionable.value.filter((c) => c.match?.strength === 'familiar').length
  );
  const possible = computed(
    () => actionable.value.filter((c) => c.match?.strength === 'possible').length
  );
  const overrides = computed(
    () => actionable.value.filter((c) => c.decision !== c.defaultDecision).length
  );
  const allTicked = computed(
    () => actionable.value.length > 0 && actionable.value.every((c) => c.decision !== 'skip')
  );

  function reset(): void {
    phase.value = 'idle';
    read.value = null;
    env.value = null;
    accountId.value = null;
    importId.value = '';
    candidates.value = [];
    notices.value = null;
    readingPage.value = null;
  }

  /**
   * (Re)build the plan for the current read and account. Decisions and edited drafts made so
   * far are carried over BY FINGERPRINT when `keep` is set, which is how "read it anyway" adds a
   * page without undoing the person's work. An account change never keeps them: fingerprints
   * are keyed on the account, so every line is re-checked from its default (the account row
   * says so).
   */
  async function replan(keep: boolean): Promise<void> {
    const current = read.value;
    const account = accountId.value;
    if (!current || !account) {
      candidates.value = [];
      notices.value = null;
      return;
    }
    const started = performance.now();
    const previous = keep ? new Map(candidates.value.map((c) => [c.fingerprint, c])) : null;

    const transactionsStore = useTransactionsStore();
    const period = planningPeriod(current.result);
    const lines = current.result.lines;
    const fingerprints = await fingerprintLines(account, lines);
    const plan = planStatementImport({
      lines,
      identity: current.result,
      accountId: account,
      accounts: useAccountsStore().accounts,
      transactions: transactionsStore.transactions,
      projections: period.from
        ? openProjections(
            useRecurringStore().recurringItems,
            transactionsStore.transactions,
            period.from,
            period.to
          )
        : [],
      fingerprints,
      existingFingerprints: new Set(
        transactionsStore.transactions
          .map((t) => t.importFingerprint)
          .filter((f): f is string => Boolean(f))
      ),
      importMeta: {
        importId: importId.value,
        importSource: current.source,
        importPeriod: period,
      },
    });
    candidates.value = plan.candidates.map((c) => {
      const before = previous?.get(c.fingerprint);
      if (!before) return c;
      // A re-plan can hand this line's row to a better line (a newly read page may claim it). A
      // kept `merge` is honoured only while it still points at the SAME row the person saw;
      // otherwise the line takes this plan's default, never a merge into a row nobody approved.
      const sameRow = before.match?.id !== undefined && before.match.id === c.match?.id;
      const decision =
        before.decision === 'merge' && !sameRow ? c.defaultDecision : before.decision;
      // An already-added line keeps only a DELIBERATE tick (its default is skip).
      if (c.alreadyImported && decision !== 'add') return c;
      return { ...c, decision, draft: before.draft };
    });
    notices.value = plan.notices;
    perfTiming.record('statement-import.plan', performance.now() - started, {
      perf_entity_count: lines.length,
    });
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'plan_built',
      context: {
        action: 'plan_built',
        count: lines.length,
        detail: [
          `familiar:${plan.notices.familiar}`,
          `possible:${plan.notices.possible}`,
          `possible_imported:${plan.notices.possibleImported}`,
          `possible_similar:${plan.notices.possibleSimilar}`,
          `possible_strong:${plan.notices.possibleStrong}`,
          `already:${plan.notices.overlapAlready}`,
          `transfer:${plan.notices.transfers}`,
          `bad_category:${plan.notices.badCategory}`,
        ].join('|'),
      },
    });
  }

  /** Report a planning failure once and leave nothing half-open. */
  function planFailed(error: unknown): void {
    reportError({
      surface: SURFACE,
      message: 'Could not build the statement review',
      severity: 'error',
      error,
      context: {
        action: 'plan_failed',
        error_code: error instanceof Error ? error.name : 'unknown',
      },
    });
    reset();
  }

  /**
   * Open a review for a statement read. Returns false when the plan could not be built (the
   * caller toasts); nothing has been written either way.
   */
  async function start(data: StatementReadResult, envelope: ResultEnvelope): Promise<boolean> {
    try {
      read.value = data;
      env.value = envelope;
      importId.value = generateUUID();
      accountId.value = suggestAccount(data.result.account, useAccountsStore().accounts);
      if (!accountId.value) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'plan_built',
          context: { action: 'plan_built', count: data.result.lines.length, detail: 'no_account' },
        });
      }
      await replan(false);
      phase.value = 'reviewing';
      return true;
    } catch (error) {
      planFailed(error);
      return false;
    }
  }

  /** Point the import at another account. Re-checks every line from its default. */
  async function setAccount(id: string): Promise<boolean> {
    if (phase.value !== 'reviewing' || id === accountId.value) return true;
    accountId.value = id;
    try {
      await replan(false);
      return true;
    } catch (error) {
      planFailed(error);
      return false;
    }
  }

  /** The one per-line mutation. */
  function decide(fingerprint: string, decision: StatementDecision): void {
    const target = candidates.value.find((c) => c.fingerprint === fingerprint);
    if (!target) return;
    // A merge needs something to merge into.
    if (decision === 'merge' && !target.match) return;
    target.decision = decision;
  }

  /**
   * The one bulk mutation. Already-added lines are excluded HERE, so no caller can forget
   * the rule. `'default'` restores each line's planner default, which is what "Tick all" means:
   * a familiar card comes back as merge, not as keep-both.
   */
  function decideAll(decision: BulkDecision, scope: BulkScope = {}): void {
    for (const c of actionable.value) {
      if (scope.day && c.draft.date !== scope.day) continue;
      if (scope.matchedOnly && c.match?.strength !== 'familiar') continue;
      const next = decision === 'default' ? c.defaultDecision : decision;
      if (next === 'merge' && !c.match) continue;
      c.decision = next;
    }
  }

  /**
   * Edit a line's draft from the inline editor or the transfer chip. A transfer always carries
   * its other account in the SAME patch, so a half-transfer cannot exist.
   *
   * A draft's `amount` is always in its SOURCE account's currency (the store's transfer cascade
   * and `signedAccountDelta` both assume it). The statement's amount is in the import account's
   * currency, so when an edit makes another account the source (a "Paid from?" pick, or the
   * editor's account field) in a different currency, the amount is converted with the family's
   * own rates. No rate: the edit is REFUSED and `false` returned, so the caller can say so,
   * rather than debiting that account the card's number in the wrong currency.
   */
  function editDraft(
    fingerprint: string,
    patch: Partial<CreateTransactionInput>
  ): 'ok' | 'rate-missing' | 'invalid' {
    const target = candidates.value.find((c) => c.fingerprint === fingerprint);
    // Neither is reachable from the drawer (the editor only emits a transfer with its account);
    // logged so a future caller that breaks the rule is visible, not silently ignored.
    if (
      !target ||
      (patch.type === 'transfer' && !(patch.toAccountId ?? target.draft.toAccountId))
    ) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'edit_refused',
        context: { action: 'edit_refused', error_code: target ? 'half-transfer' : 'no-line' },
      });
      return 'invalid';
    }
    const next = { ...target.draft, ...patch };
    if (next.type !== 'transfer') {
      delete next.toAccountId;
      delete next.toAmount;
    }
    const source = useAccountsStore().accounts.find((a) => a.id === next.accountId);
    if (source && source.currency !== next.currency) {
      const rate = getRate(useSettingsStore().exchangeRates, next.currency, source.currency);
      if (rate === undefined) {
        reportError({
          surface: SURFACE,
          message: `No exchange rate ${next.currency}->${source.currency}; line edit refused`,
          severity: 'warning',
          context: { action: 'edit_refused', error_code: 'rate-missing' },
        });
        return 'rate-missing';
      }
      next.amount = Math.round(next.amount * rate * 100) / 100;
      next.currency = source.currency;
    }
    target.draft = next;
    return 'ok';
  }

  /**
   * "Read it anyway" for a page the classifier set aside. One more read (one bean), asked for
   * honestly, on the page image already rendered at read time, so the file is never re-opened.
   * Talks to the AI service directly, like `calendarImportStore` talks to its client; it never
   * re-enters the ingest spine.
   */
  async function readDroppedPage(page: number): Promise<boolean> {
    const current = read.value;
    const dropped = current?.droppedPages.find((d) => d.page === page);
    if (phase.value !== 'reviewing' || !current || !dropped || readingPage.value !== null) {
      return true;
    }
    const { reportExtractionFailure } = useExtractionErrorToast();

    const grant = await useDocumentConsent().requestConsent({ kind: 'transactions', reads: 1 });
    if (!grant) return true;
    const familyId = resolveBillableFamilyId({ surface: SURFACE, origin: 'in-app' });
    if (!familyId) return true; // already logged and toasted

    // Confirm is disabled while a page is being read, but the review can still be closed; the
    // answer is only folded in if THIS review is still the one on screen.
    const accountAtStart = accountId.value;
    const stillOpen = () => phase.value === 'reviewing' && read.value === current;
    const beforeCandidates = candidates.value;
    const beforeNotices = notices.value;
    readingPage.value = page;
    try {
      const context = buildStatementContext(
        useTransactionsStore().transactions,
        useFamilyStore().members.map((m) => m.name)
      );
      const result = await extractStatementFromSource(
        dropped.source,
        useAiCapability().extractOptions({ grant, familyId, context })
      );
      if (!result.success || !result.data) {
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'read_unit_failed',
          context: {
            action: 'read_unit_failed',
            error_code: result.errorCode,
            detail: 'dropped_page',
          },
        });
        reportExtractionFailure(result.errorCode, result.error);
        return true;
      }
      if (!stillOpen()) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'read_dropped_page',
          context: { action: 'read_dropped_page', detail: 'review_closed' },
        });
        return true;
      }
      const outcome: StatementUnitOutcome = {
        unit: current.units.length,
        page,
        status: 'read',
      };
      read.value = {
        ...current,
        result: mergeUnitResults([current.result, result.data]),
        units: [...current.units, outcome],
        droppedPages: current.droppedPages.filter((d) => d.page !== page),
      };
      await replan(true);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'read_dropped_page',
        context: { action: 'read_dropped_page', count: result.data.lines.length },
      });
      return true;
    } catch (error) {
      // Put the review back as it was, so one extra page failing never costs the person their
      // decisions on every other line; but only if nothing else changed the review meanwhile (an
      // account change re-planned it, or it was closed and another opened), whose state stands.
      if (phase.value === 'reviewing' && accountId.value === accountAtStart) {
        read.value = current;
        candidates.value = beforeCandidates;
        notices.value = beforeNotices;
      }
      reportError({
        surface: SURFACE,
        message: 'Could not add a read-anyway page to the statement review',
        severity: 'error',
        error,
        context: { action: 'plan_failed', detail: 'dropped_page' },
      });
      return false;
    } finally {
      readingPage.value = null;
    }
  }

  // ── Commit ────────────────────────────────────────────────────────────────────────────

  /** The update a merge writes: statement facts in, provenance stamped, links untouched. */
  function mergePatch(c: StatementCandidate): UpdateTransactionInput {
    const match = c.match!;
    // A recurring row moved off its due date must keep standing for it, or the next run (or the
    // next import's projection filter) sees that due date as open again.
    const keepsDueDate =
      match.existing.recurringItemId && !match.existing.isProjected
        ? { recurringDueDate: recurringInstanceDate(match.existing) }
        : {};
    // A row can carry ONE import's provenance. A row an earlier import already stamped keeps
    // that stamp: overwriting it would make re-importing the earlier statement miss the row and
    // add the line a second time. This import's line is still covered, as a strong possible
    // match against it (default skip).
    const alreadyStamped = !!match.existing.importFingerprint;
    const provenance = {
      ...keepsDueDate,
      isReconciled: true,
      ...(alreadyStamped
        ? {}
        : {
            statementDescription: c.draft.statementDescription,
            importFingerprint: c.draft.importFingerprint,
            importId: c.draft.importId,
            importSource: c.draft.importSource,
            importPeriod: c.draft.importPeriod,
          }),
      date: c.draft.date,
    };
    // A counterpart in another account: that row BECOMES the one transfer. The payer is the
    // account the money left; the amount stays in the payer's currency.
    if (c.transfer?.kind === 'counterpart') {
      const inbound = c.draft.type === 'income';
      return {
        ...provenance,
        type: 'transfer',
        category: '',
        accountId: inbound ? c.transfer.otherAccountId : c.draft.accountId,
        toAccountId: inbound ? c.draft.accountId : c.transfer.otherAccountId,
        amount: inbound ? match.existing.amount : c.draft.amount,
        currency: inbound ? match.existing.currency : c.draft.currency,
      };
    }
    // The import account is the row's SOURCE: its amount is in this account's currency, so the
    // statement amount replaces it. When the import account is only the DESTINATION of an
    // existing transfer, the amount belongs to the other account and is left alone.
    return match.existing.accountId === c.draft.accountId
      ? { ...provenance, amount: c.draft.amount }
      : provenance;
  }

  async function runMerges(merges: StatementCandidate[]): Promise<number> {
    const transactionsStore = useTransactionsStore();
    const recurring = useRecurringStore();
    let failed = 0;
    for (const c of merges) {
      const match = c.match!;
      let result: Transaction | null | undefined;
      if (match.isProjected && match.recurringItemId) {
        const item = recurring.recurringItems.find((r) => r.id === match.recurringItemId);
        // Materialised exactly as the recurring processor would (its links included: a loan
        // payment amortises, an activity fee stays linked), dated when the bank took the money,
        // and marked with the due date it stands for so the processor never adds a second one.
        result = item
          ? await transactionsStore.createTransaction({
              ...(recurringToTransactionFields(item) as CreateTransactionInput),
              ...(item.activityId ? { activityId: item.activityId } : {}),
              ...(item.loanId ? { loanId: item.loanId } : {}),
              ...mergePatch(c),
              amount: c.draft.amount,
              recurringItemId: item.id,
              ...(match.dueDate ? { recurringDueDate: match.dueDate } : {}),
            } as CreateTransactionInput)
          : null;
      } else {
        result = await transactionsStore.updateTransaction(match.id, mergePatch(c));
      }
      // `wrapAsync` inside the store has already toasted and reported this row's failure with
      // its stack; here it is only counted, so the run reports ONE outcome.
      if (!result) failed += 1;
    }
    return failed;
  }

  async function commit(): Promise<StatementCommitResult> {
    if (phase.value !== 'reviewing') return { kind: 'failed' };
    const transactionsStore = useTransactionsStore();
    const accountsStore = useAccountsStore();
    phase.value = 'committing';

    const adds = adding.value;
    const merges = actionable.value.filter((c) => c.decision === 'merge' && c.match);
    const keep = actionable.value.filter((c) => c.decision === 'add' && c.match).length;
    // How people answer a possible duplicate is what tunes its thresholds.
    const possibles = actionable.value.filter((c) => c.match?.strength === 'possible');
    const possibleAs = (d: StatementDecision) => possibles.filter((c) => c.decision === d).length;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'commit_mix',
      context: {
        action: 'commit_mix',
        detail: [
          `add:${adds.length - keep}`,
          `merge:${merges.length}`,
          `keep:${keep}`,
          `skip:${skipped.value}`,
          `overrides:${overrides.value}`,
          `possible_merge:${possibleAs('merge')}`,
          `possible_keep:${possibleAs('add')}`,
          `possible_skip:${possibleAs('skip')}`,
        ].join('|'),
      },
    });

    // 1. Resolve every transfer's destination amount FIRST: a missing rate fails here, with
    //    nothing written (the store has already reported which rate is missing).
    let entries: CreateTransactionInput[];
    try {
      entries = adds.map((c) =>
        c.draft.type === 'transfer' && c.draft.toAccountId
          ? {
              ...c.draft,
              toAmount: transactionsStore.resolveTransferToAmount(
                c.draft.currency,
                c.draft.toAccountId,
                c.draft.amount
              ),
            }
          : c.draft
      );
    } catch (error) {
      return commitFailed('transfer-rate-missing', error);
    }

    // 2. Balance deltas, computed with the same primitive the single-row cascade uses.
    const deltas = new Map<string, number>();
    const bump = (id: string, delta: number) => deltas.set(id, (deltas.get(id) ?? 0) + delta);
    for (const e of entries) {
      const source = accountsStore.accounts.find((a) => a.id === e.accountId);
      if (source) bump(e.accountId, signedAccountDelta(e.type, e.amount, source.type, true));
      if (e.type === 'transfer' && e.toAccountId) {
        const dest = accountsStore.accounts.find((a) => a.id === e.toAccountId);
        if (dest) {
          bump(
            e.toAccountId,
            signedAccountDelta('transfer', e.toAmount ?? e.amount, dest.type, false)
          );
        }
      }
    }
    const hadNoRows = transactionsStore.transactions.length === 0;

    // 3. The atomic add batch.
    let added = 0;
    try {
      const written = await commitStatementAdds(
        entries,
        [...deltas].map(([id, delta]) => ({ accountId: id, delta: Math.round(delta * 100) / 100 }))
      );
      added = written.transactions.length;
      if (written.skippedIncrements.length) {
        reportError({
          surface: SURFACE,
          message: 'A balance change was skipped: the account was deleted during the import',
          severity: 'warning',
          context: {
            action: 'commit_failed',
            error_code: 'balance-increment-skipped',
            count: written.skippedIncrements.length,
          },
        });
      }
    } catch (error) {
      if (error instanceof ImportNotVisibleError) {
        // Rows may exist unseen. Merging on top would make "don't import again" half-true, so
        // stop here; a later import shows these adds as already added and offers the merges.
        reportError({
          surface: SURFACE,
          message: 'Statement import batch committed but is not visible',
          severity: 'critical',
          error,
          context: { action: 'commit_failed', error_code: 'verify-missing', count: error.missing },
        });
        reset();
        return { kind: 'unverified' };
      }
      return commitFailed('batch-write-threw', error);
    }

    // 4. Reload what the batch bypassed, THEN merge (see the header for why this order).
    await transactionsStore.loadTransactions();
    await accountsStore.loadAccounts();
    const failedMerges = await runMerges(merges);
    const merged = merges.length - failedMerges;

    trackFeature(added + merged > 0 ? true : null, 'transaction');
    if (hadNoRows && added > 0) celebrate('first-transaction');
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'commit',
      context: { action: 'commit', count: added + merged },
    });
    reset();
    if (failedMerges > 0) {
      reportError({
        surface: SURFACE,
        message: 'Some statement lines could not be merged into existing transactions',
        severity: 'error',
        context: { action: 'commit_failed', error_code: 'merge-failed', count: failedMerges },
      });
      return { kind: 'partial', added, merged, failed: failedMerges };
    }
    return { kind: 'ok', added, merged };
  }

  /** Nothing was written: report it and return to the review so the person can retry. */
  function commitFailed(code: string, error: unknown): StatementCommitResult {
    reportError({
      surface: SURFACE,
      message: 'Statement import failed; nothing was written',
      severity: 'error',
      error,
      context: { action: 'commit_failed', error_code: code },
    });
    phase.value = 'reviewing';
    return { kind: 'failed' };
  }

  return {
    // State
    phase,
    read,
    env,
    accountId,
    candidates,
    notices,
    readingPage,
    // Derived
    actionable,
    toAdd,
    toMerge,
    skipped,
    familiar,
    possible,
    overrides,
    allTicked,
    // Actions
    start,
    setAccount,
    decide,
    decideAll,
    editDraft,
    readDroppedPage,
    commit,
    reset,
  };
});
