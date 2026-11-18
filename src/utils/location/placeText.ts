/**
 * A location string and the place picked for it (#150, ADR-049). Pure functions, no Vue, no
 * store: every reader and writer of a `*Place` sibling field goes through this file.
 *
 * THE MODEL. The legacy string (`location` / `address` / `agencyAddress`) stays the source of
 * truth and keeps holding readable text. A picked place is an optional sibling `PlaceRef`
 * (`{ placeId, name, title? }`) that only adds the exact map link and the two- or three-line
 * display. Its LEAD (`placeLead`) is how the string begins: `name`, or `title, name` for a
 * named place (a business, ADR-049 addendum of 2026-11-18). The kept detail is not stored: it
 * is the rest of the string after `lead + ', '`.
 *
 * THE VALIDITY RULE IS THE MERGE-SAFETY MECHANISM. The string and its place are two
 * independent last-writer-wins registers, so a merge can pair device B's string with device
 * A's place. `validPlace` is what makes that harmless: a place is honoured only while the
 * string still begins with its lead, and is inert otherwise. Nothing else inspects a stored
 * place.
 */
import type { PlaceRef } from '@/types/models';
import { isWordBoundedScript, wordTokenList } from '@/utils/textSimilarity';

/** The ONLY place the string-to-sibling pairing is spelled. */
export const PLACE_FIELDS = Object.freeze({
  location: 'locationPlace',
  address: 'addressPlace',
  agencyAddress: 'agencyAddressPlace',
} as const);

export type PlaceField = keyof typeof PLACE_FIELDS;
export type PlaceSiblingField = (typeof PLACE_FIELDS)[PlaceField];

/**
 * Words that introduce a sub-premise (a block, unit, floor or room) rather than the street.
 * Shared by `splitKeptDetail` (one starts the tail, and a keyword is kept only with what follows
 * it) and the composable's one trimmed retry (the query is cut before the first of them).
 * Frozen: changing the list changes both, and ADR-049 records it.
 */
export const SUB_PREMISE_KEYWORDS: ReadonlySet<string> = Object.freeze(
  new Set(['block', 'blk', 'unit', 'apt', 'suite', 'level', 'floor', 'fl', 'room', 'flat'])
) as ReadonlySet<string>;

/** Google place IDs seen in the spike were 27 to 134 characters of `[A-Za-z0-9_-]`. */
const PLACE_ID_SHAPE = /^[\w-]{1,512}$/;

function isCleanString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.trim() === v;
}

/**
 * The only constructor, with a fixed key order (`placeId`, `name`, `title`), so two equal places
 * always serialize the same and `diffPayload`'s `JSON.stringify` comparison sees no change. A
 * blank title is omitted (the key is absent, never empty). It also unwraps a reactive proxy into
 * a plain object the repository can clone.
 */
export function makePlaceRef(place: { placeId: string; name: string; title?: string }): PlaceRef {
  const ref: PlaceRef = { placeId: place.placeId, name: place.name };
  if (typeof place.title === 'string' && place.title.trim() !== '') ref.title = place.title;
  return ref;
}

/**
 * How a place's string begins: the address alone, or `title, name` for a named place. The ONLY
 * place the titled spelling is built; `composePlaceText`, `validPlace`, `detailOf` and `mapsHref`
 * all read it, so a place without a title is byte for byte what it was before titles.
 */
export function placeLead(place: { name: string; title?: string }): string {
  return place.title ? `${place.title}, ${place.name}` : place.name;
}

/**
 * The place when it may be honoured for `text`, else `undefined`. Holds when `place` is an
 * object whose `placeId` and `name` are non-empty strings with no leading or trailing
 * whitespace, `placeId` has the provider's ID shape, `title` is absent or such a string too,
 * and the trimmed text is exactly the lead (`placeLead`) or starts with lead + ', '. Also the
 * type guard for document data.
 */
