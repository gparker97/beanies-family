import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, watch } from 'vue';
import type { PlaceSuggestion } from '@/types/placeSearch';

const store = reactive({
  available: true,
  unavailableReason: null as string | null,
  requestSuggestions: vi.fn(),
  requestAddress: vi.fn(),
  noteQuiet: vi.fn(),
  noteCachedSuggest: vi.fn(),
  notePick: vi.fn(),
  notePickSuperseded: vi.fn(),
  notePickFailedShown: vi.fn(),
  noteKeepTyped: vi.fn(),
  noteRemoved: vi.fn(),
  noteStale: vi.fn(),
  refreshQuiet: vi.fn(),
});
vi.mock('@/stores/placeSearchStore', () => ({ usePlaceSearchStore: () => store }));

import {
  PLACE_SEARCH_DEBOUNCE_MS,
  PLACE_SEARCH_MAX_CHARS,
  PLACE_SEARCH_MIN_CHARS,
  PLACE_SEARCH_SESSION_CAP,
  PLACE_SEARCH_SLOW_MS,
  PLACE_TITLE_MAX_CHARS,
  isSendablePlaceQuery,
  trimmedRetryQuery,
  usePlaceSearch,
} from '@/composables/usePlaceSearch';
import {
  MAX_QUERY_CHARS,
  MAX_TEXT_CHARS,
  MIN_QUERY_CHARS,
  normaliseQuery,
  // @ts-expect-error: plain JS Lambda source, deliberately imported for parity rather than copied.
} from '../../../infrastructure/lambda/place-search/createHandler.mjs';

const ROW: PlaceSuggestion = {
  placeId: 'ChIJ127',
  main: '127 South Bridge Road',
  secondary: 'Singapore',
};

const scopes: Array<ReturnType<typeof effectScope>> = [];

function mountField(fieldKind: 'activity' | 'stay' = 'activity') {
  const scope = effectScope();
  scopes.push(scope);
  const api = scope.run(() => usePlaceSearch({ fieldKind }))!;
  return { scope, ...api };
}

/** One keystroke (the field calls `onInput`), then the debounce runs out. */
async function type(f: { onInput: (text: string) => void }, text: string) {
  f.onInput(text);
  await nextTick();
  await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // clearAllMocks keeps implementations: one test's clock check must not leak into the next.
  store.refreshQuiet.mockReset();
  store.available = true;
  store.unavailableReason = null;
  store.requestSuggestions.mockResolvedValue({ ok: true, suggestions: [ROW] });
  store.requestAddress.mockResolvedValue({
    ok: true,
    address: '127 S Bridge Rd, Singapore 058285',
  });
});
afterEach(() => {
  // Unmount every field, so a later test's store change cannot wake an old one.
  scopes.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
});

describe('trimmedRetryQuery', () => {
  it.each([
    ['127 south bridge road block 48 unit 04-19 function room', '127 south bridge road'],
    ['Blk 293 Yishun Street 22 #05-12', 'Blk 293 Yishun Street 22'],
    ['one two three four five six seven', 'one two three four five'],
    ['12 Main St room 3', '12 Main St'],
    ['Main St room 3', ''],
    ['one two three four five', ''],
  ])('%s → "%s"', (q, want) => {
    expect(trimmedRetryQuery(q)).toBe(want);
  });
});

describe('isSendablePlaceQuery (parity with the Lambda)', () => {
  const CORPUS = [
    '127 south bridge road',
    'zoommtg://zoom.us/join?confno=123',
    'msteams://teams.microsoft.com/l/meetup-join/x',
    'see foo://bar',
    'https://zoom.us/j/1',
    'me@example.com',
    'meet me @ the.hall',
    'greg @ home',
    '12 Main St\nunit 4',
    '12 Main St\r\nunit 4',
    '12 Main St\u0085unit 4',
    '12 Main St\u2028unit 4',
    '12 Main St\u2029unit 4',
    'ab',
    '  ab  ',
    'abc',
    'x'.repeat(200),
    'x'.repeat(201),
    `  ${'x'.repeat(200)}  `,
    'Blk 293 Yishun Street 22 #05-12',
    'zoom.us/j/1',
  ];

  it('uses the same length bounds', () => {
    expect([PLACE_SEARCH_MIN_CHARS, PLACE_SEARCH_MAX_CHARS]).toEqual([
      MIN_QUERY_CHARS,
      MAX_QUERY_CHARS,
    ]);
  });

  it.each(CORPUS.map((q) => [JSON.stringify(q), q]))(
    '%s: the client sends it only when the Lambda would accept it',
    (_label, q) => {
      expect(isSendablePlaceQuery(q)).toBe(normaliseQuery(q) !== null);
    }
  );
});

