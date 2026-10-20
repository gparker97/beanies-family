/**
 * Scalar-string support for the Automerge worker (#124). This file must stay
 * Automerge-free: reconcile.ts and photoOps.ts import it.
 *
 * Maintenance contract:
 *  (a) A new string field is classified in SCALAR_FIELDS or TEXT_FIELDS when it is added (the audit refuses it otherwise).
 *  (b) A worker read of a raw doc value compares `str(v)`, never `v` (the `str`-form test case is the enforcement).
 *  (c) `str` tolerance in readers is permanent once the writer has ever been on, and is never removed.
 *
 * One import for everything scalar: the classification table, the read half (`str`,
 * `isImmutableString`, `isMapValue`) and the write half (`docValue`, `stampUpdatedAt`, the mint
 * slot). Writer ON is exactly "a mint is installed" (`setScalarMint`, by the worker realm's
 * `setDataPolicy` dispatch); there is no second switch.
 */

/** Turns a plain string into the engine's scalar-string value. */
export type ScalarMint = (s: string) => unknown;

let mint: ScalarMint | null = null;

/** Installed by the worker realm's `setDataPolicy` dispatch; `null` = writer OFF. */
export function setScalarMint(fn: ScalarMint | null): void {
  mint = fn;
}

export function scalarMint(): ScalarMint | null {
  return mint;
}

// ─── Reading: tolerate both forms ────────────────────────────────────────────

/**
 * The engine's own marker (`@automerge/automerge` `constants.js`, pinned by the #124 spike in
 * `automergeSemantics.test.ts` (q)). Looked up through the global symbol registry, so there is no
 * module-identity dependency: the legacy 3.2.6 alias and 3.5.0 share it.
 */
const IMMUTABLE_STRING = Symbol.for('_am_immutableString');

/**
 * Is `v` an Automerge `ImmutableString` (a `str` scalar)? The engine's own check (an OWN
 * property keyed by the marker symbol), so a `structuredClone`d `{ val }` is NOT one: such a
 * value has already lost its form and is just an object.
 *
 * ⚠️ PLUS `!Array.isArray`, which the engine's check lacks: inside `Automerge.change` a LIST
 * proxy answers `hasOwnProperty` true for the marker (3.5.0, observed; a committed list does
 * not), so the bare check calls every draft array an `ImmutableString`.
 */
export function isImmutableString(v: unknown): v is { val: string } {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.prototype.hasOwnProperty.call(v, IMMUTABLE_STRING)
  );
}

/**
 * A raw doc value as a plain string: the string itself, an `ImmutableString`'s `val`, else
 * `undefined`. THE read for any raw draft or `toJS` value compared against a string (contract
 * (b)): an `ImmutableString` has no `.length`, `===` a string is false and `typeof` is `object`.
 */
export function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  return isImmutableString(v) ? v.val : undefined;
}

/**
 * The worker's ONE definition of "a map": a non-null, non-array object that is not an
 * `ImmutableString` (which is an object too, so every bare `typeof === 'object'` predicate
 * would recurse into it or treat it as a parent).
 */
export function isMapValue(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isImmutableString(v);
}

// ─── Classification: which string fields are structural ──────────────────────

/**
 * Structural string fields with no telling suffix (plan R1). A name is classified ONCE for every
 * collection: a name that means prose somewhere and an enum elsewhere gets a new name, not a
 * second rule. A container name (an array or a dynamic-keyed map of strings) is listed only when
 * its elements/values are structural, never for an object with named fields.
 *
 * Complete against the R2 audit (`scalarFieldsAudit.test.ts`, which fails on every string field
 * in neither set). The policy: ids and foreign keys, timestamps, dates and times of day, enums,
 * keys, hashes and tokens, emails, currency and country codes, and values picked from reference
 * data are scalar; anything a person types as free text is text.
 */