export function validPlace(text: string | null | undefined, place: unknown): PlaceRef | undefined {
  if (typeof text !== 'string' || !place || typeof place !== 'object') return undefined;
  const { placeId, name, title } = place as Record<string, unknown>;
  if (!isCleanString(placeId) || !isCleanString(name)) return undefined;
  if (title !== undefined && !isCleanString(title)) return undefined;
  if (!PLACE_ID_SHAPE.test(placeId)) return undefined;
  const lead = placeLead({ name, title: title as string | undefined });
  const t = text.trim();
  if (t !== lead && !t.startsWith(`${lead}, `)) return undefined;
  return place as PlaceRef;
}

/** The kept detail: what follows lead + ', ' in the string, or '' (also for an inert place). */
export function detailOf(text: string | null | undefined, place: unknown): string {
  const valid = validPlace(text, place);
  if (!valid || typeof text !== 'string') return '';
  return text
    .trim()
    .slice(placeLead(valid).length + 2)
    .trim();
}

/** Leading and trailing separators and whitespace, which a detail line never needs. */
function stripEdgeSeparators(s: string): string {
  return s.replace(/^[\s,;]+/, '').replace(/[\s,;]+$/, '');
}

/**
 * The string a picked place and its detail are saved as: the lead (`name`, or `title, name`),
 * then `, detail` when there is one.
 */
export function composePlaceText(place: { name: string; title?: string }, detail: string): string {
  const lead = placeLead(place);
  const d = stripEdgeSeparators(detail ?? '');
  return d ? `${lead}, ${d}` : lead;
}

/**
 * The write half: the string and its sibling together, for a form payload or a store patch.
 * The place is written only when it is valid for this exact string (whole, via
 * `makePlaceRef`); otherwise the sibling is `undefined`, which the repository turns into a key
 * delete. The caller passes the string in that form's existing spelling (trimmed or not, as
 * today), so the string written with the feature off is unchanged.
 */
export function placePatch<F extends PlaceField>(
  field: F,
  text: string,
  place: PlaceRef | null | undefined
): PlacePatch<F, string>;
export function placePatch<F extends PlaceField>(
  field: F,
  text: string | undefined,
  place: PlaceRef | null | undefined
): PlacePatch<F, string | undefined>;
export function placePatch<F extends PlaceField>(
  field: F,
  text: string | undefined,
  place: PlaceRef | null | undefined
): PlacePatch<F, string | undefined> {
  const valid = validPlace(text, place);
  return {
    [field]: text,
    [PLACE_FIELDS[field]]: valid ? makePlaceRef(valid) : undefined,
  } as PlacePatch<F, string | undefined>;
}

/** What `placePatch` returns: the string under `field`, the place under its sibling. */
export type PlacePatch<F extends PlaceField, T> = Record<F, T> &
  Record<(typeof PLACE_FIELDS)[F], PlaceRef | undefined>;

// ─── splitKeptDetail ──────────────────────────────────────────────────────────

/**
 * Long form to the short form Google's formatted address uses, folded on both sides before
 * comparing. Only these pairs (ADR-049): no per-locale tables, and `blk`/`block` is
 * deliberately NOT folded because a block is detail. A pair missing from this table can only
 * make the detail keep a stray word ("Avenida" against "Av."), never lose one.
 */
export const ADDRESS_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  road: 'rd',
  street: 'st',
  avenue: 'ave',
  boulevard: 'blvd',
  drive: 'dr',
  lane: 'ln',
  place: 'pl',
  parkway: 'pkwy',
  court: 'ct',
  square: 'sq',
  highway: 'hwy',
  crescent: 'cres',
  terrace: 'ter',
  jalan: 'jln',
  lorong: 'lor',
  mount: 'mt',
});

const fold = (token: string): string => ADDRESS_ABBREVIATIONS[token] ?? token;

/** One word of the stored address. `folds`: it sits where abbreviations apply. */
interface AddressWord {
  word: string;
  folds: boolean;
}

