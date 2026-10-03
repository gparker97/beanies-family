/**
 * The transaction cascades as ONE worker named op (#117 Phase 2, audit cluster C7).
 *
 * `commitTransactionCascade` writes a transaction AND every money movement it drives (the
 * source and transfer-destination balances, the goal allocation, the loan amortisation and the
 * linked loan account mirror) inside one `Automerge.change`, so a cascade lands whole or not at
 * all. Before this op the stores ran four to six separate mutates per cascade: a failure between
 * them left a transaction without its balance movement and a retry duplicated it; an edit of a
 * description reversed and re-applied the goal allocation and re-amortised the loan.
 *
 * Three modes, all relative (`adjustField`, so two devices' cascades both land after a merge):
 *  - `create`: set the row + apply its effects; the derived fields (`goalAllocApplied`, the loan
 *    portions) are computed here and written onto the row. A row that already exists under the
 *    id is a retry: nothing is applied again.
 *  - `update`: patch the row; reverse + re-apply its effects ONLY when a money field changed
 *    (`MONEY_FIELDS`), keeping the stored derived fields otherwise.
 *  - `delete`: reverse the effects from the STORED derived fields, then delete the row.
 *
 * Pure + vue-free + main-thread-free, like `docOps`. Registered by `registerTransactionOps()`
 * from `applyAndProject.configure` (never at module load: `docOps` is a sibling in a possible
 * import cycle). The goal floor, the loan fold and the host adjustment mirror the core handlers
 * in `docOps.ts` (`applyGoalContributionOp`, `findLoan`, `adjustLoanBalance`), which are private
 * there; the local versions below are the same arithmetic on the same funnel (`foldValue`,
 * `adjustField`, `foldEntity`).
 */
import type { CollectionName, FamilyDocument } from '@/types/automerge';
import type { Account, Asset, Goal, Transaction } from '@/types/models';
import {
  calculateAmortization,
  calculateExtraPayment,
  findLoanDetails,
  type LoanDetails,
} from '@/utils/loanPayment';
import { computeGoalAllocRaw, signedAccountDelta } from '@/utils/finance';
import {
  adjustField,
  fieldDecimals,
  foldEntity,
  foldIndex,
  foldValue,
  resolveField,
  sigma,
  type CounterIndex,
} from './counterFields';
import { registerNamedOp, type NamedOpHandler } from './docOps';
import { canonicalEqual } from './reconcile';
import type { ProjectionDelta } from './protocol';

type AnyRecord = Record<string, unknown>;

export type TransactionCascadeMode = 'create' | 'update' | 'delete';

/** The args main sends (built by `transactionRepository`'s cascade functions). */
export type TransactionCascadeArgs =
  | { mode: 'create'; transaction: Transaction }
  | {
      mode: 'update';
      id: string;
      patch: Record<string, unknown>;
      deleteKeys?: string[];
      updatedAt: string;
    }
  | { mode: 'delete'; id: string };

/** A reference the cascade could not honour because the entity is absent from the document. */
export interface CascadeSkip {
  kind: 'account' | 'goal' | 'loan';
  id: string;
}

/** What the op echoes: the row and every entity whose balance it moved, all folded. */
export interface TransactionCascadeResult {
  mode: TransactionCascadeMode;
  /** `false` when `update`/`delete` found no row under `id` (a concurrent delete): nothing ran. */
  found: boolean;
  /** The row as stored after the change; absent after a delete or when not found. */
  transaction?: Transaction;
  accounts: Account[];
  goals: Goal[];
  assets: Asset[];
  skipped: CascadeSkip[];
}

/** The fields whose change moves money: an edit touching none of these patches the row only. */
export const MONEY_FIELDS: readonly (keyof Transaction)[] = [
  'amount',
  'type',
  'accountId',
  'toAccountId',
  'toAmount',
  'currency',
  'goalId',
  'goalAllocMode',
  'goalAllocValue',
  'loanId',
  'recurringItemId', // decides amortisation vs extra payment
];

/** Owned by the cascade: computed here, never accepted from a patch. */
const DERIVED_FIELDS = ['goalAllocApplied', 'loanInterestPortion', 'loanPrincipalPortion'] as const;

