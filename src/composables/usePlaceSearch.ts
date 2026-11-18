import { computed, onScopeDispose, ref } from 'vue';
import { useDebouncedSearch } from '@/composables/useDebouncedSearch';
import { usePlaceSearchStore } from '@/stores/placeSearchStore';
import type { PlaceRef } from '@/types/models';
import type { PlaceFieldKind, PlaceSearchErrorCode, PlaceSuggestion } from '@/types/placeSearch';
import { parseLocation } from '@/utils/location/locationLinks';
import {
  SUB_PREMISE_KEYWORDS,
  addressCarriesTitle,
  composePlaceText,
  makePlaceRef,
  splitKeptDetail,
  validPlace,
} from '@/utils/location/placeText';
import { wordTokenList } from '@/utils/textSimilarity';

/**
 * One location field's place search (#150, ADR-049): the per-field orchestrator, one instance
 * per `LocationField` (several are mounted at once in the vacation wizard). It calls the store
 * only and never logs itself: every outcome is reported through the store's `note*` calls.
 *
 * It owns the 400 ms debounce (by composing `useDebouncedSearch`), the per-session cache, the
 * six-requests-per-session cap, the one trimmed retry and `pick()`. A field session runs until
 * a pick, a clear or `reset()`. The component never sees a signal, a cache or a cap.
 *
 * A lookup is only ever started by the member's own keystroke in that field: the component
 * hands each input to `onInput`, and nothing else (a parent rewriting the text, Remove putting
 * the typing back, availability returning after a quiet period or offline) asks for anything.
 * A lookup is skipped (no request) when the Lambda would refuse the text
 * (`isSendablePlaceQuery`: under 3 or over 200 characters, any `://`, an email, a line break),
 * when it holds a bare link, or when the store is not `available` at the moment of sending.
 */

/** Long enough to skip the keystrokes in a word; a lookup costs real money. */
export const PLACE_SEARCH_DEBOUNCE_MS = 400;
export const PLACE_SEARCH_MIN_CHARS = 3;
/** Thrift only (the Lambda's daily cap is the spend bound): requests per field session. */
export const PLACE_SEARCH_SESSION_CAP = 6;
/** How long a provider request runs before the field shows its searching mark, so a fast
 *  answer never flickers it. */
export const PLACE_SEARCH_SLOW_MS = 150;

/**
 * What the last completed lookup found: `results` (one or more suggestions), `none` (it
 * completed and found nothing, after the trimmed retry when one ran), or `idle` (anything
 * else: nothing asked yet, a keystroke since, a cancel, a failure, a refusal, a cap). Only
 * `none` is shown to the member, so every silent case stays `idle`.
 */
export type PlaceLookupState = 'idle' | 'results' | 'none';

/** The words before the first sub-premise keyword (or `#…`) after the first word, else the
 *  first five words; '' when that is the query itself (no retry to make). */
export function trimmedRetryQuery(q: string): string {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4) return '';
  const cut = words.findIndex((word, i) => {
    if (i === 0) return false;
    if (word.startsWith('#')) return true;
    const tokens = wordTokenList(word);
    return tokens.length === 1 && SUB_PREMISE_KEYWORDS.has(tokens[0]!);
  });
  const kept = cut > 0 ? words.slice(0, cut) : words.slice(0, 5);
  const retry = kept.join(' ');
  return retry && retry !== words.join(' ') ? retry : '';
}

const QUERY_LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;
const QUERY_EMAIL_HOST = /@[^\s@]+\.[^\s@]+/;
/** The Lambda's `MAX_QUERY_CHARS`. */
export const PLACE_SEARCH_MAX_CHARS = 200;
/** The Lambda's `MAX_TEXT_CHARS`: the longest suggestion text, and so the longest stored title. */
export const PLACE_TITLE_MAX_CHARS = 200;

/**
 * The title a pick stores (ADR-049 addendum of 2026-11-18): a named place's main text (`kind:
 * 'place'`), trimmed and capped. None for an address, and none when the address already carries
 * every word of it (the "place" is just its address: "1 Raffles Place" against "1 Raffles Pl,
 * Singapore 048616"), so the saved string never repeats itself.
 */
export function pickTitle(suggestion: PlaceSuggestion, address: string): string | undefined {
  if (suggestion.kind !== 'place') return undefined;
  const title = clipTitle(suggestion.main.trim());
  if (!title || addressCarriesTitle(title, address)) return undefined;
  return title;
}

/** Cap at `PLACE_TITLE_MAX_CHARS` without leaving half a surrogate pair (the Lambda's `clip`). */
function clipTitle(text: string): string {
  if (text.length <= PLACE_TITLE_MAX_CHARS) return text;
  const cut = text.slice(0, PLACE_TITLE_MAX_CHARS);
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut).trim();
}

