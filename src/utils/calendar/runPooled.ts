// Bounded-concurrency pool (#32 + #34).
//
// Runs `tasks` with at most `limit` in flight. Each task owns its own try/catch;
// the pool itself never rejects, so a single failing task can't abort the batch.
// Shared by the calendar sync + clash orchestrators.
export async function runPooled(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