interface Derived {
  goalAllocApplied?: number;
  loanInterestPortion?: number;
  loanPrincipalPortion?: number;
}

const nowIso = (): string => new Date().toISOString();

/** JSON round-trip a live value to a plain object (`undefined` passes through, as in `docOps`). */
function toPlain<T>(value: T): T {
  if (value === undefined) return undefined as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v: unknown): v is AnyRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TRANSACTION_TYPES = new Set(['income', 'expense', 'transfer', 'balance_adjustment']);

/** A malformed shape is a programming error on main: throw, never half-apply a money write. */
function parseArgs(args: Record<string, unknown>): TransactionCascadeArgs {
  const fail = (why: string): Error => new Error(`commitTransactionCascade: ${why}`);
  const { mode } = args;
  if (mode === 'create') {
    const tx = args.transaction;
    if (!isPlainObject(tx)) throw fail('`transaction` must be an object.');
    if (!isNonEmptyString(tx.id)) throw fail('`transaction.id` must be a non-empty string.');
    if (!isNonEmptyString(tx.accountId)) throw fail('`transaction.accountId` must be set.');
    if (!TRANSACTION_TYPES.has(tx.type as string)) throw fail('`transaction.type` is unknown.');
    if (!isFiniteNumber(tx.amount)) throw fail('`transaction.amount` must be a finite number.');
    return { mode, transaction: tx as unknown as Transaction };
  }
  if (mode === 'update') {
    const { id, patch, deleteKeys, updatedAt } = args;
    if (!isNonEmptyString(id)) throw fail('`id` must be a non-empty string.');
    if (!isPlainObject(patch)) throw fail('`patch` must be an object.');
    if (deleteKeys !== undefined && !Array.isArray(deleteKeys)) {
      throw fail('`deleteKeys` must be an array.');
    }
    if (!isNonEmptyString(updatedAt)) throw fail('`updatedAt` must be a non-empty string.');
    if ('amount' in patch && !isFiniteNumber(patch.amount)) {
      throw fail('`patch.amount` must be a finite number.');
    }
    return { mode, id, patch, deleteKeys: deleteKeys as string[] | undefined, updatedAt };
  }
  if (mode === 'delete') {
    if (!isNonEmptyString(args.id)) throw fail('`id` must be a non-empty string.');
    return { mode, id: args.id };
  }
  throw fail(`unknown mode ${String(mode)}.`);
}

/** Where a loan's balance lives (mirrors `docOps.loanHost`). */
function loanHost(loan: LoanDetails): { collection: 'assets' | 'accounts'; field: string } {
  return loan.type === 'asset'
    ? { collection: 'assets', field: 'loan.outstandingBalance' }
    : { collection: 'accounts', field: 'balance' };
}

/**
 * One cascade's writes against one draft, with the one fold index the whole change shares
 * (`adjustField` records each write in it, so every later fold and echo reads the same Σ a
 * rebuild would). Tracks what it touched so the echo covers exactly the entities it moved.
 */
class Cascade {
  private readonly touched = new Map<string, { collection: CollectionName; id: string }>();
  readonly skipped: CascadeSkip[] = [];
  private readonly now = nowIso();
  private readonly draft: FamilyDocument;
  private readonly writerId: string;
  private readonly index: CounterIndex;

  constructor(draft: FamilyDocument, writerId: string, index: CounterIndex) {
    this.draft = draft;
    this.writerId = writerId;
    this.index = index;
  }

  private collection<T>(name: CollectionName): Record<string, T> {
    return (this.draft[name] ?? {}) as unknown as Record<string, T>;
  }

  private touch(collection: CollectionName, id: string): void {
    this.touched.set(`${collection}/${id}`, { collection, id });
  }

  /** Move an account's balance by `delta`; a missing account is recorded, never a throw. */
  private adjustAccount(id: string, delta: number): void {
    const account = this.collection<AnyRecord>('accounts')[id];
    if (!account) {
      this.skipped.push({ kind: 'account', id });
      return;
    }
    if (delta !== 0) {
      if (adjustField(this.draft, 'accounts', id, 'balance', delta, this.writerId, this.index)) {
        account.updatedAt = this.now;
      }
    }
    this.touch('accounts', id);
  }

