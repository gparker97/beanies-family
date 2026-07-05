/**
 * ADR-032 — one-time main-thread wiring for the doc worker / inline fallback.
 * Called once at app startup (main.ts) before mount.
 */
import { isFlagEnabled } from '@/config/flags';
import * as docClient from './docClient';
import { inlineExecutor } from './inlineBridge';

let bootstrapped = false;

export function bootstrapDocClient(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Inline fallback: the SAME applyAndProject on the main thread when the worker
  // can't spawn, dies, or is flagged off.
  docClient.setInlineExecutor(inlineExecutor);

  // Worker-death re-hydration: reload the doc from the encrypted cache after a
  // respawn (docClient re-posts the retained key first).
  docClient.setRehydrator((familyId) => docClient.initAndLoadCache(familyId).then(() => undefined));

  // docWorker kill-switch — off (prod default) forces the inline path; on
  // (dev default) spawns the real worker lazily on first use.
  if (!isFlagEnabled('docWorker')) docClient.forceInlineMode();

  // Backgrounding cache flush — narrows the ≤debounce last-edit-loss window.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void docClient.flush();
    });
  }
}
