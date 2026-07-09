// Bounded-concurrency pool (#32 + #34).
//
// Runs `tasks` with at most `limit` in flight. Each task owns its own try/catch;
// the pool itself never rejects, so a single failing task can't abort the batch.
// Shared by the calendar sync + clash orchestrators.
//
// `shouldAbort` lets a caller stop dispatching NEW tasks once continuing is
// pointless — e.g. the connection's refresh token was permanently revoked, so
// every remaining task would fail identically. It is checked before each
// dispatch, never mid-task: in-flight work always runs to completion.
// Defaults to "never abort", so existing callers are behaviourally unchanged.
export async function runPooled(
  tasks: Array<() => Promise<void>>,
  limit: number,
  shouldAbort: () => boolean = () => false
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      if (shouldAbort()) return;
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