  /**
   * Apply (`1`) or reverse (`-1`) a row's effect on its account balances: liability-aware via
   * `signedAccountDelta`, the transfer destination credited its STORED `toAmount`.
   */
  private applyBalances(tx: Transaction, direction: 1 | -1): void {
    const accounts = this.collection<Account>('accounts');
    const source = accounts[tx.accountId];
    if (source) {
      this.adjustAccount(
        tx.accountId,
        signedAccountDelta(tx.type, tx.amount, source.type, true) * direction
      );
    } else {
      this.skipped.push({ kind: 'account', id: tx.accountId });
    }
    if (tx.type === 'transfer' && tx.toAccountId) {
      const dest = accounts[tx.toAccountId];
      if (dest) {
        const magnitude = tx.toAmount ?? tx.amount;
        this.adjustAccount(
          tx.toAccountId,
          signedAccountDelta('transfer', magnitude, dest.type, false) * direction
        );
      } else {
        this.skipped.push({ kind: 'account', id: tx.toAccountId });
      }
    }
  }

  private foldedGoalAmount(goal: Goal, id: string): { folded: number; decimals: number } {
    const decimals = fieldDecimals(resolveField('goals', 'currentAmount'), goal);
    const folded = foldValue(
      goal.currentAmount,
      sigma(this.index, 'goals', id, 'currentAmount'),
      0,
      decimals
    );
    return { folded, decimals };
  }

  /**
   * Move a goal's progress by `delta`, floored at 0 and auto-completing at the target (sets
   * `isCompleted` true only), exactly as `applyGoalContributionOp` does. Returns the applied
   * delta (0 when the goal is absent).
   */
  private contributeToGoal(goalId: string, delta: number): number {
    const goal = this.collection<Goal>('goals')[goalId];
    if (!goal) {
      this.skipped.push({ kind: 'goal', id: goalId });
      return 0;
    }
    const { folded, decimals } = this.foldedGoalAmount(goal, goalId);
    const applied = Math.max(delta, -folded);
    if (applied !== 0) {
      let changed = adjustField(
        this.draft,
        'goals',
        goalId,
        'currentAmount',
        applied,
        this.writerId,
        this.index
      );
      if (!goal.isCompleted && foldValue(folded, applied, 0, decimals) >= goal.targetAmount) {
        goal.isCompleted = true;
        changed = true;
      }
      if (changed) goal.updatedAt = this.now;
    }
    this.touch('goals', goalId);
    return applied;
  }

  /** The allocation a row credits its goal: the raw share capped at what the goal still needs. */
  private allocateGoal(tx: Transaction): number {
    if (!tx.goalId || !tx.goalAllocMode || !tx.goalAllocValue) return 0;
    const goal = this.collection<Goal>('goals')[tx.goalId];
    if (!goal) {
      this.skipped.push({ kind: 'goal', id: tx.goalId });
      return 0;
    }
    if (goal.isCompleted) return 0;
    const raw = computeGoalAllocRaw(tx.goalAllocMode, tx.goalAllocValue, tx.amount);
    const { folded } = this.foldedGoalAmount(goal, tx.goalId);
    const applied = Math.min(raw, Math.max(0, goal.targetAmount - folded));
    if (applied <= 0) return 0;
    return this.contributeToGoal(tx.goalId, applied);
  }

  /** The loan `loanId` names, with its `outstandingBalance` FOLDED (mirrors `docOps.findLoan`). */
  private findLoan(loanId: string): LoanDetails | null {
    const loan = findLoanDetails(
      loanId,
      Object.values(this.collection<Asset>('assets')),
      Object.values(this.collection<Account>('accounts'))
    );
    if (!loan) return null;
    const { collection, field } = loanHost(loan);
    const host = this.collection<AnyRecord>(collection)[loan.entityId];
    loan.outstandingBalance = foldValue(
      loan.outstandingBalance,
      sigma(this.index, collection, loan.entityId, field),
      0,
      fieldDecimals(resolveField(collection, field), host)
    );
    return loan;
  }