export const SCALAR_FIELDS: ReadonlySet<string> = new Set([
  // identity and dates
  'id',
  'date',
  // `*Date` / `*On` names in `models.ts` (listed, not suffix-inferred: no `Date`/`On` rule)
  'loanStartDate',
  'recurringDueDate',
  'startDate',
  'endDate',
  'lastProcessedDate',
  'purchaseDate',
  'dueDate',
  'hintEventDate',
  'activityDate',
  'lastResetDate',
  'recurrenceEndDate',
  'originalOccurrenceDate',
  'occurrenceDate',
  'sortDate',
  'departureDate',
  'arrivalDate',
  'returnDepartureDate',
  'returnArrivalDate',
  'embarkationDate',
  'disembarkationDate',
  'checkInDate',
  'checkOutDate',
  'pickupDate',
  'returnDate',
  'suggestedDate',
  'startedOn',
  'endedOn',
  'saidOn',
  'reviewedOn',
  'administeredOn',
  'occurredOn',
  'cookedOn',
  // other dates and times of day (`HH:mm` from a time input, the same class as a date)
  'anchor',
  'deadline',
  'exceptionOriginalYmd',
  'exchangeRateLastFetch',
  'startTime',
  'endTime',
  'dueTime',
  'serveTime',
  'time',
  'departureTime',
  'arrivalTime',
  'returnDepartureTime',
  'returnArrivalTime',
  'embarkationTime',
  'leavingTime',
  'pickupTime',
  'returnTime',
  // member ids without an `Id` suffix
  'acknowledgedBy',
  'lastReconciledBy',
  'administeredBy',
  'by',
  'completedBy',
  'connectedBy',
  'cookedBy',
  'createdBy',
  // a link's master link (a UUID)
  'exceptionOf',
  // enums
  'type',
  'category',
  'status',
  'kind',
  'role',
  'priority',
  'currency',
  'frequency',
  'interval',
  'unit',
  'visibility',
  'balanceEffect',
  'provider',
  'theme',
  'locale',
  'color',
  'activityCategory',
  'ageGroup',
  'aiProvider',
  'aiTier',
  'allergyType',
  'avatar', // the beanie avatar variant key
  'cardNetwork',
  'carType',
  'chain',
  'costType',
  'course',
  'feeCustomPeriodUnit',
  'feeSchedule',
  'gender',
  'goalAllocMode',
  'hintType',
  'importSource',
  'language',
  'lifecycle',
  'mealSlots', // array of enum values
  'mime',
  'mode',
  'monthlyAnchor',
  'monthlyDay', // a day number, or the literal 'last'
  'origin',
  'outcome',
  'recoveryKitConfirmedVia',
  'recurrence',
  'severity',
  'slot',
  'splitMode',
  'temperatureUnit',
  'textSize',
  'tripPurpose',
  'tripType',
  // codes: currency, country, time zone, OAuth scopes, airports and airlines (picked from
  // reference data; a rare "Other" typed value is still one value, never edited in place)
  'baseCurrency',
  'displayCurrency',
  'feeCurrency',
  'estimatedCostCurrency',
  'preferredCurrencies', // array of currency codes
  'country', // `Settings.country` is a code; `WeatherPlace.country` a provider-written name
  'countryCode',
  'institutionCountry',
  'lenderCountry',
  'homeTimeZone',
  'grantedScopes', // array of OAuth scope URLs
  'departureAirport',
  'arrivalAirport',
  'returnDepartureAirport',
  'returnArrivalAirport',
  'airline',
  'returnAirline',
  // machine-written identity: the app's version, a sync path
  'appVersion',
  'syncFilePath',
  // keys
  'partKey',
  'templateKey',
  'hintKey',
  'cardPartKey',
  'key', // a responsibility card part's key ('main' | child id | 'label-<uuid>')
  // dynamic-keyed maps of strings (their VALUES classify by the container)
  'dismissedHintKeys',
  'aiApiKeys',
  'notificationReads', // the collection: memberId → (notificationId → ISO readAt)
  // `exchangeRates` identity (`KEY_FIELDS`): only ever currency codes
  'from',
  'to',
  // goal contributions (`docOps` applyGoalContribution entry)
  'at',
  'updatedBy',
  // long per-member identity / hash strings, rewritten on every PIN change
  'email',
  'googleAccountEmail',
  'passwordHash',
  'pinHash',
  'accountEmail',
  // hashes and tokens, machine-written and replaced whole
  'fingerprint',
  'importFingerprint',
  'lastPushedHash',
  'planToken',
  'refreshToken',
]);

/**
 * User prose: the explicit acknowledgement that a string field stays collaborative text.
 * `diagnosedBy` is a free-text doctor's name (the reason there is no `By` suffix rule). Typed
 * codes (account numbers, flight numbers, booking references, phone numbers) count as typed
 * free text, and so do URLs; `emoji`/`icon` are text by policy. A dual-meaning name takes the
 * free-text side: `duration` is an enum on a vacation idea and typed text on a travel segment.
 */
export const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'name',
  'note',
  'notes',
  'description',
  'emoji',
  'diagnosedBy',
  'reaction',
  'label',
  'body',
  'address',
  'subtitle',
  'location',
  'memberName',
  'familyName',
  'instructorName',
  'instructorContact',
  'agencyName',
  'agencyAddress',
  'steps',
  'ingredients',
  'wentWell',
  'toImprove',
  'say',
  'words',
  'dose',
  'guestNames',
  'avoidList',
  'emergencyResponse',
  'customCategory',
  'partLabel',
  'carLabel',
  'statementDescription',
  // typed names and places
  'aliases', // array of typed names
  'customInstitutions', // array of typed institution names
  'tags', // array of typed recipe tags
  'institution',
  'lender',
  'admin1', // a weather place's region name, provider-written
  'place',
  'context',
  'cruiseLine',
  'shipName',
  'departurePort',
  'operator',
  'route',
  'terminal',
  'departureStation',
  'arrivalStation',
  'roomType',
  'siteName',
  'fileName',
  'doneOverride',
  'lastError',
  'icon',
  // typed free-form quantities
  'duration',
  'cookTime',
  'prepTime',
  'servings',
  // typed codes and numbers
  'accountNumber',
  'cardExpiry',
  'cardLast4',
  'iban',
  'routingNumber',
  'swiftBic',
  'flightNumber',
  'returnFlightNumber',
  'bookingReference',
  'returnBookingReference',
  'confirmationNumber',
  'cabinNumber',
  'phone',
  'contactPhone',
  // URLs, pasted or fetched
  'link',
  'sourceUrl',
  'onlineBankingUrl',
  'image',
]);