/**
 * The stored address's words in order. Abbreviations apply only on its STREET LINE (the part
 * before the first comma, together with any leading sub-premise parts such as the "flat 2" of
 * "flat 2, 221B Baker St, London"); city, state, postcode and country compare exactly, so
 * `court` never meets the state code `CT`.
 */
function addressWords(carried: string): AddressWord[] {
  const parts = carried.split(',');
  let street = 0;
  while (street < parts.length - 1) {
    const part = parts[street]!.trim();
    const first = wordTokenList(part)[0];
    if (!part.startsWith('#') && !(first && SUB_PREMISE_KEYWORDS.has(first))) break;
    street++;
  }
  return parts.flatMap((part, i) =>
    wordTokenList(part).map((word) => ({ word, folds: i <= street }))
  );
}

const sameWord = (typed: string, stored: AddressWord): boolean =>
  stored.folds ? fold(typed) === fold(stored.word) : typed === stored.word;

/**
 * The longest in-order alignment of `typed` against the `free` words of `address`, as the
 * set of typed positions it uses and the address positions it spends. Ties go to the LATER
 * typed words (the backtrack starts at the end), so in "unit 48, 48 Main St" the street takes
 * the second 48 and the unit keeps the first.
 */
function align(
  typed: readonly string[],
  address: readonly AddressWord[],
  free: (j: number) => boolean
): { typed: Set<number>; spent: Set<number> } {
  const n = typed.length;
  const m = address.length;
  const at = (i: number, j: number) => i * (m + 1) + j;
  const best = new Uint16Array((n + 1) * (m + 1));
  const hit = (i: number, j: number) => free(j) && sameWord(typed[i]!, address[j]!);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      best[at(i, j)] = hit(i - 1, j - 1)
        ? best[at(i - 1, j - 1)]! + 1
        : Math.max(best[at(i - 1, j)]!, best[at(i, j - 1)]!);
    }
  }
  const used = { typed: new Set<number>(), spent: new Set<number>() };
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (hit(i - 1, j - 1)) {
      used.typed.add(--i);
      used.spent.add(--j);
    } else if (best[at(i, j - 1)] === best[at(i, j)]) j--;
    else i--;
  }
  return used;
}

/**
 * A half-typed word must be at least this long to count as a fragment. One letter is far more
 * often a real unit ("12 Main St B" against "..., Boston") than the start of a word, and
 * dropping it would LOSE typed text, the one direction this function must never fail in.
 */
const MIN_FRAGMENT_CHARS = 2;

/**
 * Which typed positions are a half-typed word: an in-order alignment of `typed` against the
 * main text, where a word matches a main word exactly (abbreviations folded) anywhere later
 * in order, or, with at least `MIN_FRAGMENT_CHARS`, as a STRICT PREFIX of the main word right
 * after the previous match (no skipping ahead for a prefix). Best alignment = most matches,
 * then fewest prefix matches (so a word is called a fragment only when it must be).
 */
function fragmentPositions(typed: readonly string[], main: readonly string[]): Set<number> {
  type Plan = { matches: number; prefixes: number; picks: number[] };
  const memo = new Map<string, Plan>();
  const better = (a: Plan, b: Plan) =>
    a.matches !== b.matches ? a.matches > b.matches : a.prefixes < b.prefixes;
  const plan = (i: number, last: number): Plan => {
    if (i === typed.length) return { matches: 0, prefixes: 0, picks: [] };
    const key = `${i}:${last}`;
    const known = memo.get(key);
    if (known) return known;
    let best = plan(i + 1, last);
    const word = typed[i]!;
    for (let j = last + 1; j < main.length; j++) {
      if (fold(word) !== fold(main[j]!)) continue;
      const rest = plan(i + 1, j);
      const take = { matches: rest.matches + 1, prefixes: rest.prefixes, picks: rest.picks };
      if (better(take, best)) best = take;
    }
    const next = main[last + 1];
    if (
      next !== undefined &&
      // Only the LAST typed word can be half-typed: an earlier short word ("west" before
      // "wing", against "Westfield") is a word the member finished.
      i === typed.length - 1 &&
      word.length >= MIN_FRAGMENT_CHARS &&
      next.length > word.length &&
      next.startsWith(word) &&
      fold(word) !== fold(next)
    ) {
      const rest = plan(i + 1, last + 1);
      const take = {
        matches: rest.matches + 1,
        prefixes: rest.prefixes + 1,
        picks: [i, ...rest.picks],
      };
      if (better(take, best)) best = take;
    }
    memo.set(key, best);
    return best;
  };
  return new Set(plan(0, -1).picks);
}

