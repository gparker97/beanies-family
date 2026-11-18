import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive } from 'vue';
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
  isSendablePlaceQuery,
  trimmedRetryQuery,
  usePlaceSearch,
} from '@/composables/usePlaceSearch';
import {
  MAX_QUERY_CHARS,
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
      expect(store.notePick).toHaveBeenCalledWith('activity', true);
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