describe('usePlaceSearch', () => {
  it('waits 400 ms, then asks once and lists the answer', async () => {
    const f = mountField();
    f.onInput('127 sou');
    await nextTick();
    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS - 1);
    expect(store.requestSuggestions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.requestSuggestions).toHaveBeenCalledWith(
      '127 sou',
      expect.objectContaining({ fieldKind: 'activity', attempt: 'typed' })
    );
    expect(f.suggestions.value).toEqual([ROW]);
  });

  it.each([
    ['under three characters', 'ab'],
    ['a link', 'https://zoom.us/j/1'],
    ['a bare call host', 'zoom.us/j/1'],
    ['an email', 'me@example.com'],
    ['a line break', '12 Main St\nunit 4'],
    ['an app link with a non-http scheme', 'zoommtg://zoom.us/join?confno=123'],
    ['any text containing ://', 'see foo://bar'],
    ['an @ with a dotted host', 'room 3 @school.hall'],
    ['a Unicode line separator', '12 Main St\u2028unit 4'],
  ])('makes no request for %s', async (_label, text) => {
    const f = mountField();
    await type(f, text);
    expect(store.requestSuggestions).not.toHaveBeenCalled();
    expect(f.suggestions.value).toEqual([]);
  });

  it('makes no request while the store is unavailable, and notes an unconfigured build', async () => {
    store.available = false;
    store.unavailableReason = 'not-configured';
    const f = mountField();
    await type(f, '127 south');
    expect(store.requestSuggestions).not.toHaveBeenCalled();
    expect(store.noteQuiet).toHaveBeenCalledWith('not-configured', 'activity');
  });

  it('asks the store to end an expired quiet period by the clock before each lookup', async () => {
    // The store is quiet; its clock check finds the period over and clears it.
    store.available = false;
    store.unavailableReason = 'quiet';
    store.refreshQuiet.mockImplementation(() => {
      store.available = true;
      store.unavailableReason = null;
    });
    const f = mountField();
    await type(f, '127 south');
    expect(store.refreshQuiet).toHaveBeenCalled();
    expect(store.requestSuggestions).toHaveBeenCalledWith('127 south', expect.anything());
  });

  it('answers a repeated query from its cache and counts it as cached', async () => {
    const f = mountField();
    await type(f, '127 south');
    await type(f, '127 south b');
    await type(f, '127 south');
    expect(store.requestSuggestions).toHaveBeenCalledTimes(2);
    expect(store.noteCachedSuggest).toHaveBeenCalledWith(1, 'activity');
  });

  it('two fields share neither a cache nor a session cap', async () => {
    const a = mountField('activity');
    const b = mountField('stay');
    await type(a, '127 south');
    await type(b, '127 south');
    expect(store.requestSuggestions).toHaveBeenCalledTimes(2);
    for (let i = 0; i < PLACE_SEARCH_SESSION_CAP + 2; i++) await type(a, `query number ${i}`);
    await type(b, 'another query');
    expect(
      store.requestSuggestions.mock.calls.filter((c) => c[1].fieldKind === 'stay')
    ).toHaveLength(2);
  });

  it('stops after six requests per session, closes the list and notes it once', async () => {
    const f = mountField();
    for (let i = 0; i < PLACE_SEARCH_SESSION_CAP; i++) await type(f, `query ${i} here`);
    expect(store.requestSuggestions).toHaveBeenCalledTimes(PLACE_SEARCH_SESSION_CAP);
    await type(f, 'one more query');
    await type(f, 'and another');
    expect(store.requestSuggestions).toHaveBeenCalledTimes(PLACE_SEARCH_SESSION_CAP);
    expect(f.suggestions.value).toEqual([]);
    expect(store.noteQuiet).toHaveBeenCalledTimes(1);
    expect(store.noteQuiet).toHaveBeenCalledWith('session-cap', 'activity');
  });

  it('clearing the field starts a new session', async () => {
    const f = mountField();
    for (let i = 0; i < PLACE_SEARCH_SESSION_CAP; i++) await type(f, `query ${i} here`);
    await type(f, '');
    await type(f, 'fresh start');
    expect(store.requestSuggestions).toHaveBeenCalledTimes(PLACE_SEARCH_SESSION_CAP + 1);
  });

  it('retries once with the trimmed query when unit-heavy text finds nothing', async () => {
    store.requestSuggestions
      .mockResolvedValueOnce({ ok: true, suggestions: [] })
      .mockResolvedValueOnce({ ok: true, suggestions: [ROW] });
    const f = mountField();
    await type(f, '127 south bridge road block 48 unit 04-19 function room');
    expect(store.requestSuggestions.mock.calls.map((c) => [c[0], c[1].attempt])).toEqual([
      ['127 south bridge road block 48 unit 04-19 function room', 'typed'],
      ['127 south bridge road', 'retry'],
    ]);
    expect(f.suggestions.value).toEqual([ROW]);
  });

  it('the retry counts against the session cap', async () => {
    store.requestSuggestions.mockResolvedValue({ ok: true, suggestions: [] });
    const f = mountField();
    // Each long query spends two requests (typed + retry): three of them fill the cap.
    for (let i = 0; i < 3; i++) await type(f, `${i} long street name block ${i} unit 5`);
    expect(store.requestSuggestions).toHaveBeenCalledTimes(PLACE_SEARCH_SESSION_CAP);
    await type(f, '9 other street name block 9 unit 5');
    expect(store.requestSuggestions).toHaveBeenCalledTimes(PLACE_SEARCH_SESSION_CAP);
  });

  it('a failed lookup closes the list', async () => {
    const f = mountField();
    await type(f, '127 south');
    store.requestSuggestions.mockResolvedValueOnce({ ok: false, code: 'upstream_timeout' });
    await type(f, '127 south b');
    expect(f.suggestions.value).toEqual([]);
  });

  describe('a lookup is only ever started by a keystroke in that field', () => {
    it('availability coming back starts no lookup in any field holding unpicked text', async () => {
      store.available = false;
      store.unavailableReason = 'offline';
      const fields = [mountField('activity'), mountField('stay'), mountField('activity')];
      for (const [i, f] of fields.entries()) await type(f, `${i} south bridge road`);
      expect(store.requestSuggestions).not.toHaveBeenCalled();

      store.available = true;
      store.unavailableReason = null;
      await nextTick();
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS * 3);
      expect(store.requestSuggestions).not.toHaveBeenCalled();

      await type(fields[1]!, '1 south bridge road b');
      expect(store.requestSuggestions).toHaveBeenCalledTimes(1);
      expect(store.requestSuggestions).toHaveBeenCalledWith(
        '1 south bridge road b',
        expect.objectContaining({ fieldKind: 'stay' })
      );
    });

    it('availability is read when the lookup is sent, not when it was typed', async () => {
      const f = mountField();
      f.onInput('127 south');
      await nextTick();
      store.available = false;
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
      expect(store.requestSuggestions).not.toHaveBeenCalled();
      expect(f.suggestions.value).toEqual([]);
    });
  });

  describe('pick', () => {
    it('stores the formatted address as the place and keeps the typed detail', async () => {
      const f = mountField();
      const typed = '127 south bridge road block 48 unit 04-19 function room';
      const result = await f.pick(ROW, typed);
      expect(store.requestAddress).toHaveBeenCalledWith(
        'ChIJ127',
        expect.objectContaining({ fieldKind: 'activity' })
      );
      expect(result).toEqual({
        ok: true,
        place: { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' },
        detail: 'block 48 unit 04-19 function room',
        text: '127 S Bridge Rd, Singapore 058285, block 48 unit 04-19 function room',
      });
      expect(store.notePick).toHaveBeenCalledWith('activity', true, false);
      expect(result.ok && 'title' in result.place).toBe(false);
    });

    it('drops the lookup still waiting, so no late answer swaps the list under the pick', async () => {
      const f = mountField();
      await type(f, '127 sou');
      store.requestSuggestions.mockClear();
      f.onInput('127 sout');
      await nextTick();
      const picking = f.pick(ROW, '127 sout', () => false);
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS * 2);
      await picking;
      expect(store.requestSuggestions).not.toHaveBeenCalled();
      expect(f.suggestions.value).toEqual([ROW]);
    });

    it('picking mid-word keeps no half-typed fragment as the detail', async () => {
      const f = mountField();
      for (const typed of ['127 s brid', '127 south bri']) {
        const result = await f.pick(
          { placeId: 'ChIJ127', main: '127 S Bridge Rd', secondary: 'Singapore' },
          typed
        );
        expect(result).toMatchObject({
          ok: true,
          detail: '',
          text: '127 S Bridge Rd, Singapore 058285',
        });
      }
    });

    it('a typed venue name the formatted address does not carry is kept as the detail', async () => {
      store.requestAddress.mockResolvedValue({
        ok: true,
        address: '10 Bayfront Ave, Singapore 018956',
      });
      const f = mountField();
      const mbs: PlaceSuggestion = {
        placeId: 'ChIJmbs',
        main: 'Marina Bay Sands',
        secondary: '10 Bayfront Avenue, Singapore',
      };
      expect(await f.pick(mbs, 'Marina Bay Sands')).toMatchObject({
        ok: true,
        detail: 'Marina Bay Sands',
        text: '10 Bayfront Ave, Singapore 018956, Marina Bay Sands',
      });
      expect(await f.pick(mbs, 'marina bay sa')).toMatchObject({
        ok: true,
        detail: 'marina bay',
        text: '10 Bayfront Ave, Singapore 018956, marina bay',
      });
    });

    describe('a named place (kind: place)', () => {
      const HT_ADDRESS = '50 E Coast Rd, #01-138 Roxy Square, Singapore 428769';
      const HT: PlaceSuggestion = {
        placeId: 'ChIJht',
        main: 'The Hungarian Touch',
        secondary: 'East Coast Road, Singapore',
        kind: 'place',
      };
      beforeEach(() => {
        store.requestAddress.mockResolvedValue({ ok: true, address: HT_ADDRESS });
      });

      it("stores the business name as the title, ahead of Google's address", async () => {
        const f = mountField();
        const result = await f.pick(HT, 'hungarian touch');
        expect(result).toEqual({
          ok: true,
          place: { placeId: 'ChIJht', name: HT_ADDRESS, title: 'The Hungarian Touch' },
          detail: '',
          text: `The Hungarian Touch, ${HT_ADDRESS}`,
        });
        expect(result.ok && Object.keys(result.place)).toEqual(['placeId', 'name', 'title']);
        expect(store.notePick).toHaveBeenCalledWith('activity', false, true);
      });

      it('keeps what neither the title nor the address carries as the detail', async () => {
        const f = mountField();
        expect(await f.pick(HT, 'hungarian touch back room')).toMatchObject({
          ok: true,
          detail: 'back room',
          text: `The Hungarian Touch, ${HT_ADDRESS}, back room`,
        });
        expect(await f.pick(HT, 'hungarian tou')).toMatchObject({ ok: true, detail: '' });
      });

      it('the same suggestion as an address (kind: address) behaves exactly as before', async () => {
        const f = mountField();
        const result = await f.pick({ ...HT, kind: 'address' }, 'hungarian touch');
        expect(result).toEqual({
          ok: true,
          place: { placeId: 'ChIJht', name: HT_ADDRESS },
          detail: 'hungarian touch',
          text: `${HT_ADDRESS}, hungarian touch`,
        });
      });

      it('an older Lambda (no kind) is an address pick', async () => {
        const f = mountField();
        const { kind: _kind, ...older } = HT;
        const result = await f.pick(older, 'hungarian touch');
        expect(result).toMatchObject({ ok: true, place: { placeId: 'ChIJht', name: HT_ADDRESS } });
        expect(result.ok && result.place.title).toBeUndefined();
      });

      it('stores no title when the address already carries it (the place is its address)', async () => {
        store.requestAddress.mockResolvedValue({
          ok: true,
          address: '1 Raffles Pl, Singapore 048616',
        });
        const f = mountField();
        const result = await f.pick(
          { placeId: 'ChIJrp', main: '1 Raffles Place', secondary: 'Singapore', kind: 'place' },
          '1 raffles place'
        );
        expect(result).toEqual({
          ok: true,
          place: { placeId: 'ChIJrp', name: '1 Raffles Pl, Singapore 048616' },
          detail: '',
          text: '1 Raffles Pl, Singapore 048616',
        });
        expect(store.notePick).toHaveBeenCalledWith('activity', false, false);
      });

      it("the title cap is the Lambda's text cap", () => {
        expect(PLACE_TITLE_MAX_CHARS).toBe(MAX_TEXT_CHARS);
      });

      it('trims the title and caps it at the Lambda text cap', async () => {
        const f = mountField();
        const long = `${'Cafe '.repeat(50)}`;
        const result = await f.pick({ ...HT, main: `  ${long}` }, 'cafe');
        expect(result.ok).toBe(true);
        const title = result.ok ? result.place.title! : '';
        expect(title.length).toBeLessThanOrEqual(PLACE_TITLE_MAX_CHARS);
        expect(title).toBe(title.trim());
        expect(title.startsWith('Cafe Cafe')).toBe(true);
      });
    });

    it('a failed address fetch returns ok: false and stores nothing', async () => {
      store.requestAddress.mockResolvedValueOnce({ ok: false, code: 'upstream_http' });
      const f = mountField();
      await type(f, '127 south');
      const result = await f.pick(ROW, '127 south');
      expect(result).toEqual({ ok: false, code: 'upstream_http' });
      expect(store.notePick).not.toHaveBeenCalled();
      // The list stays, so tapping again retries.
      expect(f.suggestions.value).toEqual([ROW]);
    });

    it('an address that arrives after the member moved on is dropped, noted, and changes nothing', async () => {
      const f = mountField();
      await type(f, '127 south');
      let current = true;
      const pending = f.pick(ROW, '127 south', () => current);
      current = false;
      const result = await pending;
      expect(result).toEqual({ ok: false, code: 'superseded' });
      expect(store.notePickSuperseded).toHaveBeenCalledWith('activity');
      expect(store.notePick).not.toHaveBeenCalled();
      // The session goes on: the list and the cache stay.
      expect(f.suggestions.value).toEqual([ROW]);
      await type(f, '127 south b');
      await type(f, '127 south');
      expect(store.requestSuggestions).toHaveBeenCalledTimes(2);
    });

    it('after a pick, typing the same text again asks afresh', async () => {
      const f = mountField();
      await type(f, '127 south');
      await f.pick(ROW, '127 south');
      await type(f, '127 south');
      expect(store.requestSuggestions).toHaveBeenCalledTimes(2);
    });

    it('a pick resets the session cap', async () => {
      const f = mountField();
      for (let i = 0; i < PLACE_SEARCH_SESSION_CAP; i++) await type(f, `query ${i} here`);
      await f.pick(ROW, 'query 5 here');
      await type(f, 'next session');
      expect(store.requestSuggestions).toHaveBeenCalledTimes(PLACE_SEARCH_SESSION_CAP + 1);
    });
  });

  describe('searching signals (requesting, slowLookup)', () => {
    type Outcome = { ok: true; suggestions: PlaceSuggestion[] } | { ok: false; code: string };
    /** A provider request that answers only when the test says so (or when it is aborted). */
    function holdRequests() {
      const pending: Array<(o: Outcome) => void> = [];
      store.requestSuggestions.mockImplementation(
        (_q: string, opts: { signal?: AbortSignal }) =>
          new Promise<Outcome>((resolve) => {
            pending.push(resolve);
            opts.signal?.addEventListener('abort', () => resolve({ ok: false, code: 'aborted' }));
          })
      );
      return {
        answer: async (o: Outcome = { ok: true, suggestions: [ROW] }) => {
          pending.shift()!(o);
          await vi.advanceTimersByTimeAsync(0);
        },
        count: () => pending.length,
      };
    }

    it('is off during the debounce, on once a request is sent, slow only after 150 ms', async () => {
      const held = holdRequests();
      const f = mountField();
      f.onInput('127 south');
      await nextTick();
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS - 1);
      expect([f.requesting.value, f.slowLookup.value]).toEqual([false, false]);
      await vi.advanceTimersByTimeAsync(1);
      expect([f.requesting.value, f.slowLookup.value]).toEqual([true, false]);
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS - 1);
      expect(f.slowLookup.value).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.slowLookup.value).toBe(true);
      await held.answer();
      expect([f.requesting.value, f.slowLookup.value]).toEqual([false, false]);
      expect(f.suggestions.value).toEqual([ROW]);
    });

    it('a request that answers in under 150 ms never turns slow', async () => {
      const held = holdRequests();
      const f = mountField();
      const seen: boolean[] = [];
      watch(f.slowLookup, (v) => seen.push(v), { flush: 'sync' });
      await type(f, '127 south');
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS - 10);
      await held.answer();
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS * 4);
      expect(seen).toEqual([]);
      expect(f.requesting.value).toBe(false);
    });

    it('a cached answer sends nothing and never shows as requesting', async () => {
      const f = mountField();
      await type(f, '127 south');
      await type(f, '127 south b');
      const seen: boolean[] = [];
      watch(f.requesting, (v) => seen.push(v), { flush: 'sync' });
      await type(f, '127 south');
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS * 2);
      expect(seen).toEqual([]);
    });

    it.each([
      [
        'cancel (blur, Escape, Keep what I typed)',
        (f: ReturnType<typeof mountField>) => f.cancel(),
      ],
      ['reset', (f: ReturnType<typeof mountField>) => f.reset()],
      [
        'a superseding keystroke',
        (f: ReturnType<typeof mountField>) => f.onInput('127 south bridge'),
      ],
    ])('ends the moment the lookup is dropped: %s', async (_label, drop) => {
      holdRequests();
      const f = mountField();
      await type(f, '127 south');
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS);
      expect(f.slowLookup.value).toBe(true);
      drop(f);
      await nextTick();
      expect([f.requesting.value, f.slowLookup.value]).toEqual([false, false]);
    });

    it('a superseded request cannot clear the newer one when it lands late', async () => {
      // A request that ignores its abort signal and answers late.
      const late: Array<(o: Outcome) => void> = [];
      store.requestSuggestions.mockImplementation(
        () => new Promise<Outcome>((resolve) => late.push(resolve))
      );
      const f = mountField();
      await type(f, '127 south');
      await type(f, '127 south bridge');
      expect(late).toHaveLength(2);
      late[0]!({ ok: true, suggestions: [ROW] });
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS);
      expect([f.requesting.value, f.slowLookup.value]).toEqual([true, true]);
    });

    it('stays on through the trimmed retry, with no gap between the two requests', async () => {
      const held = holdRequests();
      const f = mountField();
      const seen: boolean[] = [];
      watch(f.requesting, (v) => seen.push(v), { flush: 'sync' });
      await type(f, '127 south bridge road block 48 unit 04-19 function room');
      await vi.advanceTimersByTimeAsync(100);
      await held.answer({ ok: true, suggestions: [] });
      expect(held.count()).toBe(1);
      expect(f.requesting.value).toBe(true);
      // The 150 ms is counted from the first request, not restarted by the retry.
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS - 100);
      expect(f.slowLookup.value).toBe(true);
      await held.answer();
      expect(seen).toEqual([true, false]);
      expect(f.slowLookup.value).toBe(false);
    });

    it('is not shown while the store is unavailable (offline mid-request)', async () => {
      holdRequests();
      const f = mountField();
      await type(f, '127 south');
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_SLOW_MS);
      expect(f.slowLookup.value).toBe(true);
      store.available = false;
      expect(f.slowLookup.value).toBe(false);
    });
  });

  describe('lookup state (idle / results / none)', () => {
    it('is results for an answer with rows, none for a completed empty answer', async () => {
      const f = mountField();
      expect(f.state.value).toBe('idle');
      await type(f, '127 south');
      expect(f.state.value).toBe('results');
      store.requestSuggestions.mockResolvedValueOnce({ ok: true, suggestions: [] });
      await type(f, 'nowhere at all');
      expect(f.state.value).toBe('none');
    });

    it('is none only once the trimmed retry has also found nothing', async () => {
      store.requestSuggestions.mockResolvedValue({ ok: true, suggestions: [] });
      const f = mountField();
      const seen: string[] = [];
      watch(f.state, (v) => seen.push(v), { flush: 'sync' });
      await type(f, '127 south bridge road block 48 unit 04-19 function room');
      expect(store.requestSuggestions).toHaveBeenCalledTimes(2);
      expect(seen).toEqual(['none']);
    });

    it('a cached empty answer is none as well', async () => {
      store.requestSuggestions.mockResolvedValue({ ok: true, suggestions: [] });
      const f = mountField();
      await type(f, 'nowhere at all');
      await type(f, 'nowhere at al');
      await type(f, 'nowhere at all');
      expect(store.noteCachedSuggest).toHaveBeenCalledWith(0, 'activity');
      expect(f.state.value).toBe('none');
    });

    it.each([
      'upstream_timeout',
      'budget_exhausted',
      'rate_limited',
      'network',
      'not_configured',
      'unavailable',
      'dev_capped',
    ])('stays idle when the lookup fails or is refused: %s', async (code) => {
      store.requestSuggestions.mockResolvedValue({ ok: false, code });
      const f = mountField();
      await type(f, '127 south');
      expect(f.state.value).toBe('idle');
    });

    it('a failed retry stays idle (it is not "nothing found")', async () => {
      store.requestSuggestions
        .mockResolvedValueOnce({ ok: true, suggestions: [] })
        .mockResolvedValueOnce({ ok: false, code: 'budget_exhausted' });
      const f = mountField();
      await type(f, '127 south bridge road block 48 unit 04-19 function room');
      expect(f.state.value).toBe('idle');
    });

    it('stays idle at the session cap', async () => {
      store.requestSuggestions.mockResolvedValue({ ok: true, suggestions: [ROW] });
      const f = mountField();
      for (let i = 0; i < PLACE_SEARCH_SESSION_CAP; i++) await type(f, `query ${i} here`);
      await type(f, 'one more query');
      expect(store.noteQuiet).toHaveBeenCalledWith('session-cap', 'activity');
      expect(f.state.value).toBe('idle');
    });

    it.each(['offline', 'switch-off', 'not-configured', 'quiet'])(
      'stays idle while the store is unavailable (%s): nothing is asked',
      async (reason) => {
        store.available = false;
        store.unavailableReason = reason;
        const f = mountField();
        await type(f, '127 south');
        expect(store.requestSuggestions).not.toHaveBeenCalled();
        expect(f.state.value).toBe('idle');
      }
    );

    it('is cleared by the next keystroke, by cancel and by reset', async () => {
      store.requestSuggestions.mockResolvedValue({ ok: true, suggestions: [] });
      const f = mountField();
      await type(f, 'nowhere at all');
      expect(f.state.value).toBe('none');
      f.onInput('nowhere at all ');
      expect(f.state.value).toBe('idle');
      await type(f, 'nowhere at al');
      expect(f.state.value).toBe('none');
      f.cancel();
      expect(f.state.value).toBe('idle');
      await type(f, 'nowhere at a');
      expect(f.state.value).toBe('none');
      f.reset();
      expect(f.state.value).toBe('idle');
    });
  });

  it('passes field outcomes to the store with its field kind', () => {
    const f = mountField('stay');
    f.noteKeepTyped();
    f.noteRemoved('original');
    f.notePickFailedShown();
    f.noteStale();
    expect(store.noteKeepTyped).toHaveBeenCalledWith('stay');
    expect(store.noteRemoved).toHaveBeenCalledWith('stay', 'original');
    expect(store.notePickFailedShown).toHaveBeenCalledWith('stay');
    expect(store.noteStale).toHaveBeenCalledWith('stay');
  });
});
