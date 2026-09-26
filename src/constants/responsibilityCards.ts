// Who Owns What (#109) — the built-in responsibility deck.
//
// Original beanies wording (no Fair Play card or suit names), American English. Display
// text lives in the i18n layer (`nameKey` / `doneKey`, `en` + `beanie`); resolve it via
// `useResponsibilityCardLabel`, never `t()` on these keys directly, so custom cards and
// the family's done-line override are handled in one place.
//
// ⚠️ Card ids are PERSISTED: a family's state record for a built-in card is keyed by the
// id below. Never rename or reuse one. Retiring a card means removing it here; a family's
// old record then resolves as an unknown id (logged, ignored) rather than as a new card.
import type { HelpfulHintType, ListCategory, MealSlot } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** Skip-shortcut groups: "No car? Skip all 3". */
export type CardGroup = 'car' | 'yard' | 'pool' | 'baby' | 'pet' | 'school';

export interface ResponsibilityCardDef {
  /** Stable slug, e.g. 'cooking-dinner'. Never renamed (see header). */
  id: string;
  category: ListCategory;
  emoji: string;
  nameKey: UIStringKey;
  doneKey: UIStringKey;
  group?: CardGroup;
  /** Suggested split in the editor. */
  splitHint?: 'child';
  /** Hero cards: `/brand/cards/<id>.webp`. Renders the emoji until the asset exists. */
  illustration?: string;
}

