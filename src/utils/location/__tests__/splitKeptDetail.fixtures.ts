/**
 * The `splitKeptDetail` table (#150, ADR-049). Seeded from the Phase 0 spike addresses
 * (`~/projects/beanies-ops/docs/research/2026-11-18-place-search-providers.md`), with the
 * formatted address Google stored (`carried`) and the suggestion's two lines (`main`, the
 * bold line; `secondary`, the grey one).
 * Change rule: the function changes only for a row where typed text was LOST, or where a
 * half-typed fragment was kept. A row that keeps too much is not a bug (the detail line is
 * editable).
 */
export interface SplitFixture {
  /** What the member typed. */
  typed: string;
  /** What is stored: the provider's formatted address (the place `name`). */
  carried: string;
  /** The picked suggestion's main text (the only suggestion text `splitKeptDetail` reads). */
  main?: string;
  /** The suggestion's secondary text: recorded for the reader, never read by the function. */
  secondary?: string;
  /** The kept detail. */
  detail: string;
  note?: string;
}

const SOUTH_BRIDGE = '127 S Bridge Rd, Singapore 058285';
const SB_MAIN = '127 South Bridge Road';
const MBS = '10 Bayfront Ave, Singapore 018956';
const MBS_MAIN = 'Marina Bay Sands Singapore';
const MBS_SECONDARY = 'Bayfront Avenue, Singapore';

