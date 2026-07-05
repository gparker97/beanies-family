/**
 * Automerge document service — post-ADR-032 this is a thin compatibility shim.
 *
 * The Automerge doc now lives in the Web Worker; reads come from the main-thread
 * `projection` and writes go through `docClient`. This module retains only the
 * still-synchronous helpers whose consumers didn't need to change:
 *   - `docVersion` — the reactive change trigger (re-exported from `projection`),
 *   - `isDocLoaded()` — re-backed against the projection's loaded flag,
 *   - `resetDoc()` — sign-out reset (drops the worker doc + clears the projection).
 *
 * The mutation/read API (`changeDoc`/`getDoc`/`initDoc`/`loadDoc`/`saveDoc`/
 * `mergeDoc`/`replaceDoc`/`onDocPersistNeeded`) has been retired — every caller
 * now uses `docClient` (worker RPC) + `projection` (sync reads).
 */
import { docVersion, isLoaded } from './projection';
import * as docClient from './worker/docClient';

export { docVersion };

/** True once a document has been loaded/created. Re-backs the ~14 consumers
 * (driveTokenRecovery, listStore, settingsStore, useCalendarNudge, useNotifications,
 * the docVersion-computed stores) that guard on a ready doc. */
export function isDocLoaded(): boolean {
  return isLoaded();
}

/** Sign-out / family-switch: drop the worker's doc AND clear the main-thread
 * projection (prevents cross-session data bleed). Returns the RPC promise so
 * callers may await; sync callers may fire-and-forget. */
export function resetDoc(): Promise<void> {
  return docClient.reset();
}