export const RESPONSIBILITY_CARDS: readonly ResponsibilityCardDef[] = [
  // home
  {
    id: 'cooking-dinner',
    category: 'home',
    emoji: '🍳',
    nameKey: 'cards.cookingDinner.name',
    doneKey: 'cards.cookingDinner.done',
    illustration: '/brand/cards/cooking-dinner.webp',
  },
  {
    id: 'breakfast',
    category: 'home',
    emoji: '🥣',
    nameKey: 'cards.breakfast.name',
    doneKey: 'cards.breakfast.done',
  },
  {
    id: 'dishes',
    category: 'home',
    emoji: '🍽️',
    nameKey: 'cards.dishes.name',
    doneKey: 'cards.dishes.done',
  },
  {
    id: 'laundry',
    category: 'home',
    emoji: '🧺',
    nameKey: 'cards.laundry.name',
    doneKey: 'cards.laundry.done',
    illustration: '/brand/cards/laundry.webp',
  },
  {
    id: 'floors',
    category: 'home',
    emoji: '🧹',
    nameKey: 'cards.floors.name',
    doneKey: 'cards.floors.done',
  },
  {
    id: 'sparkling-bathrooms',
    category: 'home',
    emoji: '🛁',
    nameKey: 'cards.sparklingBathrooms.name',
    doneKey: 'cards.sparklingBathrooms.done',
  },
  {
    id: 'trash-night',
    category: 'home',
    emoji: '🗑️',
    nameKey: 'cards.trashNight.name',
    doneKey: 'cards.trashNight.done',
    illustration: '/brand/cards/trash-night.webp',
  },
  {
    id: 'home-supplies',
    category: 'home',
    emoji: '🧻',
    nameKey: 'cards.homeSupplies.name',
    doneKey: 'cards.homeSupplies.done',
  },
  {
    id: 'fixing-things',
    category: 'home',
    emoji: '🔧',
    nameKey: 'cards.fixingThings.name',
    doneKey: 'cards.fixingThings.done',
  },
  {
    id: 'seasonal-swap',
    category: 'home',
    emoji: '📦',
    nameKey: 'cards.seasonalSwap.name',
    doneKey: 'cards.seasonalSwap.done',
  },
  {
    id: 'decluttering',
    category: 'home',
    emoji: '🎁',
    nameKey: 'cards.decluttering.name',
    doneKey: 'cards.decluttering.done',
  },
  {
    id: 'mail-and-paperwork',
    category: 'home',
    emoji: '📬',
    nameKey: 'cards.mailAndPaperwork.name',
    doneKey: 'cards.mailAndPaperwork.done',
  },
  {
    id: 'home-rent-mortgage-insurance',
    category: 'home',
    emoji: '🏠',
    nameKey: 'cards.homeRentMortgageInsurance.name',
    doneKey: 'cards.homeRentMortgageInsurance.done',
  },
  {
    id: 'family-budget-check',
    category: 'home',
    emoji: '📊',
    nameKey: 'cards.familyBudgetCheck.name',
    doneKey: 'cards.familyBudgetCheck.done',
  },
  {
    id: 'paying-the-bills',
    category: 'home',
    emoji: '💳',
    nameKey: 'cards.payingTheBills.name',
    doneKey: 'cards.payingTheBills.done',
  },
  {
    id: 'family-calendar',
    category: 'home',
    emoji: '📅',
    nameKey: 'cards.familyCalendar.name',
    doneKey: 'cards.familyCalendar.done',
  },
  {
    id: 'wifi-gadgets-passwords',
    category: 'home',
    emoji: '📶',
    nameKey: 'cards.wifiGadgetsPasswords.name',
    doneKey: 'cards.wifiGadgetsPasswords.done',
  },
  {
    id: 'pet-care',
    category: 'home',
    emoji: '🐾',
    nameKey: 'cards.petCare.name',
    doneKey: 'cards.petCare.done',
    group: 'pet',
  },
  {
    id: 'plants',
    category: 'home',
    emoji: '🪴',
    nameKey: 'cards.plants.name',
    doneKey: 'cards.plants.done',
  },
  {
    id: 'snow-and-ice',
    category: 'home',
    emoji: '❄️',
    nameKey: 'cards.snowAndIce.name',
    doneKey: 'cards.snowAndIce.done',
  },
  // out
  {
    id: 'grocery-shopping',
    category: 'out',
    emoji: '🛒',
    nameKey: 'cards.groceryShopping.name',
    doneKey: 'cards.groceryShopping.done',
    illustration: '/brand/cards/grocery-shopping.webp',
  },
  {
    id: 'car-care',
    category: 'out',
    emoji: '🚗',
    nameKey: 'cards.carCare.name',
    doneKey: 'cards.carCare.done',
    group: 'car',
  },
  {
    id: 'packages-and-returns',
    category: 'out',
    emoji: '📦',
    nameKey: 'cards.packagesAndReturns.name',
    doneKey: 'cards.packagesAndReturns.done',
  },
  {
    id: 'points-and-coupons',
    category: 'out',
    emoji: '🏷️',
    nameKey: 'cards.pointsAndCoupons.name',
    doneKey: 'cards.pointsAndCoupons.done',
  },
  // kids
  {
    id: 'lunchboxes',
    category: 'kids',
    emoji: '🥪',
    nameKey: 'cards.lunchboxes.name',
    doneKey: 'cards.lunchboxes.done',
    splitHint: 'child',
  },
  {
    id: 'babysitters-and-nannies',
    category: 'kids',
    emoji: '🧑‍🍼',
    nameKey: 'cards.babysittersAndNannies.name',
    doneKey: 'cards.babysittersAndNannies.done',
  },
  {
    id: 'school-forms',
    category: 'kids',
    emoji: '📋',
    nameKey: 'cards.schoolForms.name',
    doneKey: 'cards.schoolForms.done',
  },
  {
    id: 'school-vacations',
    category: 'kids',
    emoji: '🏖️',
    nameKey: 'cards.schoolVacations.name',
    doneKey: 'cards.schoolVacations.done',
  },
  {
    id: 'school-drop-off',
    category: 'kids',
    emoji: '🎒',
    nameKey: 'cards.schoolDropOff.name',
    doneKey: 'cards.schoolDropOff.done',
    splitHint: 'child',
    illustration: '/brand/cards/school-drop-off.webp',
  },
  {
    id: 'kids-bags-for-the-day',
    category: 'kids',
    emoji: '🧢',
    nameKey: 'cards.kidsBagsForTheDay.name',
    doneKey: 'cards.kidsBagsForTheDay.done',
    splitHint: 'child',
  },
  {
    id: 'sports-and-clubs',
    category: 'kids',
    emoji: '⚽',
    nameKey: 'cards.sportsAndClubs.name',
    doneKey: 'cards.sportsAndClubs.done',
    splitHint: 'child',
  },
  {
    id: 'tutors-and-lessons',
    category: 'kids',
    emoji: '🎹',
    nameKey: 'cards.tutorsAndLessons.name',
    doneKey: 'cards.tutorsAndLessons.done',
    splitHint: 'child',
  },
  {
    id: 'morning-routine',
    category: 'kids',
    emoji: '🌅',
    nameKey: 'cards.morningRoutine.name',
    doneKey: 'cards.morningRoutine.done',
  },
  {
    id: 'bedtime-routine',
    category: 'kids',
    emoji: '🌙',
    nameKey: 'cards.bedtimeRoutine.name',
    doneKey: 'cards.bedtimeRoutine.done',
    splitHint: 'child',
    illustration: '/brand/cards/bedtime-routine.webp',
  },
  {
    id: 'bath-time-and-haircuts',
    category: 'kids',
    emoji: '🛀',
    nameKey: 'cards.bathTimeAndHaircuts.name',
    doneKey: 'cards.bathTimeAndHaircuts.done',
    splitHint: 'child',
  },
  {
    id: 'clothes-that-fit',
    category: 'kids',
    emoji: '👕',
    nameKey: 'cards.clothesThatFit.name',
    doneKey: 'cards.clothesThatFit.done',
    splitHint: 'child',
  },
  {
    id: 'potty-training-and-diapers',
    category: 'kids',
    emoji: '🧷',
    nameKey: 'cards.pottyTrainingAndDiapers.name',
    doneKey: 'cards.pottyTrainingAndDiapers.done',
    group: 'baby',
  },
  {
    id: 'homework-and-school-supplies',
    category: 'kids',
    emoji: '✏️',
    nameKey: 'cards.homeworkAndSchoolSupplies.name',
    doneKey: 'cards.homeworkAndSchoolSupplies.done',
    splitHint: 'child',
  },
  {
    id: 'talking-to-teachers',
    category: 'kids',
    emoji: '🍎',
    nameKey: 'cards.talkingToTeachers.name',
    doneKey: 'cards.talkingToTeachers.done',
    splitHint: 'child',
  },
  {
    id: 'helping-at-school',
    category: 'kids',
    emoji: '🙋',
    nameKey: 'cards.helpingAtSchool.name',
    doneKey: 'cards.helpingAtSchool.done',
  },
  {
    id: 'new-school-new-year',
    category: 'kids',
    emoji: '🏫',
    nameKey: 'cards.newSchoolNewYear.name',
    doneKey: 'cards.newSchoolNewYear.done',
    splitHint: 'child',
  },
  {
    id: 'friends-and-screens',
    category: 'kids',
    emoji: '📱',
    nameKey: 'cards.friendsAndScreens.name',
    doneKey: 'cards.friendsAndScreens.done',
    splitHint: 'child',
  },
  {
    id: 'night-wake-ups',
    category: 'kids',
    emoji: '🧸',
    nameKey: 'cards.nightWakeUps.name',
    doneKey: 'cards.nightWakeUps.done',
  },
  {
    id: 'learning-at-home',
    category: 'kids',
    emoji: '📚',
    nameKey: 'cards.learningAtHome.name',
    doneKey: 'cards.learningAtHome.done',
    splitHint: 'child',
  },
  {
    id: 'being-there',
    category: 'kids',
    emoji: '👏',
    nameKey: 'cards.beingThere.name',
    doneKey: 'cards.beingThere.done',
  },
  // health
  {
    id: 'doctor-and-dentist',
    category: 'health',
    emoji: '🩺',
    nameKey: 'cards.doctorAndDentist.name',
    doneKey: 'cards.doctorAndDentist.done',
  },
  {
    id: 'medicine-cabinet',
    category: 'health',
    emoji: '💊',
    nameKey: 'cards.medicineCabinet.name',
    doneKey: 'cards.medicineCabinet.done',
  },
  {
    id: 'our-emergency-plan',
    category: 'health',
    emoji: '🚨',
    nameKey: 'cards.ourEmergencyPlan.name',
    doneKey: 'cards.ourEmergencyPlan.done',
  },
  {
    id: 'health-insurance-and-claims',
    category: 'health',
    emoji: '🧾',
    nameKey: 'cards.healthInsuranceAndClaims.name',
    doneKey: 'cards.healthInsuranceAndClaims.done',
  },
  {
    id: 'wills-and-life-insurance',
    category: 'health',
    emoji: '📜',
    nameKey: 'cards.willsAndLifeInsurance.name',
    doneKey: 'cards.willsAndLifeInsurance.done',
  },
  {
    id: 'special-needs-support',
    category: 'health',
    emoji: '💙',
    nameKey: 'cards.specialNeedsSupport.name',
    doneKey: 'cards.specialNeedsSupport.done',
    splitHint: 'child',
  },
  // celebrations
  {
    id: 'the-big-holidays',
    category: 'celebrations',
    emoji: '🎄',
    nameKey: 'cards.theBigHolidays.name',
    doneKey: 'cards.theBigHolidays.done',
    illustration: '/brand/cards/the-big-holidays.webp',
  },
  {
    id: 'birthday-parties',
    category: 'celebrations',
    emoji: '🎂',
    nameKey: 'cards.birthdayParties.name',
    doneKey: 'cards.birthdayParties.done',
    splitHint: 'child',
    illustration: '/brand/cards/birthday-parties.webp',
  },
  {
    id: 'gifts-for-others',
    category: 'celebrations',
    emoji: '🎁',
    nameKey: 'cards.giftsForOthers.name',
    doneKey: 'cards.giftsForOthers.done',
  },
  {
    id: 'cards-and-thank-yous',
    category: 'celebrations',
    emoji: '💌',
    nameKey: 'cards.cardsAndThankYous.name',
    doneKey: 'cards.cardsAndThankYous.done',
  },
  {
    id: 'tooth-fairy-duty',
    category: 'celebrations',
    emoji: '🦷',
    nameKey: 'cards.toothFairyDuty.name',
    doneKey: 'cards.toothFairyDuty.done',
  },
  {
    id: 'having-people-over',
    category: 'celebrations',
    emoji: '🥂',
    nameKey: 'cards.havingPeopleOver.name',
    doneKey: 'cards.havingPeopleOver.done',
  },
  {
    id: 'photos-and-memories',
    category: 'celebrations',
    emoji: '📸',
    nameKey: 'cards.photosAndMemories.name',
    doneKey: 'cards.photosAndMemories.done',
  },
  {
    id: 'weekend-plans',
    category: 'celebrations',
    emoji: '🗺️',
    nameKey: 'cards.weekendPlans.name',
    doneKey: 'cards.weekendPlans.done',
  },
  {
    id: 'giving-back',
    category: 'celebrations',
    emoji: '🤲',
    nameKey: 'cards.givingBack.name',
    doneKey: 'cards.givingBack.done',
  },
  {
    id: 'faith-and-traditions',
    category: 'celebrations',
    emoji: '🕯️',
    nameKey: 'cards.faithAndTraditions.name',
    doneKey: 'cards.faithAndTraditions.done',
  },
  // people
  {
    id: 'date-nights',
    category: 'people',
    emoji: '🕯️',
    nameKey: 'cards.dateNights.name',
    doneKey: 'cards.dateNights.done',
    illustration: '/brand/cards/date-nights.webp',
  },
  {
    id: 'grandparents',
    category: 'people',
    emoji: '👵',
    nameKey: 'cards.grandparents.name',
    doneKey: 'cards.grandparents.done',
  },
  {
    id: 'keeping-up-with-family',
    category: 'people',
    emoji: '📞',
    nameKey: 'cards.keepingUpWithFamily.name',
    doneKey: 'cards.keepingUpWithFamily.done',
  },
  {
    id: 'aging-parent-care',
    category: 'people',
    emoji: '🤝',
    nameKey: 'cards.agingParentCare.name',
    doneKey: 'cards.agingParentCare.done',
  },
  // trips
  {
    id: 'trip-packing',
    category: 'trips',
    emoji: '🧳',
    nameKey: 'cards.tripPacking.name',
    doneKey: 'cards.tripPacking.done',
  },
  {
    id: 'planning-trips',
    category: 'trips',
    emoji: '✈️',
    nameKey: 'cards.planningTrips.name',
    doneKey: 'cards.planningTrips.done',
  },
  {
    id: 'passports-and-documents',
    category: 'trips',
    emoji: '🛂',
    nameKey: 'cards.passportsAndDocuments.name',
    doneKey: 'cards.passportsAndDocuments.done',
  },
  {
    id: 'outings-and-culture',
    category: 'trips',
    emoji: '🎨',
    nameKey: 'cards.outingsAndCulture.name',
    doneKey: 'cards.outingsAndCulture.done',
  },
  // projects
  {
    id: 'the-yard',
    category: 'projects',
    emoji: '🌱',
    nameKey: 'cards.theYard.name',
    doneKey: 'cards.theYard.done',
    group: 'yard',
  },
  {
    id: 'furniture-and-decorations',
    category: 'projects',
    emoji: '🛋️',
    nameKey: 'cards.furnitureAndDecorations.name',
    doneKey: 'cards.furnitureAndDecorations.done',
  },
  {
    id: 'the-renovation',
    category: 'projects',
    emoji: '🏗️',
    nameKey: 'cards.theRenovation.name',
    doneKey: 'cards.theRenovation.done',
  },
  {
    id: 'moving',
    category: 'projects',
    emoji: '🚚',
    nameKey: 'cards.moving.name',
    doneKey: 'cards.moving.done',
  },
  {
    id: 'bikes',
    category: 'projects',
    emoji: '🚲',
    nameKey: 'cards.bikes.name',
    doneKey: 'cards.bikes.done',
  },
  {
    id: 'the-pool',
    category: 'projects',
    emoji: '🏊',
    nameKey: 'cards.thePool.name',
    doneKey: 'cards.thePool.done',
    group: 'pool',
  },
  {
    id: 'camping-gear',
    category: 'projects',
    emoji: '⛺',
    nameKey: 'cards.campingGear.name',
    doneKey: 'cards.campingGear.done',
  },
  {
    id: 'vegetable-patch',
    category: 'projects',
    emoji: '🥕',
    nameKey: 'cards.vegetablePatch.name',
    doneKey: 'cards.vegetablePatch.done',
    group: 'yard',
  },
  {
    id: 'the-fireplace',
    category: 'projects',
    emoji: '🔥',
    nameKey: 'cards.theFireplace.name',
    doneKey: 'cards.theFireplace.done',
  },
  // me
  {
    id: 'time-to-myself',
    category: 'me',
    emoji: '✨',
    nameKey: 'cards.timeToMyself.name',
    doneKey: 'cards.timeToMyself.done',
    illustration: '/brand/cards/time-to-myself.webp',
  },
  {
    id: 'moving-my-body',
    category: 'me',
    emoji: '🏃',
    nameKey: 'cards.movingMyBody.name',
    doneKey: 'cards.movingMyBody.done',
  },
  {
    id: 'seeing-my-friends',
    category: 'me',
    emoji: '🍻',
    nameKey: 'cards.seeingMyFriends.name',
    doneKey: 'cards.seeingMyFriends.done',
  },
];

