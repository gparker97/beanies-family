import { describe, expect, it } from 'vitest';
import {
  ADDRESS_ABBREVIATIONS,
  PLACE_FIELDS,
  SUB_PREMISE_KEYWORDS,
  composePlaceText,
  detailOf,
  makePlaceRef,
  mapsHref,
  placePatch,
  splitKeptDetail,
  validPlace,
} from '../placeText';
import { SPLIT_FIXTURES } from './splitKeptDetail.fixtures';
import { MERGE_FIELDS } from '@/services/automerge/worker/reconcile';
import { isWordBoundedScript, wordTokenList } from '@/utils/textSimilarity';

const PLACE = { placeId: 'ChIJabc_123-x', name: '127 S Bridge Rd, Singapore 058285' };

describe('validPlace', () => {
  const cases: Array<[string, string | undefined, unknown, boolean]> = [
    ['exact name', PLACE.name, PLACE, true],
    ['name + detail', `${PLACE.name}, block 48`, PLACE, true],
    ['surrounding whitespace on the text is trimmed', `  ${PLACE.name}, unit 4  `, PLACE, true],
    ['text that does not start with the name', 'Somewhere else', PLACE, false],
    ['name followed by no comma', `${PLACE.name} block 48`, PLACE, false],
    ['name followed by a comma but no space', `${PLACE.name},block 48`, PLACE, false],
    [
      'a name that itself contains ", " is a plain prefix',
      '12 Main St, Springfield, unit 4',
      { placeId: 'a', name: '12 Main St, Springfield' },
      true,
    ],
    [
      'prefix of another name: the shorter place still reads as valid (accepted residual)',
      '12 Main St, Springfield',
      { placeId: 'a', name: '12 Main St' },
      true,
    ],
    ['empty name', '', { placeId: 'a', name: '' }, false],
    ['empty placeId', 'x', { placeId: '', name: 'x' }, false],
    ['non-string name', '1', { placeId: 'a', name: 1 }, false],
    ['non-string placeId', 'x', { placeId: 7, name: 'x' }, false],
    ['leading whitespace in name', ' x', { placeId: 'a', name: ' x' }, false],
    ['trailing whitespace in name', 'x ', { placeId: 'a', name: 'x ' }, false],
    ['whitespace in placeId', 'x', { placeId: ' a', name: 'x' }, false],
    ['placeId with a bad character', 'x', { placeId: 'a/b', name: 'x' }, false],
    ['placeId longer than 512', 'x', { placeId: 'a'.repeat(513), name: 'x' }, false],
    ['placeId of exactly 512', 'x', { placeId: 'a'.repeat(512), name: 'x' }, true],
    ['null place', 'x', null, false],
    ['undefined place', 'x', undefined, false],
    ['a string as place', 'x', 'x', false],
    ['undefined text', undefined, PLACE, false],
    ['whitespace-only detail still starts with name + ", "', `${PLACE.name},   `, PLACE, false],
  ];
  it.each(cases)('%s', (_label, text, place, ok) => {
    expect(Boolean(validPlace(text, place))).toBe(ok);
  });

  it('a whitespace-only detail trims back to the exact name, which is valid', () => {
    // `"name,   "` trims to `"name,"`, which is neither the name nor name + ", ".
    expect(validPlace(`${PLACE.name}  `, PLACE)).toBe(PLACE);
  });
});

describe('detailOf', () => {
  it('returns the rest after name + ", "', () => {
    expect(detailOf(`${PLACE.name}, block 48 unit 04-19 `, PLACE)).toBe('block 48 unit 04-19');
  });
  it('is empty for the exact name, an inert place or no place', () => {
    expect(detailOf(PLACE.name, PLACE)).toBe('');
    expect(detailOf('Elsewhere, room 2', PLACE)).toBe('');
    expect(detailOf('Elsewhere, room 2', undefined)).toBe('');
  });
});

describe('composePlaceText', () => {
  it('joins name and detail with ", "', () => {
    expect(composePlaceText('12 Main St', 'room 3')).toBe('12 Main St, room 3');
  });
  it('trims the detail and strips its edge separators', () => {
    expect(composePlaceText('12 Main St', ' , room 3; ')).toBe('12 Main St, room 3');
  });
  it('is the name alone for an empty or separator-only detail', () => {
    expect(composePlaceText('12 Main St', '')).toBe('12 Main St');
    expect(composePlaceText('12 Main St', ' ,; ')).toBe('12 Main St');
  });
  it('round-trips through detailOf and validPlace', () => {
    const text = composePlaceText(PLACE.name, 'block 48');
    expect(validPlace(text, PLACE)).toBe(PLACE);
    expect(detailOf(text, PLACE)).toBe('block 48');
  });
});