interface Chunk {
  raw: string;
  /** Lowercased word tokens, unfolded. */
  words: string[];
}

const isKeywordChunk = (c: Chunk) => c.words.length === 1 && SUB_PREMISE_KEYWORDS.has(c.words[0]!);
/** A keyword chunk (`Blk`, `unit:`) or one with no word at all (`#`, `-`). */
const isLeadIn = (c: Chunk) => c.words.length === 0 || isKeywordChunk(c);

export interface KeptDetailSources {
  /** What is stored: the provider's formatted address (the place's `name`). */
  carried: string;
  /**
   * The picked suggestion's main text (the bold line). Used ONLY to recognise a half-typed
   * last word; for an address pick it is never stored, so a whole word only it carries is kept
   * as detail.
   */
  main?: string;
  /**
   * The named place's stored title (`PlaceRef.title`), when the pick has one. The typed words it
   * carries, at the head of the typed text, are dropped before the address is compared.
   */
  title?: string;
}

/**
 * Whether `address` already carries every word of `title`, in order (abbreviations folded on its
 * street line, as `splitKeptDetail` compares): a "named place" whose name is just its address
 * ("1 Raffles Place" against "1 Raffles Pl, Singapore 048616"), which must not be stored as a
 * title or the saved string would repeat itself. A title with no word breaks (CJK) is carried
 * when the address contains it; a title with no word at all counts as carried.
 */
export function addressCarriesTitle(title: string, address: string): boolean {
  const t = (title ?? '').trim();
  if (!isWordBoundedScript(t)) return (address ?? '').includes(t);
  const words = wordTokenList(t);
  return align(words, addressWords((address ?? '').trim()), () => true).typed.size === words.length;
}