const _byId = new Map(RESPONSIBILITY_CARDS.map((c) => [c.id, c]));

export function getResponsibilityCard(id: string): ResponsibilityCardDef | undefined {
  return _byId.get(id);
}

/**
 * The ONE source of truth for every place beanies uses a card's holder as a default.
 * Integrations (meals, list templates, helpful hints) look up here and nowhere else;
 * `cardUsesFor` derives the view drawer's "beanies uses this card for" lines from it.
 */
export const CARD_DEFAULTS = {
  mealSlot: { dinner: 'cooking-dinner', breakfast: 'breakfast' },
  listTemplate: { grocery: 'grocery-shopping', 'vacation-packing': 'trip-packing' },
  hint: {
    'birthday-present': 'gifts-for-others',
    'birthday-party-gift': 'gifts-for-others',
    'celebration-gift': 'gifts-for-others',
    'anniversary-plan': 'date-nights',
    'trip-packing': 'trip-packing',
    'trip-documents': 'passports-and-documents',
  },
} as const satisfies {
  mealSlot: Partial<Record<MealSlot, string>>;
  listTemplate: Record<string, string>;
  hint: Partial<Record<HelpfulHintType, string>>;
};

export type CardDefaultTarget =
  | { kind: 'mealSlot'; slot: MealSlot }
  | { kind: 'listTemplate'; key: string }
  | { kind: 'hint'; hintType: HelpfulHintType };

