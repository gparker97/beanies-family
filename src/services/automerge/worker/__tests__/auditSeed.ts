/**
 * The ONE seed and walker behind the two schema audits (`keylessArrayAudit.test.ts`, #117, and
 * `scalarFieldsAudit.test.ts`, #124 R2). Both audits are only as good as this data, so it lives
 * in one place: a field one audit sees, the other sees too.
 *
 * COVERAGE. `materializeFixture` (the review-demo fixture, the richest seed) plus a hand-written
 * SUPPLEMENT for every collection and shape the fixture does not seed, plus a representative
 * `settings` singleton. Every collection in `COLLECTION_NAMES` must have data (the keyless audit
 * pins it). Extend the SUPPLEMENT when adding a collection or a field the fixture lacks.
 */
import { materializeFixture } from '@/services/demo/demoFixture';
import { COLLECTION_NAMES } from '@/types/automerge';
import { isMapValue } from '../scalarStrings';

export type Json = unknown;

/** The worker's one map predicate (`scalarStrings.isMapValue`), re-exported under the audit's name. */
export const isMap = (v: Json): v is Record<string, Json> => isMapValue(v);

/** Shapes the fixture does not seed (see COVERAGE above). */
const T = '2026-10-01T08:00:00.000Z';
const D = '2026-10-01';