/**
 * What the member typed that the SAVED place line does not carry, in typed order and spelling,
 * worked out against what is stored (`carried`, Google's formatted address):
 * "127 south bridge road block 48 unit 04-19 function room" against "127 S Bridge Rd,
 * Singapore 058285" is "block 48 unit 04-19 function room". WHEN UNSURE IT KEEPS MORE, NEVER
 * LESS: the detail line is editable and "Keep what I typed" exists, so keeping too much is not
 * a bug; losing typed text is (ADR-049 change rule).
 *
 * Words are compared IN ORDER (an alignment, never a bag of words), with
 * `ADDRESS_ABBREVIATIONS` folding only against the address's street line and the main text;
 * the rest of the address (city, state, postcode, country) compares exactly. The typed text is
 * split on whitespace into chunks.
 * 1. TAIL. From the first chunk that is a sub-premise keyword or starts with `#`, provided an
 *    earlier chunk is not a keyword, to the end ("Blk 293 Yishun Street 22 #05-12" has the tail
 *    "#05-12"; "unit 04-19, 127 south bridge road" has none).
 * 2. HEAD. The chunks before the tail are aligned in order against the address; a chunk is
 *    dropped only when every word of it is in the alignment.
 * 3. The tail is decided whole: dropped only when every one of its words aligns, in order, with
 *    the address words the head did not use (the address carries the unit itself, as in
 *    "1 Raffles Pl, #20 61 tower 2"). Otherwise it is kept verbatim.
 * 4. FRAGMENTS (head only, no tail). A head chunk the address does not carry, with a word that
 *    is only a strict prefix (two or more letters) of the next word of the main text, is
 *    half-typed and dropped: "127 s brid" leaves nothing, "marina bay sa" keeps "marina bay".
 *    Any other head chunk the address does not carry is kept ("Marina Bay Sands", "west wing").
 * 5. A keyword or wordless head chunk is kept only if the chunk after it is kept, so
 *    "Blk 293 Yishun Street 22 #05-12" keeps "#05-12", not "Blk #05-12".
 *
 *
 * WITH A TITLE (a named place, whose saved string leads with the title), a step 0 runs first:
 * the leading typed chunks whose words all align, in order, with the title's words (folded the
 * same way) are dropped, a wordless chunk only between two of them. The rest of the typed text
 * then runs steps 1 to 5 against `carried`, with the title's words after the last one matched
 * standing in for the main text in the fragment rule: "hungarian touch back room" against "The
 * Hungarian Touch" is "back room", and "hungarian tou" is ''. When no head chunk aligns, the
 * title changes nothing. Text with no word breaks is dropped whole when the title contains it.
 *
 * Text with no word breaks (CJK, see `isWordBoundedScript`) is not tokenized: when it sits
 * inside `carried` nothing is left over, when `carried` sits inside it that part is removed,
 * and otherwise the whole typed text is kept.
 */
export function splitKeptDetail(typed: string, sources: KeptDetailSources): string {
  const source = (typed ?? '').trim();
  if (!source) return '';
  const title = (sources.title ?? '').trim();
  if (!title) return splitAgainstAddress(source, sources.carried, sources.main);
  if (!isWordBoundedScript(source)) {
    return title.includes(source) ? '' : splitAgainstAddress(source, sources.carried, sources.main);
  }

  // 0. The head chunks the title carries whole, in order.
  const chunks = source.split(/\s+/).filter(Boolean);
  const chunkWords = chunks.map((c) => wordTokenList(c));
  const titleWords: AddressWord[] = wordTokenList(title).map((word) => ({ word, folds: true }));
  const fit = align(chunkWords.flat(), titleWords, () => true);
  let dropped = 0; // chunks
  let droppedWords = 0;
  for (let i = 0, k = 0; i < chunks.length; i++) {
    const n = chunkWords[i]!.length;
    if (n === 0) continue; // a wordless chunk goes only with a carried chunk after it
    let all = true;
    for (let w = k; w < k + n; w++) if (!fit.typed.has(w)) all = false;
    if (!all) break;
    k += n;
    dropped = i + 1;
    droppedWords = k;
  }
  // The alignment is in order, so the dropped words are its first matches.
  const lastTitleWord =
    dropped === 0 ? -1 : [...fit.spent].sort((x, y) => x - y)[droppedWords - 1]!;
  // A single half-typed word left over ("hungar" when the pick is "The Hungarian Touch") is the
  // search text for the name, not a detail: dropped when it is a strict prefix of a later title
  // word. Only ever the one last chunk, and never a one-letter word (a unit like "B").
  const left = chunks.slice(dropped);
  const lone = left.length === 1 ? wordTokenList(left[0]!) : [];
  if (
    lone.length === 1 &&
    lone[0]!.length >= MIN_FRAGMENT_CHARS &&
    titleWords
      .slice(lastTitleWord + 1)
      .some((w) => w.word.length > lone[0]!.length && w.word.startsWith(lone[0]!))
  ) {
    return '';
  }
  if (dropped === 0) return splitAgainstAddress(source, sources.carried, sources.main);
  return splitAgainstAddress(
    chunks.slice(dropped).join(' '),
    sources.carried,
    titleWords
      .slice(lastTitleWord + 1)
      .map((w) => w.word)
      .join(' ')
  );
}

