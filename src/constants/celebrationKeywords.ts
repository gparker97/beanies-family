/**
 * Words that mean "this is a celebration", per locale.
 *
 * NOT in `uiStrings.ts`, deliberately — and this deviates from the approved
 * mockup, which said the word lists belong in the translation layer.
 * `scripts/updateTranslations.mjs` pipes every `uiStrings` value through the
 * MyMemory machine-translation API, and a keyword list run through machine
 * translation produces unusable matchers. These are matching DATA, not UI copy;
 * only the user-facing celebration label is a translated string.
 *
 * Hand-curated per locale. The app ships `en` and `zh`, so this is two lists,
 * not a maintenance tail.
 */
export const CELEBRATION_KEYWORDS: Record<string, readonly string[]> = {
  en: [
    'birthday',
    'bday',
    'anniversary',
    'baby shower',
    'babyshower',
    'wedding',
    'graduation',
    'christening',
    'baptism',
    'bar mitzvah',
    'bat mitzvah',
    'engagement',
    'housewarming',
  ],
  zh: ['生日', '週年', '周年', '婚禮', '婚礼', '畢業', '毕业', '滿月', '满月', '訂婚', '订婚'],
};

/**
 * Openers that mean the title is PREPARATION for a celebration, not the day itself.
 *
 * "Buy birthday present for Leo" is an errand. Without this, a naive keyword
 * match confetti-bombs every shopping trip in the run-up to a party — and the
 * errands outnumber the parties. This one rule removes most false positives.
 */
export const CELEBRATION_ERRAND_VERBS: Record<string, readonly string[]> = {
  en: [
    'buy',
    'book',
    'order',
    'collect',
    'pick up',
    'wrap',
    'plan',
    'pay',
    'organise',
    'organize',
    'prep',
    'prepare',
    'shop',
    'send',
    'post',
    'rsvp',
  ],
  zh: ['買', '买', '訂', '订', '準備', '准备', '安排', '取', '寄'],
};

/**
 * Emoji that are near-certain intent — and the only signal that works in every
 * language, including ones with no keyword list at all.
 */
export const CELEBRATION_EMOJI = ['🎂', '🎉', '🎈', '🥳', '🎊', '🍰', '🎁'] as const;
