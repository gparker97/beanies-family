import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useDebouncedSearch } from '@/composables/useDebouncedSearch';

type Result = { ok: boolean; q: string };

function setup(minChars = 2, delayMs = 300) {
  const query = ref('');
  const run = vi.fn<(q: string, signal: AbortSignal) => Promise<Result>>(async (q) => ({
    ok: true,
    q,
  }));
  const onAnswer = vi.fn<(q: string, r: Result) => void>();
  const onIdle = vi.fn();
  const scope = effectScope();
  const api = scope.run(() =>
    useDebouncedSearch<Result>({ query, minChars, delayMs, run, onAnswer, onIdle })
  )!;
  return { query, run, onAnswer, onIdle, scope, ...api };
}

async function type(query: { value: string }, text: string) {
  query.value = text;
  await nextTick();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedSearch', () => {
  it('waits for the pause, then sends one trimmed request', async () => {
    const s = setup();
    await type(s.query, 'po');
    await type(s.query, 'por');
    await type(s.query, ' port ');
    expect(s.searching.value).toBe(true);
    expect(s.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(299);
    expect(s.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.run).toHaveBeenCalledTimes(1);
    expect(s.run.mock.calls[0]![0]).toBe('port');
    await vi.runAllTimersAsync();
    expect(s.onAnswer).toHaveBeenCalledWith('port', { ok: true, q: 'port' });
    expect(s.searching.value).toBe(false);
  });

  it('below the minimum it sends nothing and goes idle', async () => {
    const s = setup(3);
    await type(s.query, 'ab');
    await vi.runAllTimersAsync();
    expect(s.run).not.toHaveBeenCalled();
    expect(s.onIdle).toHaveBeenCalledTimes(1);
    expect(s.searching.value).toBe(false);
  });

  it('reads a reactive minimum through a getter', async () => {
    const min = ref(5);
    const query = ref('');
    const run = vi.fn(async () => 'x');
    const scope = effectScope();
    scope.run(() =>
      useDebouncedSearch({ query, minChars: () => min.value, delayMs: 10, run, onAnswer: vi.fn() })
    );
    query.value = 'abcd';
    await nextTick();
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
    min.value = 2;
    query.value = 'abcde';
    await nextTick();
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('aborts the superseded request and drops its late answer', async () => {
    const s = setup();
    let resolveFirst: (r: Result) => void = () => {};
    s.run.mockImplementationOnce(() => new Promise<Result>((r) => (resolveFirst = r)));
    await type(s.query, 'port');
    await vi.advanceTimersByTimeAsync(300);
    const firstSignal = s.run.mock.calls[0]![1];
    await type(s.query, 'portla');
    expect(firstSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    resolveFirst({ ok: true, q: 'stale' });
    await vi.runAllTimersAsync();
    expect(s.onAnswer).toHaveBeenCalledTimes(1);
    expect(s.onAnswer.mock.calls[0]![0]).toBe('portla');
  });

  it('cancel() aborts the request, clears the timer and stops searching', async () => {
    const s = setup();
    s.run.mockImplementationOnce(() => new Promise<Result>(() => {}));
    await type(s.query, 'port');
    await vi.advanceTimersByTimeAsync(300);
    const signal = s.run.mock.calls[0]![1];
    s.cancel();
    expect(signal.aborted).toBe(true);
    expect(s.searching.value).toBe(false);

    await type(s.query, 'portl');
    s.cancel();
    await vi.runAllTimersAsync();
    expect(s.run).toHaveBeenCalledTimes(1);
  });

  it('stopping the scope (unmount) aborts the request in flight', async () => {
    const s = setup();
    s.run.mockImplementationOnce(() => new Promise<Result>(() => {}));
    await type(s.query, 'port');
    await vi.advanceTimersByTimeAsync(300);
    const signal = s.run.mock.calls[0]![1];
    s.scope.stop();
    expect(signal.aborted).toBe(true);
  });
});