describe('makePlaceRef', () => {
  it('builds with a fixed key order and drops extra keys', () => {
    const ref = makePlaceRef({ name: 'n', extra: 1, placeId: 'p' } as never);
    expect(Object.keys(ref)).toEqual(['placeId', 'name']);
    expect(JSON.stringify(ref)).toBe('{"placeId":"p","name":"n"}');
  });
});

describe('placePatch', () => {
  it('names the sibling from the single table', () => {
    expect(PLACE_FIELDS).toEqual({
      location: 'locationPlace',
      address: 'addressPlace',
      agencyAddress: 'agencyAddressPlace',
    });
  });

  it('writes the string and a whole, canonical place when valid', () => {
    const patch = placePatch('address', `${PLACE.name}, loft`, {
      name: PLACE.name,
      placeId: PLACE.placeId,
    });
    expect(patch).toEqual({ address: `${PLACE.name}, loft`, addressPlace: PLACE });
    expect(Object.keys(patch.addressPlace!)).toEqual(['placeId', 'name']);
  });

  it('never writes a place that fails validPlace', () => {
    const strings = ['', 'Elsewhere', `${PLACE.name}x`, undefined];
    const places = [PLACE, { placeId: '', name: PLACE.name }, { placeId: 'a b', name: PLACE.name }];
    for (const text of strings) {
      for (const place of places) {
        const patch = placePatch('location', text, place);
        if (patch.locationPlace) expect(validPlace(text, patch.locationPlace)).toBeTruthy();
      }
    }
    expect(placePatch('location', 'Elsewhere', PLACE)).toEqual({
      location: 'Elsewhere',
      locationPlace: undefined,
    });
  });

  it('passes the string through in the caller spelling (no trimming)', () => {
    expect(placePatch('agencyAddress', '  1 High St  ', null)).toEqual({
      agencyAddress: '  1 High St  ',
      agencyAddressPlace: undefined,
    });
    expect(placePatch('location', undefined, null)).toEqual({
      location: undefined,
      locationPlace: undefined,
    });
  });

  it('an inert stored place reads as undefined on both sides, so a diff sees no change', () => {
    const stored = { placeId: 'p', name: 'Old name' };
    const before = placePatch('location', 'New text', stored);
    const after = placePatch('location', 'New text', stored);
    expect(JSON.stringify(before)).toBe(JSON.stringify(after));
    expect(before.locationPlace).toBeUndefined();
  });
});

