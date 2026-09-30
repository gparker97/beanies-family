/**
 * The read-only write gate's shared pieces (#95 Phase 3): the installed verdict, and the error a
 * refused write rejects with. The gate itself (`assertWritable`) lives in `docClient.mutate`,
 * which re-exports everything here; this is a dependency-free leaf so that:
 *   - `useStoreActions` can test `instanceof ReadOnlyError`, and `entitlementStore` can install
 *     the gate, without importing `docClient`, which roughly thirty store and sync suites replace
 *     with a factory mock that defines neither (reading a missing export off such a mock throws);
 *   - `recurringProcessor` can ask "is this family read-only?" without instantiating a Pinia
 *     store from a service. The verdict IS `entitlementStore.isReadOnly`, which installs it.
 *
 * INVERTED, LIKE `docClient.setLocalChangeHandler`. `entitlementStore` installs the verdict at
 * init; nothing here imports a store or `docClient`. Its one import is the telemetry barrel,
 * for `skipWhileReadOnly`'s event.
 */
import { logEvent } from '@/services/telemetry';

/** What the installed gate reports for the active family. `block` acts (it is
 * `entitlementStore.isReadOnly`); `wouldBlock` is the dry-run soak signal (read-only in every
 * respect except that nothing acts on it). */
export interface WriteGateVerdict {
  block: boolean;
  wouldBlock: boolean;
}

let gate: (() => WriteGateVerdict) | null = null;

/** Install (or, with `null`, remove) the verdict. Called by `entitlementStore` at init. */
export function setWriteGate(fn: (() => WriteGateVerdict) | null): void {
  gate = fn;
}

/** The current verdict, read at call time; `null` when no gate is installed (tests, and boot
 * before `App.vue` instantiates `entitlementStore`), which every caller treats as writable. */
export function readWriteGate(): WriteGateVerdict | null {
  return gate ? gate() : null;
}

/** Surfaces that have logged `skipped_read_only` this session (one event each, not one per run). */
const skipLogged = new Set<string>();

/**
 * For background work that WRITES (recurring generation, the reminder back-fill): whether to
 * skip this run because the family is read-only. Skipping, rather than attempting the write and
 * being refused, means nothing is lost and nothing is reported: the work simply runs on the
 * next writable run. Logs `{ action: 'skipped_read_only' }` on `surface` once per session.
 */
export function skipWhileReadOnly(surface: string): boolean {
  if (!readWriteGate()?.block) return false;
  if (!skipLogged.has(surface)) {
    skipLogged.add(surface);
    logEvent({
      level: 'info',
      surface,
      message: 'skipped while the family is read-only',
      context: { action: 'skipped_read_only' },
    });
  }
  return true;
}

/** Test-only: forget which surfaces have logged their skip. */
export function __resetWriteGateForTesting(): void {
  gate = null;
  skipLogged.clear();
}

/**
 * The gate's refusal: the family is read-only, so `docClient.mutate` refused this write on the
 * main thread before it reached the worker.
 *
 * AN EXPECTED REFUSAL, NOT A FAILURE. The gate has already spoken (an info toast, one
 * `read-only-gate blocked` event), so `wrapAsync` and `fireAndForgetMutate` swallow it rather
 * than raise the generic error toast and `reportError` every other rejection gets.
 *
 * NEVER SERIALISED, SO NOT IN `protocol.ts` AND NOT IN `ERROR_REGISTRY`. It is thrown before
 * `requestCore`, so it never crosses the worker boundary and never meets `surface()`.
 */
export class ReadOnlyError extends Error {
  /** The collection (or named op) the refused write touched first. Diagnostic only. */
  readonly kind: string;

  constructor(kind: string) {
    super(`write refused: the family is read-only ('${kind}')`);
    this.name = 'ReadOnlyError';
    this.kind = kind;
  }
}
