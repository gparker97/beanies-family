/**
 * Bounded wait for the Automerge doc to finish loading.
 *
 * A full-page redirect return (calendar / unified reconnect) re-boots the app in
 * parallel with the resume watcher, but the CRDT commit needs the doc loaded.
 * Shared by `useCalendarRedirectResume` and `useUnifiedRedirectResume` so the two
 * redirect-resume flows use one identical wait discipline (no drift).
 *
 * Resolves `true` once loaded, `false` on timeout.
 */
export async function waitForDocLoaded(timeoutMs = 15_000): Promise<boolean> {
  const { isLoaded } = await import('@/services/automerge/projection');
  if (isLoaded()) return true;
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (isLoaded()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}