const SUPPLEMENT: Record<string, Json[]> = {
  // ─── Fields the fixture's own entities leave out ───────────────────────────
  familyMembers: [
    {
      id: 'member-supp',
      aliases: ['Grandpa Joe'],
      appVersion: '1.0.2',
      avatar: 'beanie-blue',
      avatarPhotoId: 'photo-1',
      googleAccountEmail: 'joe@example.com',
      lastLoginAt: T,
      passwordHash: 'salt:hash',
      pinHash: 'salt:hash',
      podTooLargeSeenAt: T,
    },
  ],
  accounts: [
    {
      id: 'acct-supp',
      accountNumber: '12345678',
      cardExpiry: '12/29',
      cardLast4: '4242',
      cardNetwork: 'visa',
      iban: 'GB00TEST00000000000000',
      institutionCountry: 'GB',
      linkedAssetId: 'asset-1',
      linkedRecurringItemId: 'rec-1',
      loanStartDate: D,
      notes: 'Joint account',
      onlineBankingUrl: 'https://bank.example',
      onlineBankingUserId: 'joe123',
      payFromAccountId: 'acct-2',
      routingNumber: '021000021',
      swiftBic: 'TESTGB2L',
      wallets: [{ id: 'wallet-1', address: '0xabc', chain: 'ethereum', label: 'Cold' }],
    },
  ],
  activities: [
    {
      id: 'act-fields',
      assigneeId: 'm1',
      color: '#F15D22',
      description: 'Saturday swim',
      feeCurrency: 'USD',
      feeCustomPeriodUnit: 'weeks',
      feePayerId: 'm1',
      instructorContact: 'coach@example.com',
      instructorName: 'Coach Sam',
      link: 'https://swim.example',
      linkedRecurringItemId: 'rec-1',
      notes: 'Bring goggles',
      originalOccurrenceDate: D,
      parentActivityId: 'act-1',
      payFromAccountId: 'acct-1',
      photoIds: ['photo-1'],
      recurrenceEndDate: D,
    },
    {
      id: 'act-supp',
      dropoffCompletions: [
        { date: '2026-10-01', completedBy: 'm1', completedAt: '2026-10-01T08:00:00Z' },
      ],
      pickupCompletions: [
        { date: '2026-10-01', completedBy: 'm1', completedAt: '2026-10-01T15:00:00Z' },
      ],
    },
  ],
  assets: [
    {
      id: 'asset-supp',
      notes: 'Bought used',
      loan: {
        lender: 'Example Bank',
        lenderCountry: 'GB',
        linkedRecurringItemId: 'rec-1',
        loanStartDate: D,
        payFromAccountId: 'acct-1',
      },
    },
  ],
  budgets: [{ id: 'budget-supp', memberId: 'm1' }],
  goals: [
    {
      id: 'goal-supp',
      notes: 'For the trip',
      manualContributions: [
        { id: 'contrib-1', amount: 10, at: T, updatedBy: 'm1', note: 'Birthday money' },
      ],
    },
  ],
  lists: [
    {
      id: 'list-supp',
      activityDate: D,
      cadence: { unit: 'month', interval: 1, monthlyAnchor: 'date', monthlyDay: 'last' },
      completedAt: T,
      completedBy: 'm1',
      dueDate: D,
      items: [{ id: 'item-1', title: 'Milk', completed: true, completedBy: 'm1', completedAt: T }],
      lastResetDate: D,
      linkedActivityId: 'act-1',
      linkedRecipeId: 'recipe-1',
      linkedVacationId: 'vac-1',
      templateKey: 'groceries',
    },
  ],
  medications: [{ id: 'med-supp', endDate: D }],
  recurringItems: [
    { id: 'rec-supp', activityId: 'act-1', endDate: D, lastProcessedDate: D, loanId: 'asset-1' },
  ],
  sayings: [{ id: 'saying-supp', aboutMemberId: 'm1' }],
  todos: [
    {
      id: 'todo-fields',
      activityDate: D,
      activityId: 'act-1',
      assigneeId: 'm1',
      cardId: 'card-1',
      cardPartKey: 'main',
      dueTime: '17:30',
      hintEventDate: D,
      hintKey: 'birthday-gift',
      hintType: 'birthday',
    },
    {
      id: 'todo-supp',
      repeat: {
        rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
        anchor: '2026-09-30',
      },
      repeatLog: [
        { date: '2026-09-30', outcome: 'done', by: 'm1', at: '2026-09-30T20:05:00.000Z' },
        { date: '2026-10-07', outcome: 'skipped', by: 'm1', at: '2026-10-07T19:00:00.000Z' },
      ],
    },
  ],
  transactions: [
    {
      id: 'tx-supp',
      activityId: 'act-1',
      adjustment: { updatedBy: 'm1' },
      balanceEffect: 'counter',
      goalAllocMode: 'percentage',
      goalId: 'goal-1',
      importFingerprint: 'fp-1',
      importId: 'import-1',
      importPeriod: { from: D, to: D },
      importSource: 'csv',
      loanId: 'asset-1',
      recurringDueDate: D,
      recurringItemId: 'rec-1',
      statementDescription: 'TESCO STORES 123',
      toAccountId: 'acct-2',
    },
  ],
  vacations: [
    {
      id: 'vac-supp',
      travelSegments: [
        {
          id: 'seg-flight',
          returnAirline: 'SQ',
          returnArrivalAirport: 'SIN',
          returnArrivalDate: D,
          returnArrivalTime: '06:10',
          returnBookingReference: 'ABC123',
          returnDepartureAirport: 'LHR',
          returnDepartureDate: D,
          returnDepartureTime: '22:00',
          returnFlightNumber: 'SQ321',
          sortDate: D,
          terminal: 'Terminal 2',
          travellerIds: ['m1'],
          photoIds: ['photo-1'],
          link: 'https://airline.example',
        },
        {
          id: 'seg-cruise',
          cabinNumber: 'A12',
          cruiseLine: 'Example Cruises',
          departurePort: 'Southampton',
          disembarkationDate: D,
          embarkationDate: D,
          embarkationTime: '14:00',
          shipName: 'Example Star',
        },
        {
          id: 'seg-train',
          operator: 'Eurostar',
          route: 'London to Paris',
          departureStation: 'St Pancras',
          arrivalStation: 'Gare du Nord',
        },
        { id: 'seg-car', carType: 'rental_car', carLabel: 'The blue one', leavingTime: '07:00' },
        {
          id: 'seg-activity',
          activityCategory: 'sightseeing',
          duration: '2 hours',
          location: 'Old town',
          startTime: '10:00',
        },
      ],
      accommodations: [
        {
          id: 'acc-supp',
          contactPhone: '+44 20 0000 0000',
          link: 'https://hotel.example',
          photoIds: ['photo-1'],
          travellerIds: ['m1'],
        },
      ],
      transportation: [
        {
          id: 'transport-supp',
          agencyAddress: '1 High St',
          agencyName: 'Example Cars',
          arrivalStation: 'Central',
          bookingReference: 'CAR42',
          departureDate: D,
          departureStation: 'Airport',
          departureTime: '09:00',
          link: 'https://cars.example',
          operator: 'Example Cars',
          photoIds: ['photo-1'],
          pickupDate: D,
          pickupTime: '09:30',
          returnDate: D,
          returnTime: '18:00',
          route: 'Airport to hotel',
          travellerIds: ['m1'],
        },
      ],
      ideas: [
        {
          id: 'idea-supp',
          duration: 'half_day',
          linkPreview: { image: 'https://img.example/a.png', siteName: 'Example' },
          location: 'Harbour',
          suggestedDate: D,
          votes: [{ memberId: 'm1', votedAt: T }],
        },
      ],
    },
  ],
  listCycles: [
    {
      id: 'cycle-1',
      listId: 'list-1',
      ownerId: 'm1',
      emoji: '🛒',
      startedOn: D,
      endedOn: D,
      items: [
        { title: 'Milk', done: true, by: 'm1' },
        { title: 'Eggs', done: false },
      ],
    },
  ],
  responsibilityCards: [
    {
      id: 'card-1',
      splitMode: 'label',
      doneOverride: 'Bins out by 8pm',
      custom: { name: 'Bins', emoji: '🗑️', category: 'home' },
      parts: [
        { key: 'main', holderId: 'm1' },
        { key: 'a', label: 'upstairs' },
      ],
      reminders: {
        main: {
          say: 'Take the trash out',
          cadence: { unit: 'month', interval: 1, monthlyAnchor: 'weekday' },
          time: '19:00',
          anchor: D,
        },
      },
    },
  ],

  // ─── Collections the fixture does not seed at all ──────────────────────────
  photos: [
    {
      id: 'photo-1',
      deletedAt: T,
      driveFileId: 'drive-file-1',
      fileName: 'ticket.pdf',
      mime: 'application/pdf',
      retiredDriveFileIds: ['drive-file-0'],
      createdAt: T,
      updatedAt: T,
    },
  ],
  favorites: [{ id: 'fav-1', recipeId: 'recipe-1', createdAt: T, updatedAt: T }],
  memberNotes: [{ id: 'note-1', memberId: 'm1', body: 'Loves dinosaurs', createdAt: T }],
  allergies: [
    {
      id: 'allergy-1',
      memberId: 'm1',
      allergyType: 'food',
      avoidList: 'peanuts, cashews',
      diagnosedBy: 'Dr Lee',
      emergencyResponse: 'EpiPen in the blue bag',
      reaction: 'hives',
      reviewedOn: D,
      severity: 'severe',
    },
  ],
  medicationLogs: [
    {
      id: 'medlog-1',
      administeredBy: 'm1',
      administeredOn: D,
      medicationId: 'med-1',
      dose: '5ml',
    },
  ],
  recipes: [
    {
      id: 'recipe-1',
      cookTime: '30 min',
      course: 'main',
      ingredients: ['2 eggs', '100g flour'],
      mealSlots: ['dinner'],
      prepTime: '10 min',
      servings: '4',
      sourceUrl: 'https://recipes.example/pancakes',
      steps: ['Mix', 'Fry'],
      subtitle: 'Sunday classic',
      tags: ['quick'],
    },
  ],
  cookLogs: [
    {
      id: 'cooklog-1',
      cookedBy: 'm1',
      cookedOn: D,
      recipeId: 'recipe-1',
      servings: '4',
      toImprove: 'Less salt',
      wentWell: 'Crispy edges',
    },
  ],
  mealPlans: [
    {
      id: 'meal-1',
      cookLogId: 'cooklog-1',
      cookMemberId: 'm1',
      eaterMemberIds: ['m1'],
      guestNames: ['Auntie May'],
      kind: 'recipe',
      label: 'Leftovers',
      note: 'Double batch',
      recipeId: 'recipe-1',
      serveTime: '18:30',
      slot: 'dinner',
    },
  ],
  emergencyContacts: [
    {
      id: 'contact-1',
      address: '2 Elm St',
      customCategory: 'Neighbour',
      email: 'may@example.com',
      phone: '+1 555 0100',
      role: 'other',
    },
  ],
  // An entity here is a dynamic map: memberId → (notificationId → ISO readAt).
  notificationReads: [{ 'todo-due:todo-1': T, 'list-reset:list-1': T }],
  calendarConnections: [
    {
      id: 'cal-1',
      accountEmail: 'joe@example.com',
      connectedBy: 'm1',
      destinationCalendarId: 'primary',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events'],
      lastError: 'Token expired',
      lastReconciledAt: T,
      lastReconciledBy: 'm1',
      lastSyncedAt: T,
      provider: 'google',
      refreshToken: 'wrapped-token',
      status: 'active',
    },
  ],
  calendarEventLinks: [
    {
      id: 'link-1',
      connectionId: 'cal-1',
      exceptionOf: 'link-0',
      exceptionOriginalYmd: D,
      googleEventId: 'evt_1',
      lastPushedAt: T,
      lastPushedHash: 'h1',
      origin: 'adopted',
    },
  ],
  driveConnections: [
    {
      id: 'drive-1',
      accountEmail: 'joe@example.com',
      provider: 'google',
      refreshToken: 'wrapped-token',
    },
  ],
  overlapAcknowledgments: [
    {
      id: 'ack-1',
      acknowledgedAt: T,
      acknowledgedBy: 'm1',
      connectionId: 'cal-1',
      fingerprint: '1000-2000',
      occurrenceDate: D,
    },
  ],
  removedMembers: [{ id: 'm9', removedAt: T, removedByMemberId: 'm1', createdAt: T, updatedAt: T }],
  responsibilityMoves: [
    {
      id: 'move-1',
      at: T,
      byId: 'm1',
      cardId: 'card-1',
      fromId: 'm1',
      partKey: 'main',
      partLabel: 'upstairs',
      toId: 'm2',
    },
  ],
  responsibilityCheckIns: [
    { id: 'checkin-1', byId: 'm1', kind: 'weekly', savedIds: ['card-1'], talkedIds: ['card-1'] },
  ],
};

