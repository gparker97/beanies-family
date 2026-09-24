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
import { resetProjection } from '../../projection';

/** Reset all doc-layer singletons, wire inline mode, and start a fresh doc. */
export async function installInlineBackend(): Promise<void> {
  __resetDocClientForTesting();
  __resetApplyAndProjectForTesting();
  __resetInlineBridgeForTesting();
  __resetCacheForTesting();
  resetProjection();
  setInlineExecutor(inlineExecutor);
  // Same wiring as `bootstrap.ts`: inline signals reach docClient's one handler.
  setInlineSignalHandler(receiveSignal);
  forceInlineMode();
  await initDoc();
}