describe('mapsHref', () => {
  const legacy = (text: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

  it('is byte for byte the legacy URL with no place', () => {
    for (const text of ['Lido Pool', '12 Main St, #05-12 & co', '東京都 3階', '', ' a+b?c=d ']) {
      expect(mapsHref(text)).toBe(legacy(text));
      expect(mapsHref(text, null)).toBe(legacy(text));
    }
  });

  it('is the legacy URL with an inert place', () => {
    expect(mapsHref('Elsewhere', PLACE)).toBe(legacy('Elsewhere'));
  });

  it('opens the exact place, searching for the name and never the detail', () => {
    expect(mapsHref(`${PLACE.name}, block 48 unit 04-19`, PLACE)).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(PLACE.name)}&query_place_id=${PLACE.placeId}`
    );
  });
});

describe('splitKeptDetail', () => {
  it.each(SPLIT_FIXTURES.map((f) => [f.note ?? f.typed, f] as const))('%s', (_label, f) => {
    expect(splitKeptDetail(f.typed, { carried: f.carried, main: f.main })).toBe(f.detail);
  });

  // ── An independent statement of the contract, deliberately looser than the function ──
  // (abbreviations fold everywhere here), so it bounds what may be dropped from above.
  const fold = (t: string) => ADDRESS_ABBREVIATIONS[t] ?? t;
  const words = (s: string) => wordTokenList(s).map(fold);
  const isKeyword = (chunk: string) => {
    const w = wordTokenList(chunk);
    return w.length === 1 && SUB_PREMISE_KEYWORDS.has(w[0]!);
  };
  const isLeadIn = (chunk: string) => wordTokenList(chunk).length === 0 || isKeyword(chunk);
  const edges = (c: string) => c.replace(/^[\s,;]+|[\s,;]+$/g, '');
  /** `a` appears in `b` in order (not necessarily adjacent). */
  const inOrder = (a: string[], b: string[]) => {
    let j = 0;
    for (const t of a) {
      while (j < b.length && b[j] !== t) j++;
      if (j++ >= b.length) return false;
    }
    return true;
  };
  const counts = (list: string[]) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };

  /**
   * Nothing is lost (the contract). Every whitespace chunk of the typed text is in the
   * detail, OR (head) it is one of the dropped head chunks whose words, taken together in
   * typed order, appear in order in the address, OR it is part of a tail that is dropped as a
   * whole and whose every word appears in order in the address (and the address has enough of
   * each word for the head and the tail together), OR (head, no tail) it is a fragment: a word
   * of two or more letters that is a strict prefix of a word of the main text, OR it is a
   * keyword or wordless chunk directly before a dropped chunk.
   */
  function assertNothingLost(typed: string, carried: string, main = '') {
    const detail = splitKeptDetail(typed, { carried, main });
    const out = detail.split(/\s+/).filter(Boolean);
    const chunks = typed.trim().split(/\s+/).filter(Boolean);
    const tail = chunks.findIndex(
      (c, i) => (isKeyword(c) || c.startsWith('#')) && chunks.slice(0, i).some((p) => !isKeyword(p))
    );
    const headEnd = tail < 0 ? chunks.length : tail;

    // Which typed chunks the detail kept: it is made of typed chunks, in typed order.
    const kept = chunks.map(() => false);
    let o = 0;
    chunks.forEach((c, i) => {
      if (o < out.length && (out[o] === c || out[o] === edges(c))) {
        kept[i] = true;
        o++;
      }
    });
    expect(o, `"${detail}" is not made of the chunks of "${typed}"`).toBe(out.length);

    const address = words(carried);
    const mainWords = wordTokenList(main);
    const isFragment = (c: string) =>
      wordTokenList(c).some(
        (w) => w.length >= 2 && mainWords.some((m) => m.length > w.length && m.startsWith(w))
      );
    const leadInOk = (i: number) => isLeadIn(chunks[i]!) && i + 1 < chunks.length && !kept[i + 1];

    const headCarried: string[] = [];
    chunks.forEach((chunk, i) => {
      if (kept[i] || leadInOk(i) || i >= headEnd) return;
      const w = words(chunk);
      if (tail < 0 && isFragment(chunk) && !inOrder(w, address)) return;
      expect(w.length > 0, `lost "${chunk}" from "${typed}"`).toBe(true);
      headCarried.push(...w);
    });
    expect(inOrder(headCarried, address), `head words lost from "${typed}"`).toBe(true);

    if (tail >= 0 && chunks.slice(tail).some((_, k) => !kept[tail + k])) {
      const tailWords = chunks.slice(tail).flatMap(words);
      const lost = `tail of "${typed}" lost against "${carried}"`;
      expect(
        chunks.slice(tail).every((_, k) => !kept[tail + k] || leadInOk(tail + k)),
        lost
      ).toBe(true);
      expect(tailWords.length > 0 && inOrder(tailWords, address), lost).toBe(true);
      const have = counts(address);
      for (const [t, n] of counts([...headCarried, ...tailWords]))
        expect((have.get(t) ?? 0) >= n, lost).toBe(true);
    }
  }

  it('property: nothing typed is lost (fixture table)', () => {
    for (const f of SPLIT_FIXTURES) {
      if (f.typed && isWordBoundedScript(f.typed)) assertNothingLost(f.typed, f.carried, f.main);
    }
  });

  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  it('property: nothing typed is lost (generated combinations)', () => {
    const streets: Array<[string, string]> = [
      ['127 South Bridge Road', '127 S Bridge Rd'],
      ['48 Main Street', '48 Main St'],
      ['1 Raffles Place', '1 Raffles Pl'],
      ['22 Elm Ave', '22 Elm Ave'],
    ];
    const details = [
      'block 48',
      'unit 04-19',
      'Room 3',
      '#05-12',
      'blk 7',
      'flat 2',
      'back gate',
      '48',
      'Marina Bay Sands',
      'bri',
    ];
    const cities = ['', ' Singapore 058285', ' Springfield'];
    for (let i = 0; i < 600; i++) {
      const [street, stored] = streets[rand(streets.length)]!;
      const parts = [street];
      const extra = rand(3);
      for (let k = 0; k < extra; k++) {
        const d = details[rand(details.length)]!;
        if (rand(2)) parts.push(d);
        else parts.unshift(d);
      }
      const typed = parts.join(rand(2) ? ' ' : ', ').toLowerCase();
      const city = cities[rand(cities.length)]!;
      const main = rand(2) ? `Marina Bay Sands ${street}` : street;
      assertNothingLost(typed, `${stored},${city}`, main);
    }
  });

  it('randomized: a unit typed after the street keeps every word the address does not carry', () => {
    /** Formatted address, and its street-line words as a member might type them. */
    const places: Array<[string, string[][]]> = [
      ['127 S Bridge Rd, Singapore 058285', [['127'], ['s', 'south'], ['bridge'], ['rd', 'road']]],
      ['293 Yishun Street 22, Singapore 760292', [['293'], ['yishun'], ['street', 'st'], ['22']]],
      ['201 Tampines St 21, Singapore 520201', [['201'], ['tampines'], ['st', 'street'], ['21']]],
      ['48 Main St, Springfield, IL 62701, USA', [['48'], ['main'], ['st', 'street']]],
      ['12 E Main St, Boston, MA 02127, USA', [['12'], ['e', 'east'], ['main'], ['st', 'street']]],
      ['10 W Main St, Springfield, IL 62701, USA', [['10'], ['w', 'west'], ['main'], ['st']]],
      ['100 Main St, Miami, FL 33130, USA', [['100'], ['main'], ['st', 'street']]],
      ['45 Elm St, Hartford, CT 06103, USA', [['45'], ['elm'], ['st', 'street']]],
      ['1200 O St, Lincoln, NE 68508, USA', [['1200'], ['o'], ['st', 'street']]],
      [
        '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
        [['1600'], ['amphitheatre'], ['pkwy', 'parkway']],
      ],
    ];
    const tails = [
      'block 48 unit 04-19 function room',
      'unit 04-19',
      '#05-12',
      '#21-201',
      'unit 48',
      'unit E',
      'unit 21',
      'suite 200',
      'level 3',
      'floor 86',
      'apt 4B',
      'room 12',
      'flat 2',
      'fl 3',
      '# 4',
      'blk 7 unit 2',
      'level 2 west wing',
      'unit 5 back door',
      'room 101 court side',
      'suite ne 4',
      'apt 2 ct',
      'unit 62701',
      'level 1 main st entrance',
      'unit 12 east',
    ];
    for (let i = 0; i < 2000; i++) {
      const [carried, street] = places[rand(places.length)]!;
      const picked = street.filter(() => rand(4) > 0);
      if (!picked.length) picked.push(street[0]!);
      const head = picked.map((spellings) => spellings[rand(spellings.length)]!);
      const tail = tails[rand(tails.length)]!;
      const typed = `${head.join(' ')} ${tail}`;
      const detail = wordTokenList(splitKeptDetail(typed, { carried }));
      const address = new Set(words(carried));
      for (const t of wordTokenList(tail)) {
        if (!address.has(fold(t))) expect(detail, `lost "${t}" from "${typed}"`).toContain(t);
      }
    }
  });

  it('a whole word only the suggestion text carries is never dropped, wherever it is typed', () => {
    for (const typed of [
      'Marina Bay Sands',
      'marina bay sands level 2',
      'level 2 marina bay sands',
    ])
      expect(splitKeptDetail(typed, { carried: MBS_STORED, main: MBS_MAIN })).toMatch(
        /marina bay sands/i
      );
  });
});

const MBS_STORED = '10 Bayfront Ave, Singapore 018956';
const MBS_MAIN = 'Marina Bay Sands Singapore';

describe('the place is a value object in the merge', () => {
  it('none of the place keys is merged per key (MERGE_FIELDS), so placeId and name never split', () => {
    for (const key of Object.values(PLACE_FIELDS)) expect(MERGE_FIELDS.has(key)).toBe(false);
  });
});