/** The card a default target reads its holder from, or undefined when none is mapped. */
export function cardIdForTarget(target: CardDefaultTarget): string | undefined {
  const map: Record<string, string> =
    target.kind === 'mealSlot'
      ? CARD_DEFAULTS.mealSlot
      : target.kind === 'listTemplate'
        ? CARD_DEFAULTS.listTemplate
        : CARD_DEFAULTS.hint;
  const key =
    target.kind === 'mealSlot'
      ? target.slot
      : target.kind === 'listTemplate'
        ? target.key
        : target.hintType;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Derived "beanies uses this card for" lines for the view drawer (empty for most cards). */
export function cardUsesFor(cardId: string): CardDefaultTarget[] {
  const out: CardDefaultTarget[] = [];
  for (const [slot, id] of Object.entries(CARD_DEFAULTS.mealSlot)) {
    if (id === cardId) out.push({ kind: 'mealSlot', slot: slot as MealSlot });
  }
  for (const [key, id] of Object.entries(CARD_DEFAULTS.listTemplate)) {
    if (id === cardId) out.push({ kind: 'listTemplate', key });
  }
  for (const [hintType, id] of Object.entries(CARD_DEFAULTS.hint)) {
    if (id === cardId) out.push({ kind: 'hint', hintType: hintType as HelpfulHintType });
  }
  return out;
}
