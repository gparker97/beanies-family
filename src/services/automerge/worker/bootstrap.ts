/**
 * ADR-032 — one-time main-thread wiring for the doc worker / inline fallback.
 * Called once at app startup (main.ts) before mount.
 */
import { isFlagEnabled } from '@/config/flags';
import * as docClient from './docClient';
import { inlineExecutor } from './inlineBridge';
import { seedRemoteBaseline } from '@/services/sync/syncService';

let bootstrapped = false;

export function bootstrapDocClient(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Inline fallback: the SAME applyAndProject on the main thread when the worker
  // can't spawn, dies, or is flagged off.
  docClient.setInlineExecutor(inlineExecutor);

  // Worker-death re-hydration: reload the doc from the encrypted cache after a
  // respawn (docClient re-posts the retained key first).
  //
  // Forward the baseline row it returns — including `null`. On a `recovered` load
  // the worker DELETES the durable row on purpose (the rebuilt doc may have lost
  // the post-last-save tail), and dropping the result here would leave main's
  // in-memory baseline intact and misleading. Since #65 that object also carries
  // the Drive-heads fingerprint, so a truncated doc can match its own recorded
  // fingerprint and skip the read it most needs.
  docClient.setRehydrator((familyId) =>
    docClient
      .initAndLoadCache(familyId)
      .then((res) => {
        seedRemoteBaseline(res.remoteBaseline);
      })
      .then(() => undefined)
  );

  // docWorker kill-switch — off (prod default) forces the inline path; on
  // (dev default) spawns the real worker lazily on first use.
  if (!isFlagEnabled('docWorker')) docClient.forceInlineMode();

  // Backgrounding cache flush — narrows the ≤debounce last-edit-loss window. On
  // FOREGROUND, probe the worker: a backgrounded mobile PWA may have had its worker
  // OS-reaped without firing `onerror`, so proactively recover it here (the internal
  // guards in checkWorkerLiveness make this a no-op when there's nothing to probe)
  // rather than letting the user's first real RPC hit a 45 s timeout.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Failure is already classified + reported by docClient's notifyFailure
        // policy — swallow the rejection so the same failure doesn't ALSO report
        // via main.ts's global unhandledrejection catch-all (double firehose).
        docClient.flush().catch(() => {});
        return;
      }
      void docClient.checkWorkerLiveness();
    });
  }
}
