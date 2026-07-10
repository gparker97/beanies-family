/**
 * Synthetic family used for the store promo recording and the listing screenshots.
 *
 * Wholly fictional. Nothing here touches Google Drive, the registry, or a real
 * `.beanpod` — it is written straight into the in-memory Automerge doc via
 * `window.__e2eDataBridge.seedData()` (DEV-only). The bridge seeds every
 * collection in `COLLECTION_NAMES`, so anything in the document is seedable.
 *
 * Dates are computed relative to "today" so the nook, planner and the in-progress
 * trip always look lived-in on the day the assets are generated.
 */
import { TestDataFactory } from '../../e2e/fixtures/data';
import type { ExportedData } from '../../e2e/helpers/indexeddb';
import type {
  TodoItem,
  PhotoAttachment,
  FavoriteItem,
  SayingItem,
  Recipe,
  Medication,
  Allergy,
  Milestone,
  FamilyVacation,
  FamilyActivity,
} from '../../src/types/models';

const iso = (d: Date) => d.toISOString().split('T')[0]!;
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Photos are NOT stored in the app. `PhotoAttachment` holds only a Google Drive
 * file id, and the UI renders `https://lh3.googleusercontent.com/d/<id>=w<px>`
 * (`photoStore.getPublicUrl`) — there is no base64 or blob path, so a seeded
 * photo with a made-up id would render as a broken tile.
 *
 * These ids are therefore sentinels. The capture harness intercepts the Drive CDN
 * and serves the mapped file from `public/brand/`, so the app is unmodified and
 * unaware. Keys are the `driveFileId`; values are paths under `public/`.
 */
export const DEMO_PHOTO_FILES: Record<string, string> = {
  'demo-photo-hugging': 'brand/beanies_family_hugging_transparent_1600x1600.png',
  'demo-photo-celebrating': 'brand/beanies_celebrating_circle_transparent_300x300.png',
  'demo-photo-father': 'brand/beanies_father_icon_transparent_360x360.png',
  'demo-photo-mother': 'brand/beanies_mother_icon_transparent_350x350.png',
  'demo-photo-boy': 'brand/beanies_baby_boy_icon_transparent_300x300.png',
  'demo-photo-beanstalk': 'brand/beanies-beanstalk-mascot.webp',
};

/**
 * @param ownerId id of the owner the create-a-family flow already made. We
 * overwrite that record rather than adding a fourth member, otherwise the
 * harness's placeholder ("John Doe") shows up in the bean pod on camera.
 */