/** Steps 1 to 5 of `splitKeptDetail` (and its no-word-break rule), against the address. */
function splitAgainstAddress(typed: string, carriedRaw: string, main: string | undefined): string {
  const carried = (carriedRaw ?? '').trim();
  const source = (typed ?? '').trim();
  if (!source) return '';

  if (!isWordBoundedScript(source)) {
    if (!carried) return stripEdgeSeparators(source);
    if (carried.includes(source)) return '';
    const at = source.indexOf(carried);
    if (at < 0) return stripEdgeSeparators(source);
    const rest = `${source.slice(0, at)} ${source.slice(at + carried.length)}`;
    return stripEdgeSeparators(rest.replace(/\s+/g, ' '));
  }

  const address = addressWords(carried);
  const chunks: Chunk[] = source
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, words: wordTokenList(raw) }));

  // 1. The tail.
  let tail = chunks.findIndex(
    (c, i) =>
      (isKeywordChunk(c) || c.raw.startsWith('#')) &&
      chunks.slice(0, i).some((p) => !isKeywordChunk(p))
  );
  if (tail < 0) tail = chunks.length;

  // 2. The head, aligned in order.
  const headWords: string[] = [];
  const owner: number[] = [];
  chunks.slice(0, tail).forEach((c, i) => {
    for (const w of c.words) {
      headWords.push(w);
      owner.push(i);
    }
  });
  const head = align(headWords, address, () => true);
  const kept = chunks.map(() => true);
  const carriedChunk = chunks.map(
    (c, i) => i < tail && c.words.length > 0 && owner.every((o, k) => o !== i || head.typed.has(k))
  );
  carriedChunk.forEach((isCarried, i) => {
    if (isCarried) kept[i] = false;
  });

  // 3. The tail, as a whole, against the address words the head left.
  if (tail < chunks.length) {
    const tailWords = chunks.slice(tail).flatMap((c) => c.words);
    const fit = align(tailWords, address, (j) => !head.spent.has(j));
    // The address carries the unit only when it carries ALL of it, as one unbroken run of two
    // or more words. A lone number ("#4" against the house number in "4 Main St") or words
    // scattered through the address are coincidences, and the tail is kept.
    const spots = [...fit.spent].sort((x, y) => x - y);
    const unbroken = spots.every((j, k) => k === 0 || j === spots[k - 1]! + 1);
    if (tailWords.length >= 2 && fit.typed.size === tailWords.length && unbroken) {
      for (let i = tail; i < chunks.length; i++) kept[i] = false;
    }
  } else {
    // 4. Fragments.
    const half = fragmentPositions(headWords, wordTokenList(main ?? ''));
    owner.forEach((i, k) => {
      if (half.has(k) && !carriedChunk[i]) kept[i] = false;
    });
  }

  // 5. A lead-in follows what comes after it; decided right to left so chains settle.
  for (let i = tail - 1; i >= 0; i--) {
    if (kept[i] && isLeadIn(chunks[i]!) && i + 1 < chunks.length && !kept[i + 1]) kept[i] = false;
  }

  return stripEdgeSeparators(
    chunks
      .filter((_, i) => kept[i])
      .map((c) => c.raw)
      .join(' ')
  );
}

// ─── Maps link ────────────────────────────────────────────────────────────────

const MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1';

/**
 * The Google Maps link for a location. With a valid place it opens that exact place
 * (`query` = the place's lead, `name` or `title, name`, never the detail; `query_place_id` = its
 * ID). Without one it is byte for byte the text search every surface built inline before #150.
 */
export function mapsHref(text: string, place?: PlaceRef | null): string {
  const valid = validPlace(text, place);
  if (!valid) return `${MAPS_SEARCH}&query=${encodeURIComponent(text)}`;
  return `${MAPS_SEARCH}&query=${encodeURIComponent(placeLead(valid))}&query_place_id=${encodeURIComponent(valid.placeId)}`;
}
