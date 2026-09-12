/**
 * The one place a price lives.
 *
 * The rendered plans table, the client-side currency switcher, the early-family
 * discount lines and the FAQPage JSON-LD all read from here, so a price change
 * is one edit and cannot drift between the number a person sees and the number
 * a crawler indexes. Adding a currency is one entry in `PRICES`; the page renders
 * a switcher button per entry and nothing else knows the list.
 *
 * Positioning (research, 2026-09-10): family-organiser annual mean $70.62
 * (n=7, ex-Maple); $84.99 is +20.3%, the top of the agreed 15-20% premium band.
 *
 * MODEL (revised 2026-09-11): there is no free tier. A 90-day trial of the whole
 * app (AI capped at 1 read/day) lands on read-only until a plan is chosen. Two
 * plans: `basic` is YEARLY ONLY, because $2.99/mo loses money to the 15% store
 * cut plus twelve transaction fees; `full` adds the AI at 10 reads/day. Free
 * forever still exists, but as self-hosting, not as a tier.
 *
 * NOT a paid perk: photo storage. `PhotoAttachment` holds a `driveFileId`, so
 * photo bytes live in the family's OWN Drive and the .beanpod carries only
 * metadata. We neither pay for that storage nor control the quota, so "more
 * room for photos" was a promise the architecture contradicts. Removed
 * 2026-09-12.
 */
export type CurrencyCode = 'USD' | 'SGD';

export interface PriceTable {
  /** Button label on the switcher. */
  label: string;
  /** beanies basic. Sold by the year only - see the MODEL note above. */
  basicYearly: string;
  /** basicYearly / 12, for the "works out to" line. */
  basicPerMonth: string;
  /** beanies + magic beans. */
  fullYearly: string;
  fullMonthly: string;
  /** fullYearly / 12, ROUNDED - it is only ever rendered behind a "~". The
   *  basic equivalent is exact because 30/12 is exactly 2.50. */
  fullPerMonth: string;
  /** The 50%-off-for-life figures for families who joined before v1. */
  halfBasicYearly: string;
  halfFullYearly: string;
  /** Yearly saving against 12x monthly on the full plan, already rounded. */
  savePct: number;
}

export const PRICES: Record<CurrencyCode, PriceTable> = {
  USD: {
    label: 'USD $',
    basicYearly: '$30',
    basicPerMonth: '$2.50',
    fullYearly: '$84.99',
    fullMonthly: '$9.99',
    fullPerMonth: '$7',
    halfBasicYearly: '$15',
    halfFullYearly: '$42.49',
    savePct: 29,
  },
  SGD: {
    label: 'SGD S$',
    basicYearly: 'S$39',
    basicPerMonth: 'S$3.25',
    fullYearly: 'S$110',
    fullMonthly: 'S$13',
    fullPerMonth: 'S$9',
    halfBasicYearly: 'S$19.50',
    halfFullYearly: 'S$55',
    savePct: 29,
  },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/** Structured data wants a bare number, not a display string. Derived from
 *  PRICES rather than retyped, so the JSON-LD cannot drift from the page. */
export const numericPrice = (price: string): string => price.replace(/[^0-9.]/g, '');

/** Length of the everything-included trial that starts at v1. */
export const TRIAL_DAYS = 90;

/** Magic beans allowances. The trial gets a taste; basic keeps one a month so
 *  the feature is discoverable rather than invisible. */
export const MAGIC_BEANS = { trialPerDay: 1, basicPerMonth: 1, fullPerDay: 10 } as const;

/** Competitor pricing cited on the page. Dated on purpose: a dated figure ages
 *  into a historical fact, an undated one ages into a false claim. */
export const COZI = { adFreeYearly: '$39', aiYearly: '$79', checked: 'sep 2026' } as const;

export interface PricingFaq {
  id: string;
  q: string;
  /** Plain text. Rendered as one paragraph and reused verbatim in the JSON-LD. */
  a: string;
}

/**
 * Written in greg's voice and reviewed by him. Plain strings on purpose: the
 * same text feeds the visible accordion and the FAQPage schema, and HTML in
 * here would have to be stripped for one of them.
 */
export const PRICING_FAQS: PricingFaq[] = [
  {
    id: 'trial-is-everything',
    q: 'do i really get everything in the app for 90 days?',
    a: "you do - all the features across the entire app for your whole family. the only cap is magic beans (beanies ai), where you'll get one read per day.",
  },
  {
    id: 'after-90-days',
    q: 'what happens when the 90 days are up?',
    a: "beanies becomes read-only. everything's still there and still yours, you just can't add to it until you pick a plan. export works any time, paid or not. and if beanies isn't for you, take your data and go. no hard feelings.",
  },
  {
    id: 'subscribe-early',
    q: 'if i subscribe before my trial period is done, what happens to the trial period?',
    a: "start now and billing begins today, the one-ai-per-day cap is removed, and your plan's full allowance kicks in. start later and nothing is charged until day 91, and the ai cap stays put until then.",
  },
  {
    id: 'one-magic-bean',
    q: 'what counts as one ai read?',
    a: "one document, invitation, itinerary, recipe, etc. with the trial you get one magic bean per day, beanies + magic beans gives you ten a day, and with beanies basic you get one each month. bring your own key and there's no limit from me at all.",
  },
  {
    id: 'compare-to-cozi',
    q: 'how does this compare to cozi?',
    a: `as of this writing (in ${COZI.checked}), cozi's ad-free plan is ${COZI.adFreeYearly} a year and beanies basic is ${PRICES.USD.basicYearly}. their ai plan is ${COZI.aiYearly} and beanies + magic beans is ${PRICES.USD.fullYearly}. we're about five dollars more, which is roughly due to beanies providing privacy rather than advertising. cozi has a free tier which runs on ads, while we have a ${TRIAL_DAYS} day trial period (and we'll never have ads).`,
  },
  {
    id: 'here-now',
    q: "i'm an early adopter beanie. what does that get me?",
    a: `half price on either plan, forever, for joining before v1. that's ${PRICES.USD.halfBasicYearly} a year for beanies basic, or ${PRICES.USD.halfFullYearly} for beanies + magic beans. no code, no expiry, and no renewal to miss.`,
  },
  {
    id: 'prove-early',
    q: 'how do you know i was here before v1?',
    a: "your pod has a creation date, and that's the whole test. no code, no coupon, no screenshot. you don't need to do anything today except be here.",
  },
  {
    id: 'when-is-v1',
    q: 'when is v1 coming?',
    a: "as of now, i'd say roughly around october (2026), depending on how long it takes to plod through our issues list. i'll post updates here as we get closer.",
  },
  {
    id: 'data-if-i-leave',
    q: 'what happens to my data if i stop paying, or leave?',
    a: "nothing happens to it. it's your own encrypted file, not on my server, so there's nothing for me to lock or delete. stop paying and beanies goes read-only. export everything whenever you like, or take the file and go.",
  },
  {
    id: 'self-host',
    q: 'can i just run it myself for free?',
    a: "yes. it's open source, and self-hosting is free, forever, no strings. you'll need somewhere to run it and a bit of patience, but you'll never see a bill from me.",
  },
  {
    id: 'other-currencies',
    q: 'will there be other currencies?',
    a: "yes. usd and sgd first, because that's where most beanies live right now. others as families ask for them. the price is the price wherever you are - nobody pays more for being somewhere else.",
  },
];