/** The only suffixes that are structural without exception in `models.ts`. */
const SCALAR_SUFFIXES = ['Id', 'Ids', 'At'] as const;

/** Is `name` a structural (scalar) field: an `Id`/`Ids`/`At` suffix, or in `SCALAR_FIELDS`? */
export function isScalarField(name: string): boolean {
  return SCALAR_FIELDS.has(name) || SCALAR_SUFFIXES.some((s) => name.endsWith(s));
}

export type FieldClass = 'scalar' | 'text' | 'unclassified';

function classOf(name: string): FieldClass {
  if (isScalarField(name)) return 'scalar';
  return TEXT_FIELDS.has(name) ? 'text' : 'unclassified';
}

/**
 * THE classification of one string leaf, shared by `asStrForm`, the R2 audit and `docValue`,
 * so the three cannot drift. Own key, else container:
 *  - a string under a named key classifies by that key when the key is classified;
 *  - otherwise (a direct ELEMENT of an array, which has no key of its own, or a direct value of
 *    a dynamic-keyed map such as `dismissedHintKeys.<hintKey>` / `aiApiKeys.openai`) it
 *    classifies by `container`, the array/map's own field name;
 *  - nothing further up the path is consulted.
 * `key` is the map key (`undefined` or an index for an array element); `container` is the name
 * of the array/map holding the value, or `undefined` at a root.
 */
export function classify(key: string | number | undefined, container?: string): FieldClass {
  const own = typeof key === 'string' ? classOf(key) : 'unclassified';
  if (own !== 'unclassified' || container === undefined) return own;
  return classOf(container);
}

// ─── Writing: one copy-and-wrap for every doc write ──────────────────────────

/**
 * In place over a fresh JSON copy: replace every string that `classify` calls scalar with
 * `mintFn(s)`. `name` is the field the node sits under (an array element and an object inside
 * an array both sit under the array's name), so the walk applies exactly the
 * own-key-else-container rule `asStrForm` and the audit apply.
 */
function mintIn(node: unknown, name: string | undefined, mintFn: ScalarMint): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v: unknown = node[i];
      if (typeof v === 'string') {
        if (classify(i, name) === 'scalar') node[i] = mintFn(v);
      } else {
        mintIn(v, name, mintFn);
      }
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const map = node as Record<string, unknown>;
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (typeof v === 'string') {
      if (classify(key, name) === 'scalar') map[key] = mintFn(v);
    } else {
      mintIn(v, key, mintFn);
    }
  }
}

/**
 * THE value every worker doc write assigns (#124 R4): a plain JSON copy of `value` (JSON, not
 * `structuredClone`: an Automerge proxy cannot be cloned; `undefined` passes through), then,
 * ONLY when a mint is installed, every scalar-classified string in that copy minted as an
 * `ImmutableString`. With no mint it is exactly the JSON copy `reconcile.ts` always made.
 *
 * `field` is the name the value is written under: the map key for a key write, the array's
 * field name for an element (an index works too, with `container` = the array's name), the
 * COLLECTION name for a whole entity (never a field name, so only the entity's own keys
 * classify; the audit pins every collection name but `notificationReads` as unclassified).
 * `container` is the name of the map/array holding the value: it decides a string whose own
 * key is unclassified (a dynamic map key such as `dismissedHintKeys.<hintKey>`).
 *
 * Cannot throw on a value that already passed the proxy: a JSON copy, then a pure walk.
 */
export function docValue<T>(field: string | number, value: T, container?: string): T {
  if (value === undefined) return value;
  const copied = JSON.parse(JSON.stringify(value)) as T;
  if (mint === null) return copied;
  if (typeof copied === 'string') {
    return (classify(field, container) === 'scalar' ? mint(copied) : copied) as T;
  }
  mintIn(copied, typeof field === 'string' ? field : container, mint);
  return copied;
}

/** The one `updatedAt` stamp: `entity.updatedAt = docValue('updatedAt', iso)`. */
export function stampUpdatedAt(entity: { updatedAt?: unknown }, iso: string): void {
  entity.updatedAt = docValue('updatedAt', iso);
}