export function buildDemoFamily(ownerId: string): Partial<ExportedData> {
  const now = new Date().toISOString();
  const today = iso(shift(0));
  const uid = (prefix: string, n: number | string) => `${prefix}-${n}`;

  // ── Photos ────────────────────────────────────────────────────────────────
  const photo = (key: string, w: number, h: number): PhotoAttachment => ({
    id: uid('photo', key),
    driveFileId: key,
    mime: 'image/png',
    width: w,
    height: h,
    sizeBytes: 120_000,
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  });
  const photos: PhotoAttachment[] = [
    photo('demo-photo-hugging', 1600, 1600),
    photo('demo-photo-celebrating', 300, 300),
    photo('demo-photo-father', 360, 360),
    photo('demo-photo-mother', 350, 350),
    photo('demo-photo-boy', 300, 300),
    photo('demo-photo-beanstalk', 512, 512),
  ];

  // ── Beans ─────────────────────────────────────────────────────────────────
  // Every bean has already joined. BeanCard shows an amber "waiting to join" badge
  // whenever `member.requiresPassword` is truthy — and that field is DERIVED on read
  // (`familyMemberRepository`: `requiresPassword: !member.passwordHash`), so seeding
  // `requiresPassword: false` is silently overwritten. Give them a passwordHash
  // instead. Nothing authenticates against it: the harness signs in via the
  // `e2e_auto_auth` bypass against an in-memory provider.
  const joined = { passwordHash: 'demo-seed-not-a-real-hash', requiresPassword: false };

  const john = TestDataFactory.createFamilyMember({
    id: ownerId,
    name: 'John Bean',
    email: 'john@thebeanfamily.example',
    role: 'owner',
    color: '#2C3E50',
    avatarPhotoId: uid('photo', 'demo-photo-father'),
    ...joined,
  });
  const mary = TestDataFactory.createFamilyMember({
    name: 'Mary Bean',
    email: 'mary@thebeanfamily.example',
    role: 'admin',
    color: '#E67E22',
    avatarPhotoId: uid('photo', 'demo-photo-mother'),
    ...joined,
  });
  const neily = TestDataFactory.createFamilyMember({
    name: 'Neily Bean',
    email: 'neily@thebeanfamily.example',
    role: 'member',
    color: '#F15D22',
    avatarPhotoId: uid('photo', 'demo-photo-boy'),
    ...joined,
  });

  // ── Money ─────────────────────────────────────────────────────────────────
  // Accounts are created FOUR MONTHS ago on purpose. `netWorthHistory` treats an
  // account's opening balance as a change on its `createdAt` date and reconstructs
  // history by walking backwards from today, so an account created "today" makes net
  // worth ~0 at the start of every chart window — a flat line and no percent change.
  // Backdating gives the family a real baseline and a believable curve.
  //
  // (The card no longer renders a nonsense percentage in that case — see Notion #48,
  // fixed by `computePeriodChange` — but a flat line still makes for poor footage.)
  const opened = iso(shift(-120));
  const checking = TestDataFactory.createAccount(john.id, {
    name: 'Everyday',
    type: 'checking',
    balance: 24_820,
    institution: 'Bean Bank',
    createdAt: opened,
  });
  const savings = TestDataFactory.createAccount(mary.id, {
    name: 'Rainy Day',
    type: 'savings',
    balance: 92_400,
    institution: 'Bean Bank',
    createdAt: opened,
  });

  // Net worth = accounts + assets (`accountsStore.filteredCombinedNetWorth`).
  // Assets are gated on `includeInNetWorth` only — there is no `isActive` on them.
  // 117,220 + 1,290,000 ≈ SGD 1.41M, which reads as a real family, not a hedge fund.
  const assets = [
    TestDataFactory.createAsset(john.id, {
      type: 'real_estate',
      name: 'The Bean House',
      purchaseValue: 980_000,
      currentValue: 1_180_000,
      currency: 'SGD',
      createdAt: opened,
    }),
    TestDataFactory.createAsset(mary.id, {
      type: 'vehicle',
      name: 'Family Car',
      purchaseValue: 96_000,
      currentValue: 62_000,
      currency: 'SGD',
      createdAt: opened,
    }),
    TestDataFactory.createAsset(john.id, {
      type: 'investment',
      name: 'Index Funds',
      purchaseValue: 34_000,
      currentValue: 48_000,
      currency: 'SGD',
      createdAt: opened,
    }),
  ];

  // Two salaries inside the 1M window keep the chart trending gently UP; the
  // day-to-day expenses give the line some texture.
  const transactions = [
    { d: 0, desc: 'Grocery run', amount: 84.2, category: 'groceries', type: 'expense' as const },
    {
      d: -1,
      desc: 'Swimming lessons',
      amount: 60,
      category: 'education',
      type: 'expense' as const,
    },
    { d: -2, desc: 'Coffee', amount: 5.4, category: 'dining', type: 'expense' as const },
    { d: -3, desc: 'Electricity', amount: 132.5, category: 'utilities', type: 'expense' as const },
    {
      d: -4,
      desc: 'Farmers market',
      amount: 46.8,
      category: 'groceries',
      type: 'expense' as const,
    },
    { d: -12, desc: 'Salary', amount: 8_200, category: 'salary', type: 'income' as const },
    { d: -26, desc: 'Salary', amount: 8_200, category: 'salary', type: 'income' as const },
  ].map((t) =>
    TestDataFactory.createTransaction(checking.id, {
      description: t.desc,
      amount: t.amount,
      category: t.category,
      date: iso(shift(t.d)),
      type: t.type,
    })
  );

  // ── Activities ────────────────────────────────────────────────────────────
  // EVERY activity must pin `recurrence: 'none'` + `daysOfWeek: undefined`.
  // `TestDataFactory.createActivity` defaults to `recurrence: 'weekly'` with
  // `daysOfWeek: [today's weekday]`, so an activity that omits them silently
  // becomes a weekly event on today's weekday and never renders on its own date
  // (Piano lesson was invisible in the planner for exactly this reason).
  const oneOff = { recurrence: 'none' as const, daysOfWeek: undefined };

  // The daily-briefing card only draws a row for the CURRENT member (the owner,
  // John). A pickup/dropoff duty assigned to him produces a 🚗 row; an activity
  // today assigned to someone else produces nothing. See `useCriticalItems`.
  const activities: FamilyActivity[] = [
    TestDataFactory.createActivity(john.id, {
      title: 'Wolf camp',
      icon: '🏕️',
      date: today,
      startTime: '08:45',
      endTime: '14:45',
      ...oneOff,
      category: 'sports',
      assigneeIds: [neily.id],
      dropoffMemberId: john.id,
      pickupMemberId: john.id,
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Piano lesson',
      icon: '🎹',
      date: today,
      startTime: '16:00',
      endTime: '17:00',
      ...oneOff,
      category: 'piano',
      assigneeIds: [mary.id],
      pickupMemberId: john.id,
    }),
    TestDataFactory.createActivity(john.id, {
      title: 'Family dinner',
      icon: '🍝',
      date: iso(shift(2)),
      startTime: '18:30',
      endTime: '20:00',
      ...oneOff,
      category: 'other',
    }),
    // A lived-in fortnight. With only three activities the planner reads as a wall
    // of "nothing planned", which is a poor listing shot and poor footage.
    TestDataFactory.createActivity(neily.id, {
      title: 'Swimming lesson',
      icon: '🏊',
      date: iso(shift(3)),
      startTime: '09:30',
      endTime: '10:30',
      ...oneOff,
      category: 'sports',
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Dentist',
      icon: '🦷',
      date: iso(shift(4)),
      startTime: '11:00',
      endTime: '11:45',
      ...oneOff,
      category: 'medical',
    }),
    TestDataFactory.createActivity(john.id, {
      title: 'Football practice',
      icon: '⚽',
      date: iso(shift(5)),
      startTime: '17:00',
      endTime: '18:30',
      ...oneOff,
      category: 'sports',
    }),
    TestDataFactory.createActivity(neily.id, {
      title: 'Movie night',
      icon: '🍿',
      date: iso(shift(6)),
      startTime: '19:00',
      endTime: '21:00',
      ...oneOff,
      category: 'other',
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Grandma visits',
      icon: '👵',
      date: iso(shift(8)),
      startTime: '14:00',
      endTime: '17:00',
      ...oneOff,
      category: 'other',
    }),
  ];

  // ── Travel ────────────────────────────────────────────────────────────────
  // The trip is UPCOMING (starts in three days), not in progress.
  //
  // An in-progress trip would be the better story, but `TravelPlansPage` renders
  // its status chip from `vacationCountdown(v) <= 0` and never consults
  // `tripPhase`, so ANY trip that has already started is labelled "✓ completed"
  // mid-trip. Only `NookVacationCard` knows about the ongoing phase. Filed as a
  // bug; until it is fixed, an upcoming trip is the honest, and better-looking,
  // screenshot: it shows the countdown chip and the booking progress.
  //
  // A vacation is always paired with an all-day FamilyActivity (the store's
  // `createVacation` does this), and the calendar reads the trip through that
  // link. A dangling `activityId` still renders the travel page but leaves the
  // trip invisible on the planner, so seed both.
  const tripActivity = TestDataFactory.createActivity(john.id, {
    id: 'activity-trip-japan',
    title: 'Japan family trip',
    icon: '✈️',
    date: iso(shift(3)),
    ...oneOff,
    category: 'other',
    vacationId: 'vacation-japan',
  });
  activities.push(tripActivity);

  const beachActivity = TestDataFactory.createActivity(mary.id, {
    id: 'activity-trip-beach',
    title: 'Beach week',
    icon: '🏖️',
    date: iso(shift(64)),
    ...oneOff,
    category: 'other',
    vacationId: 'vacation-beach',
  });
  activities.push(beachActivity);

  const vacations: FamilyVacation[] = [
    {
      id: 'vacation-japan',
      activityId: tripActivity.id,
      name: 'Japan family trip',
      tripType: 'fly_and_stay',
      tripPurpose: 'vacation',
      assigneeIds: [john.id, mary.id, neily.id],
      // `bookingProgress` returns 100% when there are no segments at all, so an
      // empty trip renders as "fully booked" — seed a mix instead.
      travelSegments: [
        {
          id: 'seg-out',
          type: 'flight_outbound',
          title: 'SIN → HND',
          status: 'booked',
          airline: 'Bean Air',
          flightNumber: 'BA 812',
          departureAirport: 'SIN',
          arrivalAirport: 'HND',
          departureDate: iso(shift(3)),
          departureTime: '09:15',
          arrivalDate: iso(shift(3)),
          arrivalTime: '17:05',
        },
        {
          id: 'seg-ret',
          type: 'flight_return',
          title: 'HND → SIN',
          status: 'pending',
          airline: 'Bean Air',
          flightNumber: 'BA 813',
          departureAirport: 'HND',
          arrivalAirport: 'SIN',
          departureDate: iso(shift(10)),
          departureTime: '11:40',
          arrivalDate: iso(shift(10)),
          arrivalTime: '18:20',
        },
      ],
      accommodations: [
        {
          id: 'acc-tokyo',
          type: 'hotel',
          title: 'Tokyo Bean Hotel',
          status: 'booked',
          name: 'Tokyo Bean Hotel',
          checkInDate: iso(shift(3)),
          checkOutDate: iso(shift(10)),
          breakfastIncluded: true,
        },
      ],
      transportation: [],
      ideas: [
        {
          id: 'idea-ramen',
          title: 'Ramen at the little place by the station',
          votes: [{ memberId: neily.id, createdAt: now }],
          createdBy: neily.id,
          createdAt: now,
        },
        {
          id: 'idea-disney',
          title: 'Tokyo Disneyland',
          votes: [
            { memberId: neily.id, createdAt: now },
            { memberId: mary.id, createdAt: now },
          ],
          createdBy: mary.id,
          createdAt: now,
        },
      ],
      startDate: iso(shift(3)),
      endDate: iso(shift(10)),
      createdBy: john.id,
      createdAt: now,
      updatedAt: now,
    },
    // A second, further-out trip. One card alone leaves the desktop travel page
    // mostly empty space.
    {
      id: 'vacation-beach',
      activityId: beachActivity.id,
      name: 'Beach week',
      tripType: 'road_trip',
      tripPurpose: 'vacation',
      assigneeIds: [john.id, mary.id, neily.id],
      travelSegments: [
        {
          id: 'seg-drive',
          type: 'car',
          title: 'Drive down the coast',
          status: 'pending',
          departureDate: iso(shift(64)),
        },
      ],
      accommodations: [
        {
          id: 'acc-beach',
          type: 'hotel',
          title: 'The little beach hut',
          status: 'pending',
          checkInDate: iso(shift(64)),
          checkOutDate: iso(shift(71)),
        },
      ],
      transportation: [],
      ideas: [
        {
          id: 'idea-sandcastle',
          title: 'Sandcastle competition',
          votes: [{ memberId: neily.id, createdAt: now }],
          createdBy: neily.id,
          createdAt: now,
        },
      ],
      startDate: iso(shift(64)),
      endDate: iso(shift(71)),
      createdBy: mary.id,
      createdAt: now,
      updatedAt: now,
    },
  ];

  // ── To-dos ────────────────────────────────────────────────────────────────
  // Overdue and due-today todos assigned to John each draw a briefing row.
  // A future-dated todo counts toward "N tasks coming up" but draws no row.
  const todo = (title: string, o: Partial<TodoItem> = {}): TodoItem => ({
    id: `todo-${title.replace(/\W+/g, '-').toLowerCase()}`,
    title,
    completed: false,
    createdBy: john.id,
    createdAt: now,
    updatedAt: now,
    ...o,
  });

  const todos = [
    todo('Pack swimwear for wolf camp', { assigneeIds: [john.id], dueDate: today }),
    todo('Exchange yen for the trip', { assigneeIds: [john.id], dueDate: iso(shift(-1)) }),
    todo('Book the dentist', { assigneeIds: [mary.id], dueDate: iso(shift(3)) }),
    todo('Renew passports', { assigneeIds: [mary.id], someday: true }),
    todo('Water the beanstalk', { assigneeIds: [neily.id], dueDate: today }),
  ];

  // ── The Pod ───────────────────────────────────────────────────────────────
  const stamp = { createdBy: john.id, createdAt: now, updatedAt: now };

  const favorites: FavoriteItem[] = [
    { id: 'fav-1', memberId: neily.id, category: 'food', name: 'Pancakes', ...stamp },
    { id: 'fav-2', memberId: neily.id, category: 'book', name: 'Hungry Bean', ...stamp },
    { id: 'fav-3', memberId: neily.id, category: 'place', name: 'Beach hut', ...stamp },
    { id: 'fav-4', memberId: neily.id, category: 'song', name: 'Sunday songs', ...stamp },
    { id: 'fav-5', memberId: neily.id, category: 'toy', name: 'Blue beanie', ...stamp },
  ];

  const sayings: SayingItem[] = [
    {
      id: 'say-1',
      memberId: neily.id,
      words: 'if beans can grow, so can I',
      saidOn: iso(shift(-12)),
      place: 'the garden',
      ...stamp,
    },
    {
      id: 'say-2',
      memberId: neily.id,
      words: 'the moon is just a bean that got away',
      saidOn: iso(shift(-30)),
      ...stamp,
    },
    {
      id: 'say-3',
      memberId: mary.id,
      words: 'we are not lost, we are exploring',
      saidOn: iso(shift(-5)),
      place: 'somewhere in Tokyo',
      ...stamp,
    },
  ];

  const recipes: Recipe[] = [
    {
      id: 'recipe-pancakes',
      name: 'Sunday pancakes',
      subtitle: 'the ones Neily asks for',
      prepTime: '20 min',
      servings: '4 beans',
      ingredients: ['2 cups flour', '2 eggs', '1 cup milk', 'a pinch of salt', 'butter'],
      steps: ['Whisk it all together.', 'Rest the batter ten minutes.', 'Flip when it bubbles.'],
      notes: 'Grandma always added a little vanilla.',
      photoIds: [uid('photo', 'demo-photo-celebrating')],
      ...stamp,
    },
    {
      id: 'recipe-laksa',
      name: 'Weeknight laksa',
      subtitle: 'faster than takeaway',
      prepTime: '35 min',
      servings: '4 beans',
      ingredients: ['laksa paste', 'coconut milk', 'rice noodles', 'prawns', 'beansprouts'],
      steps: ['Fry the paste.', 'Add coconut milk, simmer.', 'Noodles in, prawns last.'],
      ...stamp,
    },
  ];

  // `medicationsStore.active` counts a med as active when `ongoing` is true (or it
  // is undated, or today falls inside its window). An `endDate` in the past means
  // the pod stat line reads "0 active meds".
  //
  // `dosesPerDay` (1-4) is what makes a 💊 row appear in the daily briefing.
  const medications: Medication[] = [
    {
      id: 'med-1',
      memberId: neily.id,
      name: 'Vitamin D',
      dose: '1 drop',
      frequency: 'once daily',
      dosesPerDay: 1,
      ongoing: true,
      ...stamp,
    },
    {
      id: 'med-2',
      memberId: john.id,
      name: 'Antihistamine',
      dose: '10mg',
      frequency: 'once daily',
      dosesPerDay: 1,
      ongoing: true,
      ...stamp,
    },
  ];

  const allergies: Allergy[] = [
    {
      id: 'alg-1',
      memberId: neily.id,
      name: 'Peanuts',
      allergyType: 'food',
      severity: 'severe',
      reaction: 'Hives, swelling',
      emergencyResponse: 'EpiPen in the blue bag, then call 995.',
      ...stamp,
    },
    {
      id: 'alg-2',
      memberId: mary.id,
      name: 'Pollen',
      allergyType: 'environmental',
      severity: 'mild',
      ...stamp,
    },
  ];

  const milestones: Milestone[] = [
    {
      id: 'ms-1',
      memberId: null,
      category: 'new_home',
      title: 'We moved into the Bean House',
      occurredOn: iso(shift(-400)),
      description: 'Boxes everywhere, pizza on the floor, best night ever.',
      photoIds: [uid('photo', 'demo-photo-hugging')],
      ...stamp,
    },
    {
      id: 'ms-2',
      memberId: neily.id,
      category: 'first_day_school',
      title: 'Neily’s first day of school',
      occurredOn: iso(shift(-220)),
      photoIds: [uid('photo', 'demo-photo-boy')],
      ...stamp,
    },
    {
      id: 'ms-3',
      memberId: neily.id,
      category: 'lost_tooth',
      title: 'First wobbly tooth, gone',
      occurredOn: iso(shift(-60)),
      photoIds: [uid('photo', 'demo-photo-celebrating')],
      ...stamp,
    },
    {
      id: 'ms-4',
      memberId: null,
      category: 'big_trip',
      title: 'Last summer, together',
      occurredOn: iso(shift(-330)),
      photoIds: [uid('photo', 'demo-photo-beanstalk')],
      ...stamp,
    },
  ];

  return {
    familyMembers: [john, mary, neily],
    accounts: [checking, savings],
    assets,
    transactions,
    activities,
    vacations,
    todos,
    photos,
    favorites,
    sayings,
    recipes,
    medications,
    allergies,
    milestones,
    settings: TestDataFactory.createSettings({ baseCurrency: 'SGD', displayCurrency: 'SGD' }),
  };
}