  /**
   * THE linked-loan mirror: move the loan host's balance by `delta` and, for an asset loan with
   * a linked loan account, the mirror account by the same delta, relatively, in this change.
   * Used by the store path and the recurring processor alike (both go through this op).
   */
  private adjustLoan(loan: LoanDetails, delta: number): void {
    if (loan.type === 'account') {
      this.adjustAccount(loan.entityId, delta);
      return;
    }
    if (delta !== 0) {
      const wrote = adjustField(
        this.draft,
        'assets',
        loan.entityId,
        'loan.outstandingBalance',
        delta,
        this.writerId,
        this.index
      );
      if (wrote) this.collection<AnyRecord>('assets')[loan.entityId]!.updatedAt = this.now;
    }
    this.touch('assets', loan.entityId);
    if (loan.linkedAccountId) this.adjustAccount(loan.linkedAccountId, delta);
  }

  /** Amortise (recurring) or extra-pay (one-time) the row's loan; the portions for the row. */
  private applyLoan(
    tx: Transaction
  ): Pick<Derived, 'loanInterestPortion' | 'loanPrincipalPortion'> {
    if (!tx.loanId) return {};
    const loan = this.findLoan(tx.loanId);
    if (!loan) {
      this.skipped.push({ kind: 'loan', id: tx.loanId });
      return {};
    }
    if (loan.outstandingBalance <= 0) return {};
    const res = tx.recurringItemId
      ? calculateAmortization(loan.outstandingBalance, loan.interestRate, tx.amount)
      : calculateExtraPayment(loan.outstandingBalance, tx.amount);
    this.adjustLoan(loan, res.newBalance - loan.outstandingBalance);
    return { loanInterestPortion: res.interestPortion, loanPrincipalPortion: res.principalPortion };
  }

  /** Restore the STORED principal portion to the loan (host and mirror). */
  private reverseLoan(tx: Transaction): void {
    if (!tx.loanId || !tx.loanPrincipalPortion) return;
    const loan = this.findLoan(tx.loanId);
    if (!loan) {
      this.skipped.push({ kind: 'loan', id: tx.loanId });
      return;
    }
    this.adjustLoan(loan, tx.loanPrincipalPortion);
  }

  /** Apply a row's effects and return the derived fields it earns. A balance adjustment is an
   *  audit echo of a balance already written: no effects. */
  applyEffects(tx: Transaction): Derived {
    if (tx.type === 'balance_adjustment') return {};
    this.applyBalances(tx, 1);
    const goalAllocApplied = this.allocateGoal(tx);
    return {
      ...(goalAllocApplied > 0 ? { goalAllocApplied } : {}),
      ...this.applyLoan(tx),
    };
  }

  /** Reverse a stored row's effects from its STORED derived fields. */
  reverseEffects(stored: Transaction): void {
    if (stored.type === 'balance_adjustment') return;
    this.applyBalances(stored, -1);
    if (stored.goalId && stored.goalAllocApplied) {
      this.contributeToGoal(stored.goalId, -stored.goalAllocApplied);
    }
    this.reverseLoan(stored);
  }

  /** The echo: every touched entity, folded through the funnel, plus its projection delta. */
  echoes(): { deltas: ProjectionDelta[]; accounts: Account[]; goals: Goal[]; assets: Asset[] } {
    const out = {
      deltas: [] as ProjectionDelta[],
      accounts: [] as Account[],
      goals: [] as Goal[],
      assets: [] as Asset[],
    };
    for (const { collection, id } of this.touched.values()) {
      const live = this.collection<unknown>(collection)[id];
      if (live === undefined) {
        out.deltas.push({ kind: 'remove', collection, id });
        continue;
      }
      const entity = foldEntity(collection, id, toPlain(live), this.index);
      out.deltas.push({ kind: 'upsert', collection, id, entity });
      if (collection === 'accounts') out.accounts.push(entity as Account);
      else if (collection === 'goals') out.goals.push(entity as Goal);
      else if (collection === 'assets') out.assets.push(entity as Asset);
    }
    return out;
  }
}

