// Shared test helper (NOT a spec — no `.test`/`.spec` suffix so vitest ignores it).
//
// Installs the inline docClient backend + a fresh empty doc so a store/repo unit
// test drives the REAL new data path (docClient → applyAndProject → projection)
// on the main thread, no Worker required.
import {
  inlineExecutor,
  setInlineSignalHandler,
  __resetInlineBridgeForTesting,
} from '../inlineBridge';
import {
  setInlineExecutor,
  forceInlineMode,
  receiveSignal,
  initDoc,
  __resetDocClientForTesting,
} from '../docClient';
import { __resetApplyAndProjectForTesting } from '../applyAndProject';
import { __resetCacheForTesting } from '../cache';
import { setDeviceWriterId } from '../docActor';
import { resetProjection } from '../../projection';
import type { MutationOp } from '../protocol';

/** Reset all doc-layer singletons, wire inline mode, and start a fresh doc. */
export async function installInlineBackend(): Promise<void> {
  __resetDocClientForTesting();
  __resetApplyAndProjectForTesting();
  __resetInlineBridgeForTesting();
  __resetCacheForTesting();
  // The cache never opens here, so nothing mints the device writer id (#117 Phase 2): set the
  // one this realm's device would have, or a Counter write with writes on would throw.
  setDeviceWriterId('device-inline-test');
  resetProjection();
  setInlineExecutor(inlineExecutor);
  // Same wiring as `bootstrap.ts`: inline signals reach docClient's one handler.
  setInlineSignalHandler(receiveSignal);
  forceInlineMode();
  await initDoc();
}

type PatchOp = Extract<MutationOp, { op: 'patch' }>;

/**
 * Record every op `mutate` sends from now on, while still applying each one through the real
 * inline backend. Call after `installInlineBackend`. Returns the live list.
 */
export function recordMutations(): MutationOp[] {
  const sent: MutationOp[] = [];
  setInlineExecutor((method, args) => {
    if (method === 'mutate') sent.push(structuredClone(args) as MutationOp);
    return inlineExecutor(method, args);
  });
  return sent;
}

/** The `patch` ops among `sent`, with batches flattened, in send order. */
export function patchOpsIn(sent: readonly MutationOp[]): PatchOp[] {
  return sent
    .flatMap((op) => (op.op === 'batch' ? op.ops : [op]))
    .filter((op): op is PatchOp => op.op === 'patch');
}