/**
 * Whether the `place-search` Lambda would accept this text as a query. The client refuses the
 * same text BEFORE sending, so a refused query never spends a session request or reads as a
 * failure, and text holding a link (any `://`), an email or a line break is never sent (the
 * privacy page says so). Mirrors `normaliseQuery` in
 * `infrastructure/lambda/place-search/createHandler.mjs`; a parity test imports the real one.
 */
export function isSendablePlaceQuery(raw: string): boolean {
  if (typeof raw !== 'string' || QUERY_LINE_BREAK.test(raw)) return false;
  const q = raw.trim();
  if (q.length < PLACE_SEARCH_MIN_CHARS || q.length > PLACE_SEARCH_MAX_CHARS) return false;
  return !q.includes('://') && !QUERY_EMAIL_HOST.test(q);
}

export type PlacePickResult =
  | { ok: true; place: PlaceRef; text: string; detail: string }
  | { ok: false; code: PlaceSearchErrorCode | 'unavailable' | 'dev_capped' | 'superseded' };

type Answer =
  | { ok: true; suggestions: PlaceSuggestion[] }
  | { ok: false; code: PlaceSearchErrorCode | 'unavailable' | 'dev_capped' | 'session_cap' };

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export function usePlaceSearch(options: { fieldKind: PlaceFieldKind }) {
  const store = usePlaceSearchStore();
  const { fieldKind } = options;

  const suggestions = ref<PlaceSuggestion[]>([]);
  const available = computed(() => store.available);
  const state = ref<PlaceLookupState>('idle');

  /**
   * A provider request is in flight: true from the moment the first request of a lookup is
   * sent (never during the debounce, never for a cached answer) until the lookup's answer
   * lands or it is aborted (a superseding keystroke, blur, Escape, Keep what I typed, a
   * reset). The trimmed retry runs inside the same span, so there is no gap between the two.
   */
  const requesting = ref(false);
  const slowRaw = ref(false);
  /** `requesting` once it has lasted `PLACE_SEARCH_SLOW_MS`, while the store is available:
   *  what the field shows its searching mark for. */
  const slowLookup = computed(() => slowRaw.value && store.available);
  /** The signal of the lookup `requesting` describes, so a superseded one cannot clear it. */
  let requestSignal: AbortSignal | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;

  function endRequesting(signal: AbortSignal | null): void {
    if (signal === null || requestSignal !== signal) return;
    requestSignal = null;
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = null;
    requesting.value = false;
    slowRaw.value = false;
  }

  function beginRequesting(signal: AbortSignal): void {
    if (requestSignal === signal || signal.aborted) return;
    endRequesting(requestSignal);
    requestSignal = signal;
    requesting.value = true;
    slowTimer = setTimeout(() => {
      slowTimer = null;
      slowRaw.value = true;
    }, PLACE_SEARCH_SLOW_MS);
    signal.addEventListener('abort', () => endRequesting(signal), { once: true });
  }

  const cache = new Map<string, PlaceSuggestion[]>();
  let requests = 0;
  let capNoted = false;
  let pickController: AbortController | null = null;

  /** Sendable, and no bare link either (`zoom.us/j/1` holds no `://` but is still a link). */
  function wouldSearch(raw: string): boolean {
    return isSendablePlaceQuery(raw) && parseLocation(raw.trim()).links.length === 0;
  }

  /**
   * What the debounce sees: the trimmed text of the member's last keystroke, or '' when this
   * field must not ask. Written ONLY by `onInput`, so nothing but a keystroke starts a lookup.
   */
  const searchable = ref('');

  /** The member typed (or pasted, or dictated) into this field's typing input. */
  function onInput(raw: string): void {
    const text = raw ?? '';
    // Any keystroke clears the last lookup's "nothing found"; the next answer sets it afresh.
    state.value = 'idle';
    if (!text.trim()) resetSession();
    // A quiet period ends by the clock, not only by its timer (a sleeping device never fires
    // it), so it is settled before `available` is read.
    store.refreshQuiet();
    const sendable = wouldSearch(text);
    // A build with no endpoint is noted once per session, the first time a lookup would run.
    if (sendable && store.unavailableReason === 'not-configured') {
      store.noteQuiet('not-configured', fieldKind);
    }
    searchable.value = sendable && store.available ? text.trim() : '';
  }

  async function ask(
    q: string,
    signal: AbortSignal,
    attempt: 'typed' | 'retry'
  ): Promise<Answer & { fromCache?: boolean }> {
    const cached = cache.get(normalize(q));
    if (cached) return { ok: true, suggestions: cached, fromCache: true };
    if (requests >= PLACE_SEARCH_SESSION_CAP) return { ok: false, code: 'session_cap' };
    requests++;
    beginRequesting(signal);
    const result = await store.requestSuggestions(q, { signal, fieldKind, attempt });
    if (result.ok) cache.set(normalize(q), result.suggestions);
    return result;
  }

  async function run(q: string, signal: AbortSignal): Promise<Answer> {
    // Read when the lookup is sent: the store may have gone quiet or offline since the
    // keystroke (never a reactive dependency, so its return starts nothing).
    store.refreshQuiet();
    if (!store.available) return { ok: false, code: 'unavailable' };
    const first = await ask(q, signal, 'typed');
    if (first.ok && first.fromCache) store.noteCachedSuggest(first.suggestions.length, fieldKind);
    if (!first.ok || first.suggestions.length > 0 || first.fromCache || signal.aborted)
      return first;
    // Unit-heavy input often finds nothing until the sub-premise words are dropped (the spike).
    const retryQ = trimmedRetryQuery(q);
    if (!retryQ) return first;
    const second = await ask(retryQ, signal, 'retry');
    if (!second.ok) return second.code === 'session_cap' ? first : second;
    if (second.fromCache) store.noteCachedSuggest(second.suggestions.length, fieldKind);
    // The typed query now answers with what the retry found.
    cache.set(normalize(q), second.suggestions);
    return second;
  }

  const { searching, cancel: cancelSearch } = useDebouncedSearch<Answer>({
    query: searchable,
    minChars: PLACE_SEARCH_MIN_CHARS,
    delayMs: PLACE_SEARCH_DEBOUNCE_MS,
    run: async (q, signal) => {
      try {
        return await run(q, signal);
      } finally {
        endRequesting(signal);
      }
    },
    onAnswer: (_q, result) => {
      if (result.ok) {
        suggestions.value = result.suggestions;
        state.value = result.suggestions.length > 0 ? 'results' : 'none';
        return;
      }
      suggestions.value = [];
      state.value = 'idle';
      if (result.code === 'session_cap' && !capNoted) {
        capNoted = true;
        store.noteQuiet('session-cap', fieldKind);
      }
    },
    onIdle: () => {
      suggestions.value = [];
      state.value = 'idle';
    },
  });

  /** Drop the lookup waiting or in flight; its "nothing found" no longer applies either. */
  function cancel(): void {
    cancelSearch();
    state.value = 'idle';
  }

  function resetSession(): void {
    cache.clear();
    requests = 0;
    capNoted = false;
  }

  /** End the field session: no request pending, no list, a fresh cache and cap. */
  function reset(): void {
    cancel();
    // The next keystroke asks afresh, even for the text the session ended on.
    searchable.value = '';
    pickController?.abort();
    pickController = null;
    suggestions.value = [];
    resetSession();
  }

  /**
   * Turn a tapped suggestion into the field's pair: Google's formatted address as the place
   * line (one address fetch), headed by the place's name for a named place (`pickTitle`), and
   * the typed text neither carries kept as the detail. On failure
   * nothing changes and the field shows `location.pickFailed`; tapping again retries.
   *
   * `stillCurrent` is asked once the address arrives (up to 10 s later): when the member has
   * moved on meanwhile (kept typing, Keep what I typed, Escape, another pick), the answer is
   * dropped as `superseded`, noted, and the session goes on untouched.
   */
  async function pick(
    suggestion: PlaceSuggestion,
    typed: string,
    stillCurrent: () => boolean = () => true
  ): Promise<PlacePickResult> {
    pickController?.abort();
    const mine = new AbortController();
    pickController = mine;
    const answer = await store.requestAddress(suggestion.placeId, {
      signal: mine.signal,
      fieldKind,
    });
    if (pickController === mine) pickController = null;
    if (mine.signal.aborted) return { ok: false, code: 'aborted' };
    if (!stillCurrent()) {
      store.notePickSuperseded(fieldKind);
      return { ok: false, code: 'superseded' };
    }
    if (!answer.ok) return answer;
    const name = answer.address.trim();
    const title = pickTitle(suggestion, name);
    // Worked out against what is stored (the title, then the formatted address); the
    // suggestion's main text otherwise only recognises a half-typed word.
    const detail = splitKeptDetail(typed, { carried: name, main: suggestion.main, title });
    const place = makePlaceRef({ placeId: suggestion.placeId, name, title });
    const text = composePlaceText(place, detail);
    // By construction this holds; a provider address that breaks the rule is not stored.
    if (!validPlace(text, place)) return { ok: false, code: 'parse' };
    store.notePick(fieldKind, detail !== '', place.title !== undefined);
    reset();
    return { ok: true, place, text, detail };
  }

  onScopeDispose(() => {
    pickController?.abort();
    endRequesting(requestSignal);
  });

  return {
    suggestions,
    /** From the keystroke until the answer lands (the debounce included). */
    searching,
    requesting,
    slowLookup,
    state,
    available,
    onInput,
    pick,
    reset,
    /** Drop the lookup waiting or in flight (blur, Keep what I typed); the session stays. */
    cancel,
    noteKeepTyped: () => store.noteKeepTyped(fieldKind),
    noteRemoved: (restored: 'original' | 'composed') => store.noteRemoved(fieldKind, restored),
    notePickFailedShown: () => store.notePickFailedShown(fieldKind),
    noteStale: () => store.noteStale(fieldKind),
  };
}