/** Write the derived fields onto a row: set what the cascade earned, clear the rest. */
function writeDerived(target: AnyRecord, derived: Derived): void {
  for (const key of DERIVED_FIELDS) {
    const value = derived[key];
    if (value !== undefined) target[key] = value;
    else delete target[key];
  }
}

/** Patch a live row key by key, skipping unchanged values so an all-unchanged edit leaves the
 *  heads untouched (`changed: false`). Returns the number of writes. */
function writePatch(live: AnyRecord, patch: AnyRecord, deleteKeys: readonly string[]): number {
  let writes = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue; // Automerge rejects `undefined`; clears travel in `deleteKeys`
    if (canonicalEqual(toPlain(live[k]), v)) continue;
    live[k] = v;
    writes++;
  }
  for (const k of deleteKeys) {
    if (live[k] === undefined) continue;
    delete live[k];
    writes++;
  }
  return writes;
}

const commitTransactionCascadeOp: NamedOpHandler = (draft, rawArgs, { writerId }) => {
  const args = parseArgs(rawArgs);
  const rows = (draft.transactions ?? {}) as unknown as Record<string, AnyRecord>;
  const index = foldIndex(draft);
  const cascade = new Cascade(draft, writerId, index);

  const finish = (found: boolean, id: string): ReturnType<NamedOpHandler> => {
    const live = rows[id];
    const transaction = live === undefined ? undefined : (toPlain(live) as unknown as Transaction);
    const echo = cascade.echoes();
    const rowDelta: ProjectionDelta = transaction
      ? { kind: 'upsert', collection: 'transactions', id, entity: transaction }
      : { kind: 'remove', collection: 'transactions', id };
    const result: TransactionCascadeResult = {
      mode: args.mode,
      found,
      ...(transaction ? { transaction } : {}),
      accounts: echo.accounts,
      goals: echo.goals,
      assets: echo.assets,
      skipped: cascade.skipped,
    };
    return { result, deltas: [rowDelta, ...echo.deltas] };
  };

  switch (args.mode) {
    case 'create': {
      const id = args.transaction.id;
      // A retry of a committed create: the row and its effects are already here.
      if (rows[id] !== undefined) return finish(true, id);
      // A COPY: inline mode hands the worker the caller's own object.
      const tx = { ...(args.transaction as unknown as AnyRecord) };
      for (const key of DERIVED_FIELDS) delete tx[key];
      writeDerived(tx, cascade.applyEffects(tx as unknown as Transaction));
      rows[id] = tx;
      return finish(true, id);
    }
    case 'delete': {
      const live = rows[args.id];
      if (live === undefined) return finish(false, args.id);
      cascade.reverseEffects(toPlain(live) as unknown as Transaction);
      delete rows[args.id];
      return finish(true, args.id);
    }
    case 'update': {
      const live = rows[args.id];
      if (live === undefined) return finish(false, args.id);
      const patch = { ...args.patch };
      const deleteKeys = (args.deleteKeys ?? []).filter(
        (k) => !(DERIVED_FIELDS as readonly string[]).includes(k)
      );
      for (const key of DERIVED_FIELDS) delete patch[key];

      const before = toPlain(live) as unknown as Transaction;
      const after: AnyRecord = { ...(before as unknown as AnyRecord), ...patch };
      for (const k of deleteKeys) delete after[k];
      const moneyChanged = MONEY_FIELDS.some(
        (f) => !canonicalEqual((before as unknown as AnyRecord)[f], after[f])
      );

      if (moneyChanged) {
        cascade.reverseEffects(before);
        writePatch(live, patch, deleteKeys);
        const next = toPlain(live) as unknown as Transaction;
        writeDerived(live, cascade.applyEffects(next));
        live.updatedAt = args.updatedAt;
      } else if (writePatch(live, patch, deleteKeys) > 0) {
        live.updatedAt = args.updatedAt;
      }
      return finish(true, args.id);
    }
  }
};

/** Register the cascade op. Called from `applyAndProject.configure`, beside the photo ops. */
export function registerTransactionOps(): void {
  registerNamedOp('commitTransactionCascade', commitTransactionCascadeOp);
}