/** A representative settings singleton: the fixture seeds none. */
const SETTINGS_SAMPLE = {
  id: 'app_settings',
  baseCurrency: 'USD',
  displayCurrency: 'USD',
  exchangeRates: [
    { from: 'USD', to: 'EUR', rate: 0.9, updatedAt: '2026-10-01T00:00:00.000Z' },
    { from: 'USD', to: 'GBP', rate: 0.8, updatedAt: '2026-10-01T00:00:00.000Z' },
  ],
  aiApiKeys: { claude: 'sk-ant-test', openai: 'sk-test', gemini: 'g-test' },
  dismissedHintKeys: { 'birthday-gift': T },
  preferredCurrencies: ['USD'],
  customInstitutions: ['Example Bank'],
  activityReminderBackfilledAt: T,
  aiIngredientsConsentAcknowledgedAt: T,
  aiStatementConsentAcknowledgedAt: T,
  aiProvider: 'claude',
  aiTier: 'standard',
  country: 'US',
  exchangeRateLastFetch: T,
  feedbackLastPromptedAt: T,
  homeTimeZone: 'America/Los_Angeles',
  language: 'en',
  planToken: 'plan-token',
  recoveryKitConfirmedAt: T,
  recoveryKitConfirmedVia: 'saved',
  syncFilePath: 'beanies/family.beanpod',
  temperatureUnit: 'celsius',
  textSize: 'normal',
  theme: 'system',
  weatherPlace: {
    id: 1,
    name: 'Springfield',
    admin1: 'Illinois',
    country: 'United States',
    countryCode: 'US',
    lat: 39.8,
    lon: -89.64,
  },
};