export const SPLIT_FIXTURES: readonly SplitFixture[] = [
  // ── The spike rows (carried = Google's formatted address) ──
  {
    typed: '127 south bridge road block 48 unit 04-19 function room',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: 'block 48 unit 04-19 function room',
    note: "greg's example (spike #1): south/s and road/rd fold against the street line",
  },
  {
    typed: 'Blk 293 Yishun Street 22 #05-12',
    main: '293 Yishun Street 22',
    secondary: 'Singapore',
    carried: '293 Yishun Street 22, Singapore 760292',
    detail: '#05-12',
    note: 'a keyword is kept only if the chunk after it is kept (not "Blk #05-12")',
  },
  {
    typed: 'blk 201 tampines st 21 #21-201',
    main: '201 Tampines Street 21',
    secondary: 'Singapore',
    carried: '201 Tampines St 21, Singapore 520201',
    detail: '#21-201',
    note: 'the unit repeats street numbers: the tail is decided whole, against the unused words',
  },
  {
    typed: '1 Raffles Place #20-61 Tower 2',
    carried: '1 Raffles Pl, #20 61 tower 2, Singapore 048616',
    detail: '',
    note: 'Google subpremise result: the stored address itself carries the whole unit',
  },
  {
    typed: '221B Baker Street London flat 2',
    carried: 'flat 2, 221B Baker St, London W1U 6QQ, UK',
    detail: '',
    note: 'the address leads with the flat: its street line is the part after the sub-premise',
  },
  {
    typed: '1600 Amphitheatre Parkway Mountain View suite 200',
    carried: '1600 Amphitheatre Pkwy suite 200, Mountain View, CA 94043, USA',
    detail: '',
    note: 'parkway / pkwy fold; the address carries the suite',
  },
  {
    typed: 'unit 04-19, 127 south bridge road',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: 'unit 04-19',
    note: 'detail first, with a comma: a keyword at the very start is not a tail',
  },

  // ── Picking mid-word: a half-typed fragment is never kept ──
  {
    typed: '127 s brid',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: '',
    note: 'picked mid-word: "brid" is in-progress typing of "Bridge"',
  },
  {
    typed: '127 sou',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: '',
    note: 'a fragment of a word the address abbreviates ("sou" of South / S)',
  },
  {
    typed: '127 south bri',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: '',
    note: 'picked mid-word after a full direction word',
  },
  {
    typed: '127 south bridge',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: '',
  },
  {
    typed: '127 south bridge road',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: '',
  },
  {
    typed: '127 south bridge road block 48 unit B',
    main: SB_MAIN,
    secondary: 'Singapore',
    carried: SOUTH_BRIDGE,
    detail: 'block 48 unit B',
    note: 'a tail is never read for fragments, so "B" is not taken for the start of Bridge',
  },

  // ── A venue name the stored address does not carry is kept ──
  {
    typed: 'Marina Bay Sands',
    main: MBS_MAIN,
    secondary: MBS_SECONDARY,
    carried: MBS,
    detail: 'Marina Bay Sands',
    note: 'typed venue name in full: only the suggestion text carries it, so it is kept',
  },
  {
    typed: 'marina bay sa',
    main: MBS_MAIN,
    secondary: MBS_SECONDARY,
    carried: MBS,
    detail: 'marina bay',
    note: 'venue name picked mid-word: the whole words stay, the fragment goes',
  },
  {
    typed: 'marina bay s',
    main: MBS_MAIN,
    secondary: MBS_SECONDARY,
    carried: MBS,
    detail: 'marina bay s',
    note: 'one letter is too short to call a fragment: kept (keeps more, never less)',
  },
  {
    typed: 'starbucks vivocity',
    main: 'Starbucks VivoCity',
    secondary: 'HarbourFront Walk, Singapore',
    carried: '1 HarbourFront Walk, #01-01, Singapore 098585',
    detail: 'starbucks vivocity',
  },
  {
    typed: 'Marina Bay Sands',
    carried: 'Marina Bay Sands, Singapore',
    detail: '',
    note: 'the stored address carries the venue name: nothing left over',
  },
  {
    typed: 'Mt Elizabeth hospital level 3',
    main: 'Mount Elizabeth Hospital',
    secondary: '3 Mount Elizabeth, Singapore',
    carried: '3 Mount Elizabeth, Singapore 228510',
    detail: 'hospital level 3',
    note: 'mt / mount fold; the 3 of "level 3" is not the street number typed out of order',
  },
  {
    typed: 'raffles place tower 1',
    carried: '1 Raffles Pl, Singapore 048616',
    detail: 'tower 1',
    note: 'order-aware: the 1 typed after the street is not the street number before it',
  },

  // ── One-letter and short units ──
  {
    typed: 'Main St #4',
    main: '4 Main Street',
    secondary: 'Springfield, IL, USA',
    carried: '4 Main St, Springfield, IL 62701, USA',
    detail: '#4',
    note: 'a lone unit number is never spent on the house number the member left out',
  },
  {
    typed: 'Tampines St 21 #201',
    main: '201 Tampines Street 21',
    secondary: 'Singapore',
    carried: '201 Tampines St 21, Singapore 520201',
    detail: '#201',
    note: 'same: the unit is not the block number',
  },
  {
    typed: 'west wing',
    main: 'Westfield Sydney',
    secondary: 'Pitt Street, Sydney NSW, Australia',
    carried: '188 Pitt St, Sydney NSW 2000, Australia',
    detail: 'west wing',
    note: 'only the last typed word can be a half-typed fragment',
  },
  {
    typed: 'the gym upstairs',
    main: 'The Gymnasium',
    secondary: 'Orchard Road, Singapore',
    carried: '10 Orchard Rd, Singapore 238841',
    detail: 'the gym upstairs',
    note: 'a finished word before the end is never a fragment',
  },
  {
    typed: '12 Main St B',
    main: '12 Main Street',
    secondary: 'Boston, MA, USA',
    carried: '12 Main St, Boston, MA 02101, USA',
    detail: 'B',
    note: 'a one-letter unit is never read as the start of a word in the address',
  },
  {
    typed: '12 Main St unit E',
    carried: '12 E Main St, Boston, MA 02127, USA',
    detail: 'unit E',
    note: '"unit" is not in the address, so the whole tail stays (its E is not the E of E Main St)',
  },
  {
    typed: '100 main st fl 3',
    carried: '100 Main St, Miami, FL 33130, USA',
    detail: 'fl 3',
    note: 'fl is a sub-premise keyword: the FL state code cannot take it',
  },
  {
    typed: '1500 Locust St PH',
    main: '1500 Locust Street',
    secondary: 'Philadelphia, PA, USA',
    carried: '1500 Locust St, Philadelphia, PA 19102, USA',
    detail: 'PH',
    note: 'a prefix of a word in the secondary line (Philadelphia) is not a fragment',
  },
  {
    typed: '12 Sheikh Zayed Rd unit 5',
    carried: '12 Sheikh Zayed Rd - Dubai - United Arab Emirates',
    detail: 'unit 5',
    note: 'no comma: the whole address is the street line',
  },
  {
    typed: '12 Main St No 5',
    carried: '12 N Main St, Salem, OR 97301, USA',
    detail: 'No 5',
  },

  // ── Folding is for the street line only ──
  {
    typed: '45 Elm St Hartford food court',
    carried: '45 Elm St, Hartford, CT 06103, USA',
    detail: 'food court',
    note: 'court never matches the state code CT',
  },
  {
    typed: '1200 O St Lincoln northeast entrance',
    carried: '1200 O St, Lincoln, NE 68508, USA',
    detail: 'northeast entrance',
    note: 'northeast never matches the state code NE',
  },
  {
    typed: '10 Main St west wing',
    carried: '10 W Main St, Springfield, IL 62701, USA',
    detail: 'west wing',
    note: 'order-aware: the W before Main cannot take a west typed after St',
  },
  {
    typed: '5 church rd court 2',
    carried: '5 Church Rd, Stamford, CT 06901, USA',
    detail: 'court 2',
  },
  {
    typed: '5 jalan besar back door',
    carried: '5 Jln Besar, Singapore 208787',
    detail: 'back door',
    note: 'jalan / jln fold',
  },
  {
    typed: '5 Avenida Paulista sala 4',
    carried: '5 Av. Paulista, São Paulo',
    detail: 'Avenida sala 4',
    note: 'an unfolded abbreviation keeps a stray word, never loses one',
  },
  {
    typed: '10 Downing Rd back entrance',
    carried: '10 Downing Road, London',
    detail: 'back entrance',
    note: 'road / rd fold',
  },
  {
    typed: 'Sunset Blvd 1 gate B',
    carried: '1 Sunset Boulevard, Los Angeles',
    detail: '1 gate B',
    note: 'CHANGED (was "gate B"): the number typed after the street is out of order, so kept',
  },
  {
    typed: '350 5th Ave New York floor 86',
    carried: '350 5th Ave floor 86, New York, NY, USA',
    detail: '',
  },
  {
    typed: '350 5th Ave New York floor 86',
    carried: '350 5th Ave floor 86, Brooklyn, NY 11215, USA',
    detail: 'New York',
    note: 'a city the picked place does not have is kept; the floor it does carry goes',
  },

  // ── Counting and lead-ins ──
  {
    typed: '127 south bridge',
    carried: '127 South Bridge Road, Singapore',
    detail: '',
    note: 'partial typing of whole words',
  },
  {
    typed: '48 Main St unit 48',
    carried: '48 Main Street, Springfield',
    detail: 'unit 48',
    note: 'each address word is used once: the street number cannot carry the unit too',
  },
  {
    typed: 'unit 48, 48 Main St',
    carried: '48 Main St, Springfield, IL 62701, USA',
    detail: 'unit 48',
    note: 'detail first; the alignment takes the later 48 for the street',
  },
  {
    typed: '12 Main St, Room 3',
    carried: '12 Main Street',
    detail: 'Room 3',
    note: 'detail last, with a comma',
  },
  {
    typed: '18 mosque st loft room 12',
    carried: '18 Mosque Street, Singapore',
    detail: 'loft room 12',
  },
  {
    typed: '18 mosque st loft room 12',
    main: '18 Mosque Street',
    secondary: 'Singapore',
    carried: '18 Mosque St, Singapore 059498',
    detail: 'loft room 12',
    note: 'a number in both texts is not counted twice',
  },
  {
    typed: 'community hall behind the library',
    carried: '5 Elm Street, Springfield',
    detail: 'community hall behind the library',
    note: 'nothing matched: everything is kept',
  },
  {
    typed: '12 Main St room',
    carried: '12 Main Street',
    detail: 'room',
    note: 'a trailing keyword with nothing after it is kept (keeps more when unsure)',
  },
  {
    typed: '7 Elm St # 4',
    carried: '7 Elm Street',
    detail: '# 4',
    note: 'a # chunk starts the tail, which is kept whole',
  },
  {
    typed: '5 Rue de la Paix, appartement 3',
    carried: '5 Rue de la Paix, 75002 Paris, France',
    detail: 'appartement 3',
  },

  // ── No word breaks ──
  {
    typed: '東京都渋谷区道玄坂2-1 3階',
    carried: '2 Chome-1 Dogenzaka, Shibuya, Tokyo, Japan',
    detail: '東京都渋谷区道玄坂2-1 3階',
    note: 'CJK, no substring match: the whole typed text is kept',
  },
  {
    typed: '東京都渋谷区道玄坂2-1 3階',
    carried: '東京都渋谷区道玄坂2-1',
    detail: '3階',
    note: 'CJK, the stored address is a substring: it is removed',
  },
  {
    typed: '東京都渋谷区',
    carried: '日本、〒150-0043 東京都渋谷区道玄坂2-1',
    detail: '',
    note: 'CJK, picked mid-way: every typed character is in the stored address',
  },
  {
    typed: '東京都渋谷区道玄坂2-1 3階',
    main: '東京都渋谷区道玄坂2-1',
    carried: '日本、〒150-0043 東京都渋谷区道玄坂２丁目１',
    detail: '東京都渋谷区道玄坂2-1 3階',
    note: 'CJK, only the suggestion text matches: kept (the stored address does not carry it)',
  },
  { typed: '', carried: '12 Main Street', detail: '' },
];
