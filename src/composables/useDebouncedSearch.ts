import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type WatchSource } from 'vue';

/**
 * A search box's request plumbing: wait for typing to pause, send one request for the trimmed
 * query, abort the request a newer keystroke supersedes, and drop any answer that arrives
 * after it has been superseded. Extracted from `HomeTownField.vue` (#150) so the home town
 * and the location fields share one copy.
 *
 * `query` is the raw text (a ref or a getter). Below `minChars` (after trimming) nothing is
 * sent and `onIdle` runs, so a caller can clear its list; a caller that has its own reasons
 * not to search hands in a getter that returns '' for those cases.
 *
 * `searching` is true from the keystroke until the answer for the current query lands, so a
 * caller can keep the previous list on screen with a spinner. `run` must never throw: it
 * returns its outcome as a value (an aborted request included), and `onAnswer` receives it
 * only while it is still the newest question. Everything pending is cancelled when the
 * owning component unmounts (or the effect scope stops).
 */
export interface DebouncedSearchOptions<R> {
  query: WatchSource<string>;
  minChars: MaybeRefOrGetter<number>;
  delayMs: number;
  run: (q: string, signal: AbortSignal) => Promise<R>;
  onAnswer: (q: string, result: R) => void;
  onIdle?: () => void;
}

export function useDebouncedSearch<R>(options: DebouncedSearchOptions<R>) {
  const searching = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  function clearPending(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  }

  /** Abort whatever is waiting or in flight; nothing it returns will be delivered. */
  function cancel(): void {
    clearPending();
    searching.value = false;
  }

  async function runSearch(q: string): Promise<void> {
    const mine = new AbortController();
    controller = mine;
    const result = await options.run(q, mine.signal);
    // A newer keystroke (or unmount) superseded this request: its answer is not wanted.
    if (controller !== mine) return;
    controller = null;
    searching.value = false;
    options.onAnswer(q, result);
  }

  watch(options.query, (raw) => {
    clearPending();
    const q = (raw ?? '').trim();
    if (q.length < toValue(options.minChars)) {
      searching.value = false;
      options.onIdle?.();
      return;
    }
    searching.value = true;
    timer = setTimeout(() => {
      timer = null;
      void runSearch(q);
    }, options.delayMs);
  });

  onScopeDispose(clearPending);

  return { searching, cancel };
}