/** Fixture + SUPPLEMENT + settings, as plain JSON (what a materialised Automerge doc looks like). */
export function seedData(): Record<string, Json> {
  const fixture = materializeFixture({
    today: new Date('2026-08-20T09:00:00Z'),
    ownerMemberId: 'owner-member-id',
  });
  const merged: Record<string, Json> = { ...fixture, settings: SETTINGS_SAMPLE };
  for (const [name, extra] of Object.entries(SUPPLEMENT)) {
    merged[name] = [...((merged[name] as Json[] | undefined) ?? []), ...extra];
  }
  return JSON.parse(JSON.stringify(merged));
}

/**
 * One node of the walk. `field` is the name the node sits under: its own key, or for an array
 * element the array's name (the granularity `KEY_FIELDS` uses). `key` is the own key (an index
 * for an element); `container` is the name of the map/array holding the node: the collection
 * for an entity's own keys, `'settings'` for the singleton's. Exactly the arguments
 * `classify(key, container)` and `docValue(field, value, container)` take.
 */
export interface SeedNode {
  value: Json;
  /** `collection.a.b[]` (no entity id), for messages. */
  label: string;
  /** `collection.<entityId>.a.b[]`. */
  path: string;
  field: string;
  key: string | number | undefined;
  container: string | undefined;
}

function walk(value: Json, at: Omit<SeedNode, 'value'>, visit: (node: SeedNode) => void): void {
  visit({ value, ...at });
  if (Array.isArray(value)) {
    value.forEach((el, i) =>
      walk(
        el,
        {
          label: `${at.label}[]`,
          path: `${at.path}[]`,
          field: at.field,
          key: i,
          container: at.field,
        },
        visit
      )
    );
    return;
  }
  if (!isMap(value)) return;
  for (const [k, v] of Object.entries(value)) {
    walk(
      v,
      { label: `${at.label}.${k}`, path: `${at.path}.${k}`, field: k, key: k, container: at.field },
      visit
    );
  }
}

/**
 * Visit every node of every seeded collection's entities, plus `settings`. `walked` collects
 * the collections that had data. The non-collection roots (`podLineage`, `counterDeltas`,
 * `foldedCounters`) are never walked: they are not in `COLLECTION_NAMES`.
 */
export function walkSeed(visit: (node: SeedNode) => void, walked?: Set<string>): void {
  const data = seedData();
  for (const name of [...COLLECTION_NAMES, 'settings']) {
    const col = data[name];
    if (name === 'settings') {
      const at = { label: name, path: name, field: name, key: undefined, container: undefined };
      walk(col, at, visit);
      continue;
    }
    if (!Array.isArray(col)) continue; // fixture shape: arrays of entities
    walked?.add(name);
    for (const entity of col) {
      const id = isMap(entity) && typeof entity.id === 'string' ? entity.id : '?';
      walk(
        entity,
        { label: name, path: `${name}.${id}`, field: name, key: undefined, container: undefined },
        visit
      );
    }
  }
}
